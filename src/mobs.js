// All non-player entities: dropped items, falling blocks, TNT, arrows and mobs (with AI + spawning).
import { Entity, Living } from './entity.js';
import { B, blocks, OPAQUE, SOLID, FLUID, WH } from './blocks.js';
import { I, items, maxStack } from './items.js';
import { BIOME } from './worldgen.js';
import { m4, clamp, lerp, wrapAngle } from './math.js';
import { lightRGB } from './renderer.js';
import { lerpAngle } from './models.js';

const PI = Math.PI;
const rnd = Math.random;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ---- dropped item ---------------------------------------------------------------------
export class ItemEntity extends Entity {
  constructor(world, x, y, z, stack) {
    super(world, x, y, z);
    this.kind = 'item';
    this.stack = stack;
    this.w = 0.25; this.h = 0.25;
    this.pickupDelay = 10;
    this.vx = (rnd() - 0.5) * 0.2; this.vy = 0.2; this.vz = (rnd() - 0.5) * 0.2;
    this.spin = rnd() * PI * 2;
  }
  tick(game) {
    this.savePrev();
    this.age++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.vy -= 0.04;
    const w = this.world;
    const inBlock = SOLID[w.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z))] && OPAQUE[w.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z))];
    if (inBlock) { this.vy = 0.1; this.noClip = true; } else this.noClip = false;
    const fl = FLUID[w.getBlock(Math.floor(this.x), Math.floor(this.y + 0.15), Math.floor(this.z))];
    if (fl === 1) { this.vy += 0.06; if (this.vy > 0.08) this.vy = 0.08; this.vx *= 0.95; this.vz *= 0.95; }
    else if (fl === 2) { this.dead = true; game.audio.play('fizz', this.x, this.y, this.z, 0.4, 2); return; }
    this.move(this.vx, this.vy, this.vz);
    let f = 0.98;
    if (this.onGround) f = blocks[w.getBlock(Math.floor(this.x), Math.floor(this.y) - 1, Math.floor(this.z))].slip * 0.98;
    this.vx *= f; this.vy *= 0.98; this.vz *= f;
    if (this.onGround) this.vy *= -0.5;
    if (this.age > 6000 || this.y < -20) this.dead = true;
    // merge with nearby identical stacks
    if (this.age % 25 === 0 && !this.dead) {
      for (const e of game.entities.list) {
        if (e === this || e.kind !== 'item' || e.dead || e.stack.id !== this.stack.id || e.stack.dmg) continue;
        if (this.dist2(e.x, e.y, e.z) < 1 && this.stack.count + e.stack.count <= maxStack(this.stack.id)) {
          this.stack.count += e.stack.count;
          this.pickupDelay = Math.max(this.pickupDelay, e.pickupDelay);
          e.dead = true;
        }
      }
    }
    // pickup
    const p = game.player;
    if (this.pickupDelay === 0 && p.alive && !this.dead) {
      const dx = p.x - this.x, dy = p.y + 0.6 - this.y, dz = p.z - this.z;
      if (Math.abs(dx) < 1.3 && Math.abs(dz) < 1.3 && dy > -1.4 && dy < 1.2) {
        const left = p.inv.add(this.stack);
        if (left < this.stack.count) {
          game.audio.play('pop', this.x, this.y, this.z, 0.25, 1.4 + rnd() * 0.8);
          game.ui.dirty = true;
        }
        if (left <= 0) this.dead = true;
        else this.stack.count = left;
      }
    }
  }
}

// ---- falling sand / gravel ------------------------------------------------------------------
export class FallingBlock extends Entity {
  constructor(world, x, y, z, id, meta) {
    super(world, x + 0.5, y, z + 0.5);
    this.kind = 'falling';
    this.id = id; this.meta = meta;
    this.w = 0.98; this.h = 0.98;
  }
  tick(game) {
    this.savePrev();
    this.age++;
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) {
      const x = Math.floor(this.x), y = Math.floor(this.y + 0.01), z = Math.floor(this.z);
      const at = this.world.getBlock(x, y, z);
      this.dead = true;
      if (at === 0 || blocks[at].replaceable) {
        this.world.setBlock(x, y, z, this.id, this.meta);
        game.audio.play('step_' + blocks[this.id].sound, this.x, this.y, this.z, 0.5, 0.8);
      } else game.dropItem(this.x, this.y + 0.3, this.z, this.id, 1);
    } else if (this.age > 600 || this.y < -20) this.dead = true;
  }
}

