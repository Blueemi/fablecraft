// The player: input-driven movement, survival stats, mining, placing and item use.
import { Living } from './entity.js';
import { B, blocks, SH, SHAPE, SOLID, OPAQUE, FLUID, REPLACEABLE, WH, FACING_DX, FACING_DZ, getBoxes, isSapling, isLeaves } from './blocks.js';
import { I, items, maxStack, getDrops, canHarvest, digSpeed, blockXp } from './items.js';
import { ItemEntity, Arrow, PrimedTNT } from './mobs.js';
import { clamp } from './math.js';

const PI = Math.PI;
const rnd = Math.random;

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null); // 0-8 hotbar, 9-35 main
    this.armor = new Array(4).fill(null);
    this.selected = 0;
  }
  held() {
    return this.slots[this.selected];
  }
  // returns the number of items that did not fit
  add(stack) {
    let left = stack.count;
    const max = maxStack(stack.id);
    if (max > 1 && !stack.dmg) {
      for (let i = 0; i < 36 && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === stack.id && !s.dmg && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { id: stack.id, count: n, dmg: stack.dmg || 0 };
        left -= n;
      }
    }
    return left;
  }
  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }
  remove(id, n) {
    for (let i = 35; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(n, s.count);
        s.count -= k;
        n -= k;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return n === 0;
  }
  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
  }
  armorPoints() {
    let p = 0;
    for (const s of this.armor) if (s) p += items[s.id].armor.pts;
    return p;
  }
}