// ---- primed TNT -----------------------------------------------------------------------------
export class PrimedTNT extends Entity {
  constructor(world, x, y, z, fuse) {
    super(world, x + 0.5, y, z + 0.5);
    this.kind = 'tnt';
    this.fuse = fuse;
    this.w = 0.98; this.h = 0.98;
    const a = rnd() * PI * 2;
    this.vx = -Math.sin(a) * 0.02; this.vy = 0.2; this.vz = -Math.cos(a) * 0.02;
  }
  tick(game) {
    this.savePrev();
    this.age++;
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.7; this.vz *= 0.7; this.vy *= -0.5; }
    if (--this.fuse <= 0) {
      this.dead = true;
      this.world.explode(this.x, this.y + 0.5, this.z, 4, this);
    } else if (this.age % 2 === 0) game.particles.smoke(this.x, this.y + 1.05, this.z, 1);
  }
}

// ---- arrow -------------------------------------------------------------------------------------
export class Arrow extends Entity {
  constructor(world, x, y, z, vx, vy, vz, owner) {
    super(world, x, y, z);
    this.kind = 'arrow';
    this.w = 0.3; this.h = 0.3;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.owner = owner;
    this.stuck = false;
    this.damage = 2;
    this.crit = false;
    this.fromPlayer = owner && owner.kind === 'player';
    this._aim();
    this.pyaw = this.yaw; this.ppitch = this.pitch;
  }
  _aim() {
    const h = Math.hypot(this.vx, this.vz);
    this.yaw = Math.atan2(this.vx, this.vz);
    this.pitch = Math.atan2(this.vy, h);
  }
  tick(game) {
    this.savePrev();
    this.age++;
    if (this.stuck) {
      if (!SOLID[this.world.getBlock(this.sx, this.sy, this.sz)]) this.stuck = false;
      else {
        if (this.age > 1200) this.dead = true;
        const p = game.player;
        if (this.fromPlayer && p.alive && this.dist2(p.x, p.y + 0.9, p.z) < 2.2 && this.age > 10) {
          if (p.inv.add({ id: I.ARROW, count: 1 }) === 0) { this.dead = true; game.audio.play('pop', this.x, this.y, this.z, 0.25, 1.6); game.ui.dirty = true; }
        }
        return;
      }
    }
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    const dx = this.vx / speed, dy = this.vy / speed, dz = this.vz / speed;
    let hit = this.world.raycast(this.x, this.y, this.z, dx, dy, dz, speed);
    let maxT = hit ? hit.dist : speed;
    // entities along the path
    let target = null;
    for (const e of game.entities.list) {
      if (!(e instanceof Living) || !e.alive || e === this.owner) continue;
      const t = rayEntity(this.x, this.y, this.z, dx, dy, dz, e, 0.3);
      if (t !== null && t < maxT) { maxT = t; target = e; }
    }
    const p = game.player;
    if (this.owner !== p && p.alive && p.mode !== 'creative') {
      const t = rayEntity(this.x, this.y, this.z, dx, dy, dz, p, 0.3);
      if (t !== null && t < maxT) { maxT = t; target = p; }
    }
    if (target) {
      let dmg = Math.ceil(speed * this.damage);
      if (this.crit) dmg += ri(0, (dmg / 2) | 0 + 1);
      if (target.hurt(dmg, this.owner || this)) {
        game.audio.play('arrow_hit', this.x, this.y, this.z, 0.6, 1.2);
        this.dead = true;
        return;
      }
      this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1;
    } else if (hit) {
      this.x += dx * hit.dist - dx * 0.05; this.y += dy * hit.dist - dy * 0.05; this.z += dz * hit.dist - dz * 0.05;
      this.stuck = true; this.sx = hit.x; this.sy = hit.y; this.sz = hit.z;
      this.age = 0;
      game.audio.play('arrow_hit', this.x, this.y, this.z, 0.5, 1 + rnd() * 0.3);
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    this._aim();
    const inWater = FLUID[this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))] === 1;
    const drag = inWater ? 0.6 : 0.99;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= 0.05;
    if (this.crit && this.age % 2 === 0) game.particles.spawn('p_crit', this.x, this.y, this.z, 0, 0, 0, 8, 0.08);
    if (this.y < -20 || this.age > 1200) this.dead = true;
  }
}

// ray vs entity AABB (grown by pad); returns distance or null
export function rayEntity(ox, oy, oz, dx, dy, dz, e, pad = 0) {
  const hw = e.w / 2 + pad;
  const lo = [e.x - hw, e.y - pad, e.z - hw], hi = [e.x + hw, e.y + e.h + pad, e.z + hw];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  let t0 = 0, t1 = 1e9;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
    } else {
      let a0 = (lo[a] - o[a]) / d[a], a1 = (hi[a] - o[a]) / d[a];
      if (a0 > a1) { const t = a0; a0 = a1; a1 = t; }
      if (a0 > t0) t0 = a0;
      if (a1 < t1) t1 = a1;
      if (t0 > t1) return null;
    }
  }
  return t0;
}

// ---- mobs ---------------------------------------------------------------------------------------
export const MOBS = {
  pig: { w: 0.9, h: 0.9, hp: 10, speed: 0.25, drops: [[I.PORKCHOP, 1, 3]], xp: 2, panic: 1.25 },
  cow: { w: 0.9, h: 1.4, hp: 10, speed: 0.2, drops: [[I.BEEF, 1, 3], [I.LEATHER, 0, 2]], xp: 2, panic: 2 },
  sheep: { w: 0.9, h: 1.3, hp: 8, speed: 0.23, drops: [[I.MUTTON, 1, 2], [B.WOOL, 1, 1]], xp: 2, panic: 1.25 },
  chicken: { w: 0.4, h: 0.7, hp: 4, speed: 0.25, drops: [[I.CHICKEN, 1, 1], [I.FEATHER, 0, 2]], xp: 2, panic: 1.4 },
  zombie: { w: 0.6, h: 1.95, hp: 20, speed: 0.23, hostile: true, dmg: 3, drops: [[I.ROTTEN_FLESH, 0, 2]], burns: true, xp: 5 },
  skeleton: { w: 0.6, h: 1.99, hp: 20, speed: 0.25, hostile: true, dmg: 2, drops: [[I.BONE, 0, 2], [I.ARROW, 0, 2]], burns: true, xp: 5 },
  creeper: { w: 0.6, h: 1.7, hp: 20, speed: 0.25, hostile: true, drops: [[I.GUNPOWDER, 0, 2]], xp: 5 },
  spider: { w: 1.4, h: 0.9, hp: 16, speed: 0.3, hostile: true, dmg: 2, drops: [[I.STRING, 0, 2]], xp: 5, climbs: true },
};