export class Player extends Living {
  constructor(game, world) {
    super(world, 0, 80, 0);
    this.kind = 'player';
    this.game = game;
    this.w = 0.6; this.h = 1.8;
    this.inv = new Inventory();
    this.mode = 'survival';
    this.food = 20; this.saturation = 5; this.exhaustion = 0; this.foodTimer = 0;
    this.xpLevel = 0; this.xpProgress = 0; this.xpTotal = 0;
    this.spawn = null;
    this.eyeH = 1.62; this.peyeH = 1.62;
    this.bob = 0; this.pbob = 0; this.walkDist = 0; this.pwalkDist = 0;
    this.swing = 0; this.pswing = 0; this.swinging = false; this.swingTicks = 0;
    this.equip = 1; this.pequip = 1; this.equipId = -1;
    this.breaking = null; this.breakProgress = 0; this.hitDelay = 0; this.useDelay = 0;
    this.usingItem = 0; this.useKind = null;
    this.stepDist = 0; this.nextStep = 1;
    this.lastW = -100; this.lastSpace = -100; this.wWasDown = false; this.spaceWasDown = false;
    this.hurtYaw = 0; this.fovMod = 1; this.pfovMod = 1;
    this.sleeping = 0;
    this.wasInWater = false;
    this.deathMsg = '';
    this.tickCount = 0;
  }
  get creative() {
    return this.mode === 'creative';
  }
  eyeHeight() {
    return this.eyeH;
  }
  swingAnim(alpha) {
    let d = this.swing - this.pswing;
    if (d < 0) d += 1;
    return this.pswing + d * alpha;
  }
  swingArm() {
    if (!this.swinging || this.swingTicks >= 3 || this.swingTicks < 0) {
      this.swingTicks = -1;
      this.swinging = true;
    }
  }
  held() {
    return this.inv.held();
  }
  heldDef() {
    const s = this.inv.held();
    return s ? items[s.id] : null;
  }
  lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp];
  }
  facing() {
    return Math.floor((this.yaw / (PI / 2)) + 0.5) & 3;
  }

  move(dx, dy, dz) {
    if (this.sneaking && this.onGround && !this.flying && !this.noClip) {
      const st = 0.05;
      const shrink = (v) => (Math.abs(v) < st ? 0 : v - Math.sign(v) * st);
      while (dx !== 0 && this.isFree(dx, -1, 0)) dx = shrink(dx);
      while (dz !== 0 && this.isFree(0, -1, dz)) dz = shrink(dz);
      while (dx !== 0 && dz !== 0 && this.isFree(dx, -1, dz)) { dx = shrink(dx); dz = shrink(dz); }
    }
    super.move(dx, dy, dz);
  }
  onLand(dist) {
    if (this.creative || this.inWater) return;
    const dmg = Math.ceil(dist - 3);
    if (dmg > 0) {
      this.hurt(dmg, { type: 'fall' });
      this.game.audio.play('fall', this.x, this.y, this.z, dmg > 4 ? 1 : 0.6);
      const b = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
      if (b) for (let i = 0; i < 6; i++) this.game.particles.blockHit(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z), 0, 1, 0, b);
    }
  }
  addExhaustion(v) {
    if (!this.creative) this.exhaustion = Math.min(40, this.exhaustion + v);
  }
  xpForLevel(l) {
    return l < 16 ? 2 * l + 7 : l < 31 ? 5 * l - 38 : 9 * l - 158;
  }
  addXp(n) {
    if (n <= 0) return;
    this.xpTotal += n;
    this.xpProgress += n / this.xpForLevel(this.xpLevel);
    this.game.audio.play('orb', undefined, 0, 0, 0.25, 0.9 + rnd() * 0.5);
    while (this.xpProgress >= 1) {
      this.xpProgress = (this.xpProgress - 1) * this.xpForLevel(this.xpLevel);
      this.xpLevel++;
      this.xpProgress /= this.xpForLevel(this.xpLevel);
      if (this.xpLevel % 5 === 0) this.game.audio.play('levelup', undefined, 0, 0, 0.5);
    }
  }
  heal(n) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }
  hurt(amount, source = null) {
    if (this.creative || !this.alive || this.invul > 10) return false;
    const g = this.game;
    const env = source && source.type;
    if (!env || env === 'explosion') {
      // armour absorbs 4% per point for direct hits
      const pts = this.inv.armorPoints();
      amount = amount * (1 - pts * 0.04);
      for (let i = 0; i < 4; i++) {
        const s = this.inv.armor[i];
        if (s && ++s.dmg >= items[s.id].dur) { this.inv.armor[i] = null; g.audio.play('break', this.x, this.y, this.z); }
      }
    }
    if (amount <= 0) return false;
    this.health -= amount;
    this.hurtTime = 10;
    this.invul = 20;
    this.addExhaustion(0.1);
    if (source && source.x !== undefined) {
      this.knockback(source.x, source.z);
      this.hurtYaw = Math.atan2(source.z - this.z, source.x - this.x) - this.yaw;
    } else this.hurtYaw = 0;
    g.audio.play('hurt', this.x, this.y + 1, this.z, 1, 0.95 + rnd() * 0.1);
    g.ui.dirty = true;
    if (this.health <= 0) {
      this.health = 0;
      this.onDeath(source);
    }
    return true;
  }
  onDeath(source) {
    const g = this.game, name = 'Player';
    const t = source && (source.type || (source.def && source.type));
    const mobName = source && source.def ? source.type[0].toUpperCase() + source.type.slice(1) : null;
    this.deathMsg = mobName ? (mobName === 'Creeper' ? `${name} was blown up by Creeper` : mobName === 'Skeleton' ? `${name} was shot by Skeleton` : `${name} was slain by ${mobName}`)
      : t === 'fall' ? `${name} fell from a high place` : t === 'lava' ? `${name} tried to swim in lava` : t === 'fire' ? `${name} burned to death`
      : t === 'drown' ? `${name} drowned` : t === 'void' ? `${name} fell out of the world` : t === 'starve' ? `${name} starved to death`
      : t === 'explosion' ? `${name} blew up` : t === 'cactus' ? `${name} was pricked to death` : `${name} died`;
    this.deathTime = 1;
    // scatter the inventory
    const all = [...this.inv.slots, ...this.inv.armor];
    for (const s of all) {
      if (!s) continue;
      const e = g.entities.add(new ItemEntity(this.world, this.x, this.y + 1, this.z, s));
      const a = rnd() * PI * 2, f = rnd() * 0.3;
      e.vx = Math.cos(a) * f; e.vz = Math.sin(a) * f; e.vy = 0.25; e.pickupDelay = 40;
    }
    this.inv.clear();
    this.xpLevel = 0; this.xpProgress = 0; this.xpTotal = 0;
    this.breaking = null; this.usingItem = 0;
    g.ui.showDeath(this.deathMsg);
  }
  respawn() {
    const g = this.game;
    const s = this.spawn || g.worldSpawn;
    this.setPos(s.x, s.y, s.z);
    this.vx = this.vy = this.vz = 0;
    this.health = this.maxHealth;
    this.food = 20; this.saturation = 5; this.exhaustion = 0;
    this.deathTime = 0; this.hurtTime = 0; this.fire = 0; this.air = 300; this.fallDist = 0;
    this.dead = false;
    g.ui.dirty = true;
  }

  // ---- per-tick update ---------------------------------------------------------------------
  tick(input) {
    const g = this.game, w = this.world;
    this.tickCount++;
    this.baseTick();
    this.pbob = this.bob; this.pwalkDist = this.walkDist; this.pswing = this.swing; this.pequip = this.equip; this.peyeH = this.eyeH; this.pfovMod = this.fovMod;
    if (!this.alive) {
      this.deathTime++;
      this.vx *= 0.9; this.vz *= 0.9;
      this.moveForward = 0;
      this.travel(0, 0);
      return;
    }
    if (this.sleeping > 0) {
      if (++this.sleeping > 60) {
        this.sleeping = 0;
        w.dayTime = 0;
        g.ui.fade(false);
      }
      return;
    }
    const active = input.active;
    let f = 0, s = 0;
    const fwd = active && input.down('KeyW'), jump = active && input.down('Space'), sneak = active && input.down('ShiftLeft');
    if (active) {
      f = (fwd ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      s = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    }
    // sprint: double-tap forward or hold the sprint key
    if (fwd && !this.wWasDown) {
      if (this.tickCount - this.lastW < 7 && !this.sneaking) this.sprinting = true;
      this.lastW = this.tickCount;
    }
    this.wWasDown = fwd;
    if (active && (input.down('ControlLeft') || input.down('KeyR')) && f > 0) this.sprinting = true;
    if (this.sprinting && (f <= 0 || this.collidedH || sneak || this.usingItem > 0 || (this.food <= 6 && !this.creative))) this.sprinting = false;
    // creative flight: double-tap jump
    if (jump && !this.spaceWasDown) {
      if (this.creative && this.tickCount - this.lastSpace < 7) { this.flying = !this.flying; this.lastSpace = -100; }
      else this.lastSpace = this.tickCount;
    }
    this.spaceWasDown = jump;
    if (!this.creative) this.flying = false;
    if (this.flying && this.onGround) this.flying = false;
    this.sneaking = sneak && !this.flying;
    this.eyeH += ((this.sneaking ? 1.54 : 1.62) - this.eyeH) * 0.5;

    f *= 0.98; s *= 0.98;
    if (this.sneaking) { f *= 0.3; s *= 0.3; }
    if (this.usingItem > 0) { f *= 0.2; s *= 0.2; }
    this.moveSpeed = 0.1 * (this.sprinting ? 1.3 : 1);
    this.airSpeed = this.flying ? 0.05 * (this.sprinting ? 2 : 1) : this.sprinting ? 0.026 : 0.02;

    if (jump) {
      if (this.flying) { /* handled below */ }
      else if (this.inWater || this.inLava) this.vy += 0.04;
      else if (this.onGround && this.jumpTicks === 0) {
        this.jump();
        this.jumpTicks = 10;
        this.addExhaustion(this.sprinting ? 0.2 : 0.05);
      }
    } else this.jumpTicks = 0;

    const ox = this.x, oy = this.y, oz = this.z;
    if (this.flying) {
      if (jump) this.vy += 0.15;
      if (sneak) this.vy -= 0.15;
      const vy = this.vy;
      this.travel(s, f);
      this.vy = vy * 0.6;
      this.fallDist = 0;
    } else this.travel(s, f);

    // distance-based effects
    const dx = this.x - ox, dz = this.z - oz, hd = Math.hypot(dx, dz);
    if (this.inWater) this.addExhaustion(hd * 0.015);
    else if (this.onGround) this.addExhaustion(hd * (this.sprinting ? 0.1 : 0.01));
    const targetBob = this.onGround && !this.flying ? Math.min(0.1, hd) : 0;
    this.bob += (targetBob - this.bob) * 0.4;
    this.walkDist += hd * 0.6;
    if (this.onGround && !this.sneaking && hd > 0.001) {
      this.stepDist += hd * 0.6;
      if (this.stepDist > this.nextStep) {
        this.nextStep = Math.floor(this.stepDist) + 1;
        let by = Math.floor(this.y - 0.2);
        let b = w.getBlock(Math.floor(this.x), by, Math.floor(this.z));
        const above = w.getBlock(Math.floor(this.x), by + 1, Math.floor(this.z));
        if (above === B.SNOW_LAYER) b = above;
        if (b && !FLUID[b]) g.audio.play('step_' + blocks[b].sound, this.x, this.y, this.z, 0.5);
      }
    } else if (this.inWater && hd > 0.02) {
      this.stepDist += hd * 0.6;
      if (this.stepDist > this.nextStep) { this.nextStep = Math.floor(this.stepDist) + 2; g.audio.play('swim', this.x, this.y, this.z, 0.4, 0.8 + rnd() * 0.4); }
    }
    if (this.inWater && !this.wasInWater && this.vy < -0.15) {
      g.audio.play('splash', this.x, this.y, this.z, 0.7);
      g.particles.splash(this.x, Math.floor(this.y) + 0.95, this.z, 16, 0.4);
    }
    this.wasInWater = this.inWater;
    // fov follows speed
    let fm = 1;
    if (this.flying) fm *= 1.1;
    fm *= (this.moveSpeed / 0.1 + 1) / 2;
    if (this.useKind === 'bow' && this.usingItem > 0) { let c = Math.min(1, this.usingItem / 20); c *= c; fm *= 1 - c * 0.15; }
    this.fovMod += (fm - this.fovMod) * 0.5;

    this._survival();
    this._swingTick();
    this._interact(input);
  }

  _survival() {
    const g = this.game, w = this.world;
    if (this.creative) { this.air = 300; this.fire = 0; return; }
    // hunger
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (!g.peaceful) { this.food = Math.max(0, this.food - 1); g.ui.dirty = true; }
    }
    if (g.peaceful) {
      if (this.health < this.maxHealth && this.tickCount % 20 === 0) { this.heal(1); g.ui.dirty = true; }
      if (this.food < 20 && this.tickCount % 10 === 0) { this.food++; g.ui.dirty = true; }
    }
    if (this.food >= 18 && this.health < this.maxHealth) {
      if (++this.foodTimer >= 80) { this.heal(1); this.addExhaustion(3); this.foodTimer = 0; g.ui.dirty = true; }
    } else if (this.food <= 0) {
      if (++this.foodTimer >= 80) { if (this.health > 1) this.hurt(1, { type: 'starve' }); this.foodTimer = 0; }
    } else this.foodTimer = 0;
    // air
    if (this.eyeInFluid(1, this.y + this.eyeH)) {
      if (--this.air <= -20) {
        this.air = 0;
        g.particles.bubbles(this.x, this.y + this.eyeH, this.z, 8);
        this.hurt(2, { type: 'drown' });
      }
      if (this.air % 20 === 0) g.ui.dirty = true;
    } else if (this.air < 300) { this.air = 300; g.ui.dirty = true; }
    // fire / lava / cactus
    if (this.inLava) { this.hurt(4, { type: 'lava' }); this.fire = 300; }
    const hw = this.w / 2 + 0.01;
    const touch = (id) => w.blockIn(this.x - hw, this.y - 0.01, this.z - hw, this.x + hw, this.y + this.h, this.z + hw, (b) => b === id);
    if (touch(B.FIRE)) { this.hurt(1, { type: 'fire' }); this.fire = Math.max(this.fire, 160); }
    if (this.fire > 0) {
      if (this.inWater) { this.fire = 0; g.audio.play('fizz', this.x, this.y, this.z, 0.5, 1.6); }
      else { if (this.fire % 20 === 0) this.hurt(1, { type: 'fire' }); this.fire--; }
    }
    if (this.tickCount % 10 === 0 && touch(B.CACTUS)) this.hurt(1, { type: 'cactus' });
  }

  _swingTick() {
    if (this.swinging) {
      if (++this.swingTicks >= 6) { this.swingTicks = 0; this.swinging = false; }
    } else this.swingTicks = 0;
    this.swing = this.swingTicks / 6;
    // equip animation when the held item changes
    const s = this.held(), id = s ? s.id : 0;
    if (id !== this.equipId) {
      this.equip = Math.max(0, this.equip - 0.4);
      if (this.equip === 0) this.equipId = id;
    } else this.equip = Math.min(1, this.equip + 0.4);
  }

  // ---- interaction -------------------------------------------------------------------------
  _strength(id) {
    const d = blocks[id];
    if (d.hard < 0) return 0;
    if (d.hard === 0) return 1;
    const tool = this.heldDef();
    let s = digSpeed(id, tool);
    if (this.eyeInFluid(1, this.y + this.eyeH)) s /= 5;
    if (!this.onGround) s /= 5;
    return s / d.hard / (canHarvest(id, tool) ? 30 : 100);
  }
  _damageTool(n = 1) {
    const s = this.held();
    if (!s || this.creative) return;
    const d = items[s.id];
    if (!d.dur) return;
    s.dmg = (s.dmg || 0) + n;
    if (s.dmg >= d.dur) {
      this.inv.slots[this.inv.selected] = null;
      this.game.audio.play('break', this.x, this.y + 1, this.z, 0.8);
    }
    this.game.ui.dirty = true;
  }
  _consumeHeld() {
    if (this.creative) return;
    const s = this.held();
    if (s && --s.count <= 0) this.inv.slots[this.inv.selected] = null;
    this.game.ui.dirty = true;
  }

  breakBlock(x, y, z) {
    const g = this.game, w = this.world;
    const id = w.getBlock(x, y, z), meta = w.getMeta(x, y, z);
    if (!id || blocks[id].hard < 0) return;
    const tool = this.heldDef();
    g.audio.play('dig_' + blocks[id].sound, x + 0.5, y + 0.5, z + 0.5, 1);
    w.dropBlockEntity(x, y, z);
    w.setBlock(x, y, z, 0);
    g.particles.blockBreak(x, y, z, id);
    if (id === B.ICE && !this.creative) {
      const below = w.getBlock(x, y - 1, z);
      if (SOLID[below] || FLUID[below]) { w.setBlock(x, y, z, B.WATER, 0); w.schedule(x, y, z, 5); }
    }
    if (!this.creative) {
      for (const s of getDrops(id, meta, tool)) g.dropItem(x + 0.5, y + 0.4, z + 0.5, s.id, s.count);
      if (canHarvest(id, tool)) this.addXp(blockXp(id));
      if (blocks[id].hard > 0 && tool && tool.dur && tool.tool) this._damageTool(tool.tool === 'sword' ? 2 : 1);
      this.addExhaustion(0.025);
    }
  }

  attack(e) {
    const g = this.game;
    const tool = this.heldDef();
    let dmg = tool && tool.dmg ? tool.dmg : 1;
    const crit = this.fallDist > 0 && !this.onGround && !this.inWater && !this.onLadder();
    if (crit) dmg *= 1.5;
    this.swingArm();
    if (e.hurt(dmg, this)) {
      if (this.sprinting) { e.knockback(this.x, this.z, 0.5); this.sprinting = false; }
      if (crit) g.particles.crit(e.x, e.y, e.z, e.w, e.h);
      g.audio.play('attack', e.x, e.y + e.h / 2, e.z, 0.7, 0.9 + rnd() * 0.3);
      if (tool && tool.dur && tool.tool) this._damageTool(tool.tool === 'sword' ? 1 : 2);
      this.addExhaustion(0.3);
    }
  }

  _interact(input) {
    const g = this.game, w = this.world;
    const t = g.target;
    if (this.hitDelay > 0) this.hitDelay--;
    if (this.useDelay > 0) this.useDelay--;
    if (!input.active) { this.breaking = null; this.breakProgress = 0; this._stopUsing(false); input.clearClicks(); return; }

    // hotbar selection
    for (let i = 0; i < 9; i++) if (input.pressed('Digit' + (i + 1))) { this.inv.selected = i; g.ui.onSelect(); }
    if (input.wheel) {
      this.inv.selected = (((this.inv.selected + Math.sign(input.wheel)) % 9) + 9) % 9;
      input.wheel = 0;
      g.ui.onSelect();
    }
    if (input.pressed('KeyQ')) this.dropHeld(input.down('ControlLeft'));

    // ---- attack / mine ----
    const clickL = input.takeClick(0);
    if (clickL) {
      this.swingArm();
      if (t && t.entity) { this.attack(t.entity); this.breaking = null; }
      else if (t && this.creative) { this.breakBlock(t.x, t.y, t.z); this.hitDelay = 5; }
      else if (!t) g.audio.play('sweep', undefined, 0, 0, 0.15);
    }
    if (input.mouse[0] && t && !t.entity) {
      if (this.creative) {
        if (this.hitDelay === 0 && !clickL) { this.swingArm(); this.breakBlock(t.x, t.y, t.z); this.hitDelay = 5; }
      } else if (this.hitDelay === 0) {
        if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z) {
          this.breaking = { x: t.x, y: t.y, z: t.z, ticks: 0 };
          this.breakProgress = 0;
        }
        const st = this._strength(t.id);
        this.breakProgress += st;
        this.swingArm();
        if (this.breaking.ticks++ % 4 === 0) g.audio.play('step_' + blocks[t.id].sound, t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.35, 0.5);
        g.particles.blockHit(t.x, t.y, t.z, t.nx, t.ny, t.nz, t.id);
        if (this.breakProgress >= 1) {
          this.breakBlock(t.x, t.y, t.z);
          this.breaking = null;
          this.breakProgress = 0;
          if (st < 1) this.hitDelay = 5;
        }
      }
    } else { this.breaking = null; this.breakProgress = 0; }

    // ---- pick block ----
    if (input.takeClick(1) && t && !t.entity) this.pickBlock(t.id);

    // ---- use / place ----
    const clickR = input.takeClick(2);
    if (this.usingItem > 0) {
      if (!input.mouse[2]) this._stopUsing(true);
      else this._usingTick();
    } else if ((clickR || (input.mouse[2] && this.useDelay === 0))) {
      this.useDelay = 4;
      this._use(t, clickR);
    }
  }

  dropHeld(all) {
    const s = this.held();
    if (!s) return;
    const n = all ? s.count : 1;
    const d = this.lookDir();
    const e = this.game.entities.add(new ItemEntity(this.world, this.x, this.y + this.eyeH - 0.3, this.z, { id: s.id, count: n, dmg: s.dmg || 0 }));
    e.vx = d[0] * 0.3; e.vy = d[1] * 0.3 + 0.1; e.vz = d[2] * 0.3;
    e.pickupDelay = 40;
    s.count -= n;
    if (s.count <= 0) this.inv.slots[this.inv.selected] = null;
    this.swingArm();
    this.game.ui.dirty = true;
  }
  pickBlock(id) {
    if (id === B.FURNACE_LIT) id = B.FURNACE;
    if (id === B.WHEAT) id = I.WHEAT_SEEDS;
    if (id === B.FARMLAND) id = B.DIRT;
    if (!items[id] || items[id].hidden) return;
    const inv = this.inv;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === id) { inv.selected = i; this.game.ui.onSelect(); return; }
    for (let i = 9; i < 36; i++) {
      if (inv.slots[i] && inv.slots[i].id === id) {
        const t = inv.slots[inv.selected];
        inv.slots[inv.selected] = inv.slots[i];
        inv.slots[i] = t;
        this.game.ui.onSelect();
        return;
      }
    }
    if (this.creative) {
      let slot = inv.selected;
      if (inv.slots[slot]) for (let i = 0; i < 9; i++) if (!inv.slots[i]) { slot = i; break; }
      inv.slots[slot] = { id, count: 1, dmg: 0 };
      inv.selected = slot;
      this.game.ui.onSelect();
    }
  }

  _stopUsing(release) {
    if (this.usingItem > 0 && release && this.useKind === 'bow') {
      const g = this.game, t = this.usingItem;
      let f = t / 20;
      f = (f * f + f * 2) / 3;
      if (f >= 0.1 && (this.creative || this.inv.count(I.ARROW) > 0)) {
        if (f > 1) f = 1;
        const d = this.lookDir(), sp = f * 3;
        const a = new Arrow(this.world, this.x + d[0] * 0.3, this.y + this.eyeH - 0.1, this.z + d[2] * 0.3, d[0] * sp + this.vx, d[1] * sp, d[2] * sp + this.vz, this);
        a.crit = f >= 1;
        g.entities.add(a);
        g.audio.play('bow', this.x, this.y + 1, this.z, 1, 1 / (rnd() * 0.4 + 1.2) + f * 0.5);
        if (!this.creative) this.inv.remove(I.ARROW, 1);
        this._damageTool(1);
      }
    }
    this.usingItem = 0;
    this.useKind = null;
  }
  _usingTick() {
    const g = this.game, s = this.held();
    if (!s) { this._stopUsing(false); return; }
    const d = items[s.id];
    this.usingItem++;
    if (this.useKind === 'eat') {
      if (!d.food) { this._stopUsing(false); return; }
      if (this.usingItem % 4 === 0 && this.usingItem > 6) {
        g.audio.play('eat', this.x, this.y + 1.5, this.z, 0.6, 0.8 + rnd() * 0.4);
        const dir = this.lookDir();
        const layer = g.renderer.isFlatItem(s.id) ? null : null;
        g.particles.spawn('p_white', this.x + dir[0] * 0.4, this.y + this.eyeH - 0.25, this.z + dir[2] * 0.4, (rnd() - 0.5) * 0.08, 0.05, (rnd() - 0.5) * 0.08, 8, 0.03, { r: 0.8, g: 0.55, b: 0.3, grav: 1 });
      }
      if (this.usingItem >= 32) {
        this.food = Math.min(20, this.food + d.food.hunger);
        this.saturation = Math.min(this.food, this.saturation + d.food.sat);
        if (s.id === I.GOLDEN_APPLE) this.heal(8);
        g.audio.play('burp', this.x, this.y + 1.5, this.z, 0.5, 0.9 + rnd() * 0.2);
        this._consumeHeld();
        if (s.id === I.MUSHROOM_STEW && !this.creative) this.inv.slots[this.inv.selected] = { id: I.BOWL, count: 1, dmg: 0 };
        this._stopUsing(false);
        this.useDelay = 6;
        g.ui.dirty = true;
      }
    }
  }

  _use(t, fresh) {
    const g = this.game, w = this.world;
    const s = this.held(), d = s ? items[s.id] : null;
    // 1. interactive blocks
    if (t && !t.entity && !this.sneaking) {
      if (this._activate(t)) { this.swingArm(); return; }
    }
    // 2. entity interaction
    if (t && t.entity) {
      const e = t.entity;
      if (d && d.tool === 'shears' && e.type === 'sheep' && !e.sheared) {
        e.sheared = true; e.woolTimer = 0;
        g.dropItem(e.x, e.y + 0.8, e.z, B.WOOL, 1 + ((rnd() * 3) | 0));
        g.audio.play('shear', e.x, e.y, e.z, 0.8);
        this._damageTool(1);
        this.swingArm();
      }
      return;
    }
    if (!s) return;
    // 3. items used on blocks
    if (t) {
      if (this._useOnBlock(t, s, d)) { this.swingArm(); return; }
    }
    // 4. items used in the air
    if (d.food) {
      if (this.food < 20 || d.always || this.creative) { this.usingItem = 1; this.useKind = 'eat'; }
      return;
    }
    if (s.id === I.BOW) {
      if (this.creative || this.inv.count(I.ARROW) > 0) { this.usingItem = 1; this.useKind = 'bow'; }
      return;
    }
    if (s.id === I.BUCKET || s.id === I.WATER_BUCKET || s.id === I.LAVA_BUCKET) {
      if (fresh && this._bucket(s)) this.swingArm();
      return;
    }
    if (d.armor && fresh) {
      const slot = d.armor.slot;
      const cur = this.inv.armor[slot];
      this.inv.armor[slot] = s;
      this.inv.slots[this.inv.selected] = cur;
      g.audio.play('place_cloth', this.x, this.y + 1, this.z, 0.6);
      g.ui.dirty = true;
    }
  }

  _activate(t) {
    const g = this.game, w = this.world;
    switch (t.id) {
      case B.CRAFTING_TABLE: g.ui.openContainer('crafting'); return true;
      case B.FURNACE: case B.FURNACE_LIT: g.ui.openContainer('furnace', w.getBlockEntity(t.x, t.y, t.z, true)); return true;
      case B.CHEST:
        g.audio.play('chest', t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.7);
        g.ui.openContainer('chest', w.getBlockEntity(t.x, t.y, t.z, true));
        return true;
      case B.DOOR: {
        const by = t.meta & 8 ? t.y - 1 : t.y;
        const m = w.getMeta(t.x, by, t.z) ^ 4;
        w.setBlock(t.x, by, t.z, B.DOOR, m & 7, 0);
        w.setBlock(t.x, by + 1, t.z, B.DOOR, (m & 7) | 8, 0);
        g.audio.play('door', t.x + 0.5, by + 1, t.z + 0.5, 0.8, m & 4 ? 1 : 0.85);
        return true;
      }
      case B.BED: {
        this.spawn = { x: this.x, y: this.y, z: this.z };
        if (w.dayTime > 12500 && w.dayTime < 23500) {
          this.sleeping = 1;
          g.ui.fade(true);
          g.chat('Sleeping... Respawn point set.');
        } else g.chat('You can only sleep at night. Respawn point set.');
        return true;
      }
    }
    return false;
  }

  _bucket(s) {
    const g = this.game, w = this.world;
    const d = this.lookDir(), ex = this.x, ey = this.y + this.eyeH, ez = this.z;
    if (s.id === I.BUCKET) {
      const h = w.raycast(ex, ey, ez, d[0], d[1], d[2], 5, true);
      if (!h || !FLUID[h.id]) return false;
      w.setBlock(h.x, h.y, h.z, 0);
      const full = h.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET;
      g.audio.play('swim', h.x, h.y, h.z, 0.6, 1.3);
      if (!this.creative) {
        if (s.count === 1) this.inv.slots[this.inv.selected] = { id: full, count: 1, dmg: 0 };
        else { s.count--; if (this.inv.add({ id: full, count: 1 }) > 0) g.dropItem(this.x, this.y + 1, this.z, full, 1); }
      }
      g.ui.dirty = true;
      return true;
    }
    const h = w.raycast(ex, ey, ez, d[0], d[1], d[2], 5);
    if (!h) return false;
    let x = h.x, y = h.y, z = h.z;
    if (!REPLACEABLE[h.id]) { x += h.nx; y += h.ny; z += h.nz; }
    const at = w.getBlock(x, y, z);
    if (SOLID[at] || y < 0 || y >= WH) return false;
    const fluid = s.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
    w.setBlock(x, y, z, fluid, 0);
    w.schedule(x, y, z, fluid === B.WATER ? 5 : 30);
    g.audio.play('splash', x, y, z, 0.5, 1.3);
    if (!this.creative) this.inv.slots[this.inv.selected] = { id: I.BUCKET, count: 1, dmg: 0 };
    g.ui.dirty = true;
    return true;
  }

  _useOnBlock(t, s, d) {
    const g = this.game, w = this.world;
    const ax = t.x + t.nx, ay = t.y + t.ny, az = t.z + t.nz;
    switch (s.id) {
      case I.FLINT_AND_STEEL:
        if (t.id === B.TNT) {
          w.setBlock(t.x, t.y, t.z, 0);
          g.spawnTNT(t.x, t.y, t.z, 80);
        } else if (w.getBlock(ax, ay, az) === 0) {
          w.setBlock(ax, ay, az, B.FIRE, 0);
          w.schedule(ax, ay, az, 30);
        } else return false;
        g.audio.play('fire', ax + 0.5, ay + 0.5, az + 0.5, 0.8);
        this._damageTool(1);
        return true;
      case I.BONE_MEAL: {
        let ok = false;
        if (isSapling(t.id)) { ok = true; if (rnd() < 0.45) w.growTree(t.x, t.y, t.z); }
        else if (t.id === B.WHEAT && (t.meta & 7) < 7) { ok = true; w.setMeta(t.x, t.y, t.z, Math.min(7, (t.meta & 7) + 2 + ((rnd() * 3) | 0))); }
        else if (t.id === B.GRASS) {
          ok = true;
          for (let i = 0; i < 24; i++) {
            const x = t.x + ((rnd() * 7) | 0) - 3, z = t.z + ((rnd() * 7) | 0) - 3;
            for (let y = t.y + 1; y >= t.y - 1; y--) {
              if (w.getBlock(x, y, z) === B.GRASS && w.getBlock(x, y + 1, z) === 0) {
                const k = rnd();
                w.setBlock(x, y + 1, z, k < 0.8 ? B.TALL_GRASS : [B.DANDELION, B.POPPY, B.CORNFLOWER, B.DAISY, B.ALLIUM][(rnd() * 5) | 0]);
                break;
              }
            }
          }
        }
        if (ok) { g.particles.bonemeal(t.x, t.y, t.z); this._consumeHeld(); }
        return ok;
      }
      case I.WHEAT_SEEDS:
        if (t.id === B.FARMLAND && t.ny === 1 && w.getBlock(t.x, t.y + 1, t.z) === 0) {
          w.setBlock(t.x, t.y + 1, t.z, B.WHEAT, 0);
          g.audio.play('place_grass', t.x + 0.5, t.y + 1, t.z + 0.5, 0.6);
          this._consumeHeld();
          return true;
        }
        return false;
      case I.BUCKET: case I.WATER_BUCKET: case I.LAVA_BUCKET:
        return false;
    }
    if (d.tool === 'hoe') {
      if ((t.id === B.GRASS || t.id === B.DIRT) && t.ny !== -1 && w.getBlock(t.x, t.y + 1, t.z) === 0) {
        w.setBlock(t.x, t.y, t.z, B.FARMLAND, 0);
        g.audio.play('dig_gravel', t.x + 0.5, t.y + 1, t.z + 0.5, 0.7);
        this._damageTool(1);
        return true;
      }
      return false;
    }
    if (d.block !== undefined) return this._place(t, s, d.block);
    return false;
  }

  _place(t, s, id) {
    const g = this.game, w = this.world;
    const d = blocks[id];
    let x = t.x, y = t.y, z = t.z;
    const fy = t.hy - t.y; // hit height within the block
    const dir = this.facing();
    let meta = 0;
    // slabs combine into full blocks
    if (d.shape === SH.SLAB && t.id === id) {
      const tm = t.meta & 1;
      if ((tm === 0 && t.ny === 1) || (tm === 1 && t.ny === -1)) {
        if (this._blocked(x, y, z, d.full, 0)) return false;
        w.setBlock(x, y, z, d.full, 0);
        return this._placed(x, y, z, id);
      }
    }
    if (!REPLACEABLE[t.id] || t.id === id) { x += t.nx; y += t.ny; z += t.nz; }
    if (y < 0 || y >= WH) return false;
    const at = w.getBlock(x, y, z);
    if (d.shape === SH.SLAB && at === id) {
      // filling the other half of a slab already in that cell
      if (this._blocked(x, y, z, d.full, 0)) return false;
      w.setBlock(x, y, z, d.full, 0);
      return this._placed(x, y, z, id);
    }
    if (!REPLACEABLE[at]) return false;
    const upper = t.ny === -1 || (t.ny === 0 && fy > 0.5);
    switch (d.shape) {
      case SH.SLAB: meta = upper ? 1 : 0; break;
      case SH.STAIRS: meta = dir | (upper ? 4 : 0); break;
      case SH.TORCH:
        if (t.ny === 1) meta = 0;
        else if (t.ny === 0) { for (let f = 0; f < 4; f++) if (FACING_DX[f] === t.nx && FACING_DZ[f] === t.nz) meta = 1 + f; }
        else return false;
        if (!w.torchSupported(x, y, z, meta)) {
          if (!w.torchSupported(x, y, z, 0)) return false;
          meta = 0;
        }
        break;
      case SH.LADDER: {
        if (t.ny !== 0 || !OPAQUE[t.id]) return false;
        for (let f = 0; f < 4; f++) if (FACING_DX[f] === t.nx && FACING_DZ[f] === t.nz) meta = f;
        break;
      }
      case SH.DOOR:
        if (!SOLID[w.getBlock(x, y - 1, z)] || !REPLACEABLE[w.getBlock(x, y + 1, z)] || y + 1 >= WH) return false;
        meta = dir;
        w.setBlock(x, y, z, id, meta, 0);
        w.setBlock(x, y + 1, z, id, meta | 8, 0);
        return this._placed(x, y, z, id);
      case SH.BED: {
        const hx = x + FACING_DX[dir], hz = z + FACING_DZ[dir];
        if (!REPLACEABLE[w.getBlock(hx, y, hz)] || !SOLID[w.getBlock(x, y - 1, z)] || !SOLID[w.getBlock(hx, y - 1, hz)]) return false;
        w.setBlock(x, y, z, id, dir, 0);
        w.setBlock(hx, y, hz, id, dir | 4, 0);
        return this._placed(x, y, z, id);
      }
      case SH.CROSS:
        if (!w.canPlantStay(id, x, y, z)) return false;
        if (id === B.SUGAR_CANE && w.getBlock(x, y - 1, z) !== B.SUGAR_CANE) {
          let water = false;
          for (let f = 0; f < 4; f++) if (w.getBlock(x + FACING_DX[f], y - 1, z + FACING_DZ[f]) === B.WATER) water = true;
          if (!water) return false;
        }
        break;
      case SH.CACTUS:
        if (!w.canCactusStay(x, y, z)) return false;
        break;
      case SH.SNOW:
        if (!OPAQUE[w.getBlock(x, y - 1, z)]) return false;
        break;
      case SH.CHEST:
        meta = (dir + 2) & 3;
        break;
      default:
        if (d.front >= 0) meta = (dir + 2) & 3;
        if (isLeaves(id)) meta = 1;
    }
    if (this._blocked(x, y, z, id, meta)) return false;
    w.setBlock(x, y, z, id, meta);
    if (d.gravity) w.schedule(x, y, z, 2);
    return this._placed(x, y, z, id);
  }
  // would the block's collision shape intersect the player or a mob?
  _blocked(x, y, z, id, meta) {
    if (!SOLID[id]) return false;
    const boxes = getBoxes(id, meta, false, null);
    const hit = (e) => {
      const hw = e.w / 2;
      for (const b of boxes) {
        if (e.x + hw > x + b[0] && e.x - hw < x + b[3] && e.y + e.h > y + b[1] && e.y < y + b[4] && e.z + hw > z + b[2] && e.z - hw < z + b[5]) return true;
      }
      return false;
    };
    if (hit(this)) return true;
    for (const e of this.game.entities.list) if (e.kind === 'mob' && hit(e)) return true;
    return false;
  }
  _placed(x, y, z, id) {
    this.game.audio.play('place_' + blocks[id].sound, x + 0.5, y + 0.5, z + 0.5, 0.9);
    this._consumeHeld();
    return true;
  }
}