export class Mob extends Living {
  constructor(world, type, x, y, z) {
    super(world, x, y, z);
    this.kind = 'mob';
    this.type = type;
    const d = (this.def = MOBS[type]);
    this.w = d.w; this.h = d.h;
    this.health = this.maxHealth = d.hp;
    this.climbs = !!d.climbs;
    this.yaw = this.pyaw = this.headYaw = this.pheadYaw = rnd() * PI * 2;
    this.state = 'idle';
    this.timer = ri(20, 100);
    this.tx = x; this.tz = z;
    this.attackCd = 0;
    this.attackAnim = 0;
    this.fuse = 0; this.pfuse = 0;
    this.sheared = false; this.woolTimer = 0;
    this.soundTimer = ri(100, 400);
    this.angry = false;
    this.eatAnim = 0;
  }
  eyeHeight() {
    return this.h * 0.85;
  }
  onLand(dist) {
    if (this.type === 'chicken') return;
    const dmg = Math.ceil(dist - 3);
    if (dmg > 0) this.hurt(dmg, { type: 'fall' });
  }
  hurt(amount, source) {
    const ok = super.hurt(amount, source);
    if (ok && this.game) {
      const g = this.game;
      g.audio.play(this.health > 0 ? this.type + '_hurt' : this.type + '_death', this.x, this.y + this.h / 2, this.z, 1, 0.9 + rnd() * 0.2);
      if (!this.def.hostile) { this.state = 'panic'; this.timer = 100; this._pickWander(8); }
      else if (source && source.kind === 'player') this.angry = true;
    }
    return ok;
  }
  onDeath(source) {
    this.deathTime = 1;
    this.killedByPlayer = !!(source && (source.kind === 'player' || (source.owner && source.owner.kind === 'player')));
  }
  _drop(game) {
    for (const [id, a, b] of this.def.drops) {
      if (this.type === 'sheep' && id === B.WOOL && this.sheared) continue;
      const n = ri(a, b);
      if (n > 0) game.dropItem(this.x, this.y + 0.4, this.z, id, n);
    }
    if (this.killedByPlayer) game.player.addXp(this.def.xp || 0);
  }
  _pickWander(range) {
    for (let i = 0; i < 6; i++) {
      const tx = this.x + (rnd() * 2 - 1) * range, tz = this.z + (rnd() * 2 - 1) * range;
      const bx = Math.floor(tx), bz = Math.floor(tz), by = Math.floor(this.y);
      // find ground near current height
      for (let dy = 2; dy >= -3; dy--) {
        const below = this.world.getBlock(bx, by + dy - 1, bz), at = this.world.getBlock(bx, by + dy, bz);
        if (SOLID[below] && !SOLID[at]) {
          if (FLUID[at] && !this.inWater) break;
          this.tx = tx; this.tz = tz;
          return true;
        }
      }
    }
    return false;
  }
  _moveTo(tx, tz, speed) {
    const dx = tx - this.x, dz = tz - this.z;
    const want = Math.atan2(-dx, dz);
    let d = wrapAngle(want - this.yaw);
    d = clamp(d, -0.5, 0.5);
    this.yaw += d;
    const s = this.def.speed * speed;
    this.moveSpeed = s;
    this.moveForward = s;
  }
  _canSee(e) {
    const ex = this.x, ey = this.y + this.eyeHeight(), ez = this.z;
    const tx = e.x, ty = e.y + e.eyeHeight(), tz = e.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez, l = Math.hypot(dx, dy, dz);
    if (l < 0.01) return true;
    return !this.world.raycast(ex, ey, ez, dx / l, dy / l, dz / l, l);
  }
  _lookAt(x, y, z, maxTurn = 0.35) {
    const dx = x - this.x, dz = z - this.z, dy = y - (this.y + this.eyeHeight());
    const want = Math.atan2(-dx, dz);
    this.headYaw += clamp(wrapAngle(want - this.headYaw), -maxTurn, maxTurn);
    this.pitch += clamp(-Math.atan2(dy, Math.hypot(dx, dz)) - this.pitch, -maxTurn, maxTurn);
  }

  tick(game) {
    this.game = game;
    this.baseTick();
    if (this.deathTime > 0) {
      if (++this.deathTime > 20) {
        this.dead = true;
        this._drop(game);
        game.particles.smoke(this.x, this.y + this.h / 2, this.z, 12, this.w);
      }
      this.moveForward = 0;
      this.travel(0, 0);
      return;
    }
    const d = this.def, p = game.player, w = this.world;
    if (this.attackCd > 0) this.attackCd--;
    if (this.attackAnim > 0) this.attackAnim--;
    if (this.eatAnim > 0) this.eatAnim--;
    this.moveForward = 0;
    let jump = false;

    // environment damage
    if (this.inLava) { this.hurt(4, { type: 'lava' }); this.fire = 160; }
    if (this.fire > 0) {
      if (this.inWater) this.fire = 0;
      else {
        if (this.fire % 20 === 0) this.hurt(1, { type: 'fire' });
        this.fire--;
        if (this.age % 3 === 0) game.particles.spawn('p_flame', this.x + (rnd() - 0.5) * this.w, this.y + rnd() * this.h, this.z + (rnd() - 0.5) * this.w, 0, 0.03, 0, 14, 0.12);
      }
    }
    if (d.burns && this.age % 20 === 0 && w.isDay() && !this.inWater && w.canSeeSky(Math.floor(this.x), Math.floor(this.y + this.h), Math.floor(this.z))) this.fire = Math.max(this.fire, 160);
    if (this.inWater && this.eyeInFluid(1, this.y + this.eyeHeight())) {
      if (--this.air <= -20) { this.air = 0; this.hurt(2, { type: 'drown' }); }
    } else this.air = 300;
    if (this.type === 'sheep' && this.sheared && ++this.woolTimer > 2400) { this.sheared = false; this.woolTimer = 0; this.eatAnim = 40; }

    const pd2 = this.dist2(p.x, p.y, p.z);
    const playerOk = p.alive && p.mode !== 'creative' && !game.peaceful;
    if (d.hostile) {
      let chase = false;
      if (playerOk && pd2 < 18 * 18) {
        if (this.type === 'spider' && !this.angry && w.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z)) > 9) chase = false;
        else if (this.state === 'chase' || this._canSee(p)) chase = true;
      }
      if (chase) {
        this.state = 'chase';
        const dist = Math.sqrt(pd2);
        this._lookAt(p.x, p.y + p.eyeHeight(), p.z);
        if (this.type === 'skeleton') {
          if (dist > 9 || !this._canSee(p)) this._moveTo(p.x, p.z, 1);
          else if (dist < 5) { this._moveTo(this.x * 2 - p.x, this.z * 2 - p.z, 0.8); }
          else this.yaw += clamp(wrapAngle(this.headYaw - this.yaw), -0.3, 0.3);
          if (this.attackCd === 0 && dist < 15 && this._canSee(p)) {
            this.attackCd = 45 + ri(0, 20);
            const ax = this.x, ay = this.y + this.eyeHeight() - 0.1, az = this.z;
            const dx = p.x - ax, dz = p.z - az, dy = p.y + p.eyeHeight() * 0.6 - ay;
            const hd = Math.hypot(dx, dz);
            let vx = dx, vy = dy + hd * 0.2, vz = dz;
            const l = Math.hypot(vx, vy, vz);
            const sp = 1.6, jit = 0.0075 * 10;
            vx = (vx / l + (rnd() - 0.5) * jit) * sp; vy = (vy / l + (rnd() - 0.5) * jit) * sp; vz = (vz / l + (rnd() - 0.5) * jit) * sp;
            game.entities.add(new Arrow(w, ax, ay, az, vx, vy, vz, this));
            game.audio.play('bow', this.x, this.y, this.z, 0.8, 0.9 + rnd() * 0.3);
            this.attackAnim = 6;
          }
        } else if (this.type === 'creeper') {
          this.pfuse = this.fuse;
          if (dist < 3) this.fuse++;
          else if (dist > 7 || this.fuse === 0) { if (this.fuse > 0) this.fuse--; this._moveTo(p.x, p.z, 1); }
          else this.fuse++;
          if (this.fuse === 1) game.audio.play('fuse', this.x, this.y, this.z, 1, 0.6);
          if (this.fuse >= 30) {
            this.dead = true;
            w.explode(this.x, this.y + 0.8, this.z, 3, this);
            return;
          }
        } else {
          this._moveTo(p.x, p.z, 1);
          if (this.type === 'spider' && this.onGround && dist > 2 && dist < 4.5 && rnd() < 0.1) {
            const dx = p.x - this.x, dz = p.z - this.z;
            this.vx = (dx / dist) * 0.4 + this.vx * 0.2; this.vz = (dz / dist) * 0.4 + this.vz * 0.2; this.vy = 0.4;
          }
          const reach = this.w / 2 + 0.3 + p.w / 2 + 0.4;
          if (this.attackCd === 0 && Math.hypot(p.x - this.x, p.z - this.z) < reach && Math.abs(p.y - this.y) < 1.6) {
            this.attackCd = 20;
            this.attackAnim = 6;
            p.hurt(d.dmg * game.difficultyScale, this);
          }
        }
        jump = this.collidedH && this.onGround;
      } else {
        if (this.state === 'chase') { this.state = 'idle'; this.timer = 40; }
        if (this.type === 'creeper') { this.pfuse = this.fuse; if (this.fuse > 0) this.fuse--; }
      }
    }
    if (this.state !== 'chase') {
      this.timer--;
      if (this.state === 'idle') {
        if (this.timer <= 0) {
          if (rnd() < 0.7 && this._pickWander(9)) { this.state = 'walk'; this.timer = ri(60, 160); }
          else this.timer = ri(40, 120);
        }
        // glance at the player now and then
        if (pd2 < 49 && (this.age + ((this.x * 7) | 0)) % 200 < 60) this._lookAt(p.x, p.y + p.eyeHeight(), p.z, 0.2);
        else { this.headYaw += clamp(wrapAngle(this.yaw - this.headYaw), -0.1, 0.1); this.pitch *= 0.9; }
      } else {
        const sp = this.state === 'panic' ? d.panic || 1.3 : 0.6;
        const dx = this.tx - this.x, dz = this.tz - this.z;
        if (dx * dx + dz * dz < 0.8 || this.timer <= 0) {
          if (this.state === 'panic' && this.timer > 0) this._pickWander(8);
          else { this.state = 'idle'; this.timer = ri(40, 160); }
        } else {
          this._moveTo(this.tx, this.tz, sp);
          // don't walk off cliffs
          if (this.onGround && this.state !== 'panic') {
            const ax = Math.floor(this.x - Math.sin(this.yaw) * 0.9), az = Math.floor(this.z + Math.cos(this.yaw) * 0.9), ay = Math.floor(this.y);
            let drop = 0;
            while (drop < 4 && !SOLID[w.getBlock(ax, ay - 1 - drop, az)]) drop++;
            if (drop >= 4 || FLUID[w.getBlock(ax, ay - drop, az)] === 2) { this.moveForward = 0; this.state = 'idle'; this.timer = 20; }
          }
          jump = this.collidedH && this.onGround;
        }
        this.headYaw += clamp(wrapAngle(this.yaw - this.headYaw), -0.25, 0.25);
        this.pitch *= 0.8;
      }
    }
    // keep head within a sane range of the body
    const hd = wrapAngle(this.headYaw - this.yaw);
    if (Math.abs(hd) > 1.3) this.headYaw = this.yaw + clamp(hd, -1.3, 1.3);

    if (this.inWater || this.inLava) { if (rnd() < 0.8) this.vy += 0.04; }
    else if (jump && this.jumpTicks === 0) { this.jump(); this.jumpTicks = 10; }
    if (this.type === 'chicken' && !this.onGround && this.vy < 0) this.vy *= 0.6;
    this.travel(0, this.moveForward);

    // ambient sounds
    if (--this.soundTimer <= 0) {
      this.soundTimer = ri(160, 500);
      if (pd2 < 24 * 24) game.audio.play(this.type + '_say', this.x, this.y + this.h / 2, this.z, 0.8, 0.9 + rnd() * 0.2);
    }
    // push apart from the player slightly
    if (pd2 < 0.6 && p.alive) {
      const dx = this.x - p.x, dz = this.z - p.z, l = Math.hypot(dx, dz) || 1;
      this.vx += (dx / l) * 0.05; this.vz += (dz / l) * 0.05;
    }
  }
}

// ---- manager -------------------------------------------------------------------------------------
export class EntityManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.m = m4.create(); this.m2 = m4.create();
    this.light = [1, 1, 1];
    this.spawnTimer = 0;
  }
  add(e) {
    this.list.push(e);
    return e;
  }
  clear() {
    this.list.length = 0;
  }
  spawnMob(type, x, y, z) {
    const m = new Mob(this.game.world, type, x, y, z);
    m.game = this.game;
    return this.add(m);
  }
  tick() {
    const game = this.game, list = this.list, p = game.player;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!game.world.isLoaded(Math.floor(e.x), Math.floor(e.z))) {
        if (e.kind === 'mob' && e.dist2(p.x, p.y, p.z) > 100 * 100) e.dead = true;
        continue;
      }
      e.tick(game);
    }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
    this._spawning();
  }

  _spawning() {
    const game = this.game, w = game.world, p = game.player;
    let hostile = 0, passive = 0;
    for (const e of this.list) {
      if (e.kind !== 'mob') continue;
      const d2 = e.dist2(p.x, p.y, p.z);
      if (e.def.hostile) {
        hostile++;
        if (game.peaceful || d2 > 90 * 90 || (d2 > 34 * 34 && rnd() < 0.002)) e.dead = true;
      } else {
        passive++;
        if (d2 > 110 * 110) e.dead = true;
      }
    }
    if (++this.spawnTimer % 8 !== 0) return;
    // hostile: dark spots 24..60 blocks away
    if (!game.peaceful && hostile < 18) {
      for (let tries = 0; tries < 3; tries++) {
        const a = rnd() * PI * 2, r = 24 + rnd() * 40;
        const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
        if (!w.isLoaded(x, z)) continue;
        const y = this._findSpot(x, ri(4, Math.min(WH - 3, w.topSolidY(x, z) + 1)), z);
        if (y < 0 || w.getLight(x, y, z) > 7) continue;
        if ((w.getLightRaw(x, y, z) & 15) > 3) continue;
        const k = rnd();
        const type = k < 0.4 ? 'zombie' : k < 0.65 ? 'skeleton' : k < 0.85 ? 'creeper' : 'spider';
        const n = type === 'zombie' ? ri(1, 3) : type === 'skeleton' ? ri(1, 2) : 1;
        for (let i = 0; i < n; i++) {
          const sx = x + ri(-2, 2), sz = z + ri(-2, 2), sy = this._findSpot(sx, y, sz);
          if (sy >= 0 && w.getLight(sx, sy, sz) <= 7) this.spawnMob(type, sx + 0.5, sy, sz + 0.5);
        }
        break;
      }
    }
    // passive: on grass in daylight
    if (passive < 14 && (this.spawnTimer % 40 === 0 || passive < 5)) {
      const a = rnd() * PI * 2, r = 20 + rnd() * 44;
      const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
      if (!w.isLoaded(x, z)) return;
      const y = w.topSolidY(x, z);
      if (w.getBlock(x, y, z) !== B.GRASS || (w.getLightRaw(x, y + 1, z) >> 4) < 12) return;
      const biome = w.gen.biomeAt(x, z);
      const opts = biome === BIOME.FOREST || biome === BIOME.BIRCH_FOREST ? ['pig', 'chicken', 'cow', 'pig'] : biome === BIOME.TAIGA || biome === BIOME.SNOWY_TAIGA || biome === BIOME.SNOWY_TUNDRA ? ['sheep', 'cow', 'chicken'] : ['sheep', 'cow', 'pig', 'chicken', 'sheep'];
      const type = opts[(rnd() * opts.length) | 0];
      const n = ri(2, 4);
      for (let i = 0; i < n; i++) {
        const sx = x + ri(-3, 3), sz = z + ri(-3, 3), sy = w.topSolidY(sx, sz);
        if (w.getBlock(sx, sy, sz) === B.GRASS && !SOLID[w.getBlock(sx, sy + 1, sz)] && !SOLID[w.getBlock(sx, sy + 2, sz)]) this.spawnMob(type, sx + 0.5, sy + 1, sz + 0.5);
      }
    }
  }
  // find a standable y at or below the given one (solid opaque floor, two free blocks)
  _findSpot(x, y, z) {
    const w = this.game.world;
    for (let i = 0; i < 12 && y > 1; i++, y--) {
      const below = w.getBlock(x, y - 1, z), a = w.getBlock(x, y, z), b = w.getBlock(x, y + 1, z);
      if (OPAQUE[below] && below !== B.BEDROCK && !SOLID[a] && !SOLID[b] && !FLUID[a] && !FLUID[b]) return y;
    }
    return -1;
  }

  // nearest living entity hit by a ray (for melee targeting)
  pick(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null, bt = maxDist;
    for (const e of this.list) {
      if (e.kind !== 'mob' || !e.alive) continue;
      const t = rayEntity(ox, oy, oz, dx, dy, dz, e, 0.1);
      if (t !== null && t < bt) { bt = t; best = e; }
    }
    return best ? { entity: best, dist: bt } : null;
  }

  render(r, models, alpha) {
    const cam = r.cam, w = this.game.world, m = this.m;
    const maxD2 = 72 * 72;
    for (const e of this.list) {
      const x = lerp(e.px, e.x, alpha) - cam.x, y = lerp(e.py, e.y, alpha) - cam.y, z = lerp(e.pz, e.z, alpha) - cam.z;
      if (x * x + y * y + z * z > maxD2) continue;
      if (!r.frustum.box(x - 1.5, y - 0.5, z - 1.5, x + 1.5, y + 2.5, z + 1.5)) continue;
      const raw = w.getLightRaw(Math.floor(e.x), Math.floor(e.y + e.h * 0.6), Math.floor(e.z));
      m4.identity(m);
      m4.translate(m, m, x, y, z);
      switch (e.kind) {
        case 'item': {
          const t = e.age + alpha;
          const flat = r.isFlatItem(e.stack.id);
          m4.translate(m, m, 0, 0.22 + Math.sin(t / 10 + e.spin) * 0.08, 0);
          m4.rotY(m, m, t / 20 + e.spin);
          const s = flat ? 0.45 : 0.26;
          m4.scale(m, m, s, s, s);
          r.drawItem(e.stack.id, m, raw);
          if (e.stack.count > 1) {
            m4.translate(m, m, 0.25, 0.2, 0.2);
            r.drawItem(e.stack.id, m, raw);
          }
          break;
        }
        case 'falling':
          m4.translate(m, m, 0, 0.5, 0);
          r.drawBlock(e.id, e.meta, m, raw);
          break;
        case 'tnt': {
          m4.translate(m, m, 0, 0.5, 0);
          const f = e.fuse - alpha;
          if (f < 10) { const s = 1 + (1 - f / 10) ** 3 * 0.3; m4.scale(m, m, s, s, s); }
          r.drawBlock(B.TNT, 0, m, raw, ((e.fuse / 5) | 0) % 2 === 0 ? 0.65 : 0);
          break;
        }
        case 'arrow': {
          m4.rotY(m, m, lerpAngle(e.pyaw, e.yaw, alpha));
          m4.rotX(m, m, -lerp(e.ppitch, e.pitch, alpha));
          m4.scale(m, m, 0.9, 0.9, 0.9);
          models.draw('arrow', m, {}, lightRGB(raw, r.sun, r.settings.gamma, this.light));
          break;
        }
        case 'mob': {
          m4.rotY(m, m, -lerpAngle(e.pyaw, e.yaw, alpha));
          let overlay = null;
          if (e.deathTime > 0) {
            const f = Math.min(1, ((e.deathTime + alpha - 1) / 20) * 1.6);
            m4.rotZ(m, m, Math.sqrt(f) * PI / 2);
          }
          if (e.hurtTime > 0 || e.deathTime > 0) overlay = [1, 0, 0, 0.45];
          if (e.type === 'creeper' && e.fuse > 0) {
            const f = lerp(e.pfuse, e.fuse, alpha) / 28;
            const s = 1 + Math.sin(f * 100) * f * 0.01 + f * f * f * 0.35;
            m4.scale(m, m, s, 1 + f * f * 0.1, s);
            if (!overlay && ((f * 10) | 0) % 2 === 0) overlay = [1, 1, 1, 0.5 * Math.min(1, f + 0.3)];
          }
          const light = lightRGB(e.fire > 0 ? raw | 0x0c : raw, r.sun, r.settings.gamma, this.light);
          const pose = models.poseFor(e.type, e, alpha);
          models.draw(e.type, m, pose, light, overlay, e.type === 'sheep' && !e.sheared ? ['wool'] : null);
          break;
        }
      }
    }
  }
}
