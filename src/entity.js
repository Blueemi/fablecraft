// Entity physics, modelled tick-for-tick on the classic 20 TPS movement code.
import { blocks, B, FLUID } from './blocks.js';

const EPS = 1e-7;
const BOXES = [];

export class Entity {
  constructor(world, x, y, z) {
    this.world = world;
    this.x = x; this.y = y; this.z = z;
    this.px = x; this.py = y; this.pz = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0; this.pyaw = 0; this.ppitch = 0;
    this.w = 0.6; this.h = 1.8;
    this.onGround = false;
    this.collidedH = false; this.collidedV = false;
    this.inWater = false; this.inLava = false;
    this.fallDist = 0;
    this.dead = false;
    this.age = 0;
    this.stepHeight = 0;
    this.noClip = false;
  }
  setPos(x, y, z) {
    this.x = this.px = x; this.y = this.py = y; this.z = this.pz = z;
  }
  dist2(x, y, z) {
    const dx = this.x - x, dy = this.y - y, dz = this.z - z;
    return dx * dx + dy * dy + dz * dz;
  }
  savePrev() {
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.pyaw = this.yaw; this.ppitch = this.pitch;
  }
  onLand() {}

  // true if the entity's box, offset by (dx,dy,dz), hits no blocks
  isFree(dx, dy, dz) {
    const hw = this.w / 2;
    const x0 = this.x - hw + dx, y0 = this.y + dy, z0 = this.z - hw + dz;
    const x1 = this.x + hw + dx, y1 = this.y + this.h + dy, z1 = this.z + hw + dz;
    BOXES.length = 0;
    this.world.collectBoxes(x0, y0, z0, x1, y1, z1, BOXES);
    for (let i = 0; i < BOXES.length; i += 6) {
      if (x1 > BOXES[i] + EPS && x0 < BOXES[i + 3] - EPS && y1 > BOXES[i + 1] + EPS && y0 < BOXES[i + 4] - EPS && z1 > BOXES[i + 2] + EPS && z0 < BOXES[i + 5] - EPS) return false;
    }
    return true;
  }

  move(dx, dy, dz) {
    if (this.noClip) {
      this.x += dx; this.y += dy; this.z += dz;
      return;
    }
    const hw = this.w / 2;
    let x0 = this.x - hw, y0 = this.y, z0 = this.z - hw, x1 = this.x + hw, y1 = this.y + this.h, z1 = this.z + hw;
    const odx = dx, ody = dy, odz = dz;
    const b = BOXES;
    b.length = 0;
    this.world.collectBoxes(Math.min(x0, x0 + dx), Math.min(y0, y0 + dy), Math.min(z0, z0 + dz), Math.max(x1, x1 + dx), Math.max(y1, y1 + dy), Math.max(z1, z1 + dz), b);
    const n = b.length;
    for (let i = 0; i < n; i += 6) dy = clipY(b, i, x0, y0, z0, x1, y1, z1, dy);
    y0 += dy; y1 += dy;
    for (let i = 0; i < n; i += 6) dx = clipX(b, i, x0, y0, z0, x1, y1, z1, dx);
    x0 += dx; x1 += dx;
    for (let i = 0; i < n; i += 6) dz = clipZ(b, i, x0, y0, z0, x1, y1, z1, dz);
    z0 += dz; z1 += dz;

    const grounded = this.onGround || (ody !== dy && ody < 0);
    if (this.stepHeight > 0 && grounded && (odx !== dx || odz !== dz)) {
      // try again from the start, lifted by the step height
      let sx0 = this.x - hw, sy0 = this.y, sz0 = this.z - hw, sx1 = this.x + hw, sy1 = this.y + this.h, sz1 = this.z + hw;
      b.length = 0;
      this.world.collectBoxes(Math.min(sx0, sx0 + odx), sy0, Math.min(sz0, sz0 + odz), Math.max(sx1, sx1 + odx), sy1 + this.stepHeight, Math.max(sz1, sz1 + odz), b);
      const m = b.length;
      let up = this.stepHeight;
      for (let i = 0; i < m; i += 6) up = clipY(b, i, sx0, sy0, sz0, sx1, sy1, sz1, up);
      sy0 += up; sy1 += up;
      let sdx = odx, sdz = odz;
      for (let i = 0; i < m; i += 6) sdx = clipX(b, i, sx0, sy0, sz0, sx1, sy1, sz1, sdx);
      sx0 += sdx; sx1 += sdx;
      for (let i = 0; i < m; i += 6) sdz = clipZ(b, i, sx0, sy0, sz0, sx1, sy1, sz1, sdz);
      sz0 += sdz; sz1 += sdz;
      let down = -up;
      for (let i = 0; i < m; i += 6) down = clipY(b, i, sx0, sy0, sz0, sx1, sy1, sz1, down);
      sy0 += down; sy1 += down;
      if (sdx * sdx + sdz * sdz > dx * dx + dz * dz + 1e-12) {
        dx = sdx; dz = sdz; dy = sy0 - this.y;
        x0 = sx0; x1 = sx1; y0 = sy0; z0 = sz0; z1 = sz1;
        this.stepped = sy0 - this.y;
      }
    }
    this.x = (x0 + x1) / 2;
    this.y = y0;
    this.z = (z0 + z1) / 2;
    this.collidedH = odx !== dx || odz !== dz;
    this.collidedV = ody !== dy;
    this.onGround = ody !== dy && ody < 0;
    if (odx !== dx) this.vx = 0;
    if (odz !== dz) this.vz = 0;
    if (ody !== dy) this.vy = 0;
    if (this.onGround) {
      if (this.fallDist > 0) {
        this.onLand(this.fallDist);
        this.fallDist = 0;
      }
    } else if (dy < 0) this.fallDist -= dy;
  }

  updateFluidState() {
    const hw = this.w / 2 - 0.001, w = this.world;
    this.inWater = w.fluidIn(this.x - hw, this.y + 0.4, this.z - hw, this.x + hw, this.y + this.h - 0.4, this.z + hw, 1);
    this.inLava = w.fluidIn(this.x - hw + 0.1, this.y + 0.4, this.z - hw + 0.1, this.x + hw - 0.1, this.y + this.h - 0.4, this.z + hw - 0.1, 2);
    if (this.inWater) {
      this.fallDist = 0;
      // currents push entities along
      const f = FLOW;
      let fx = 0, fz = 0;
      const y = Math.floor(this.y + 0.4);
      for (let x = Math.floor(this.x - hw); x <= Math.floor(this.x + hw); x++) for (let z = Math.floor(this.z - hw); z <= Math.floor(this.z + hw); z++) {
        w.flowVector(x, y, z, f);
        fx += f[0]; fz += f[1];
      }
      const l = Math.hypot(fx, fz);
      if (l > 0 && !this.flying) {
        this.vx += (fx / l) * 0.014;
        this.vz += (fz / l) * 0.014;
      }
    }
  }
  // is the point at eye height submerged in the given fluid (1 water, 2 lava)
  eyeInFluid(type, eyeY) {
    const x = Math.floor(this.x), y = Math.floor(eyeY), z = Math.floor(this.z);
    const id = this.world.getBlock(x, y, z);
    if (FLUID[id] !== type) return false;
    let m = this.world.getMeta(x, y, z);
    if (m >= 8) m = 0;
    const top = this.world.getBlock(x, y + 1, z) === id ? y + 1 : y + 1 - (m + 1) / 9;
    return eyeY < top + 0.02;
  }
}
const FLOW = [0, 0];

function clipY(b, i, x0, y0, z0, x1, y1, z1, dy) {
  if (x1 <= b[i] + EPS || x0 >= b[i + 3] - EPS || z1 <= b[i + 2] + EPS || z0 >= b[i + 5] - EPS) return dy;
  if (dy > 0 && y1 <= b[i + 1] + EPS) {
    const d = b[i + 1] - y1;
    if (d < dy) dy = d;
  } else if (dy < 0 && y0 >= b[i + 4] - EPS) {
    const d = b[i + 4] - y0;
    if (d > dy) dy = d;
  }
  return dy;
}
function clipX(b, i, x0, y0, z0, x1, y1, z1, dx) {
  if (y1 <= b[i + 1] + EPS || y0 >= b[i + 4] - EPS || z1 <= b[i + 2] + EPS || z0 >= b[i + 5] - EPS) return dx;
  if (dx > 0 && x1 <= b[i] + EPS) {
    const d = b[i] - x1;
    if (d < dx) dx = d;
  } else if (dx < 0 && x0 >= b[i + 3] - EPS) {
    const d = b[i + 3] - x0;
    if (d > dx) dx = d;
  }
  return dx;
}
function clipZ(b, i, x0, y0, z0, x1, y1, z1, dz) {
  if (x1 <= b[i] + EPS || x0 >= b[i + 3] - EPS || y1 <= b[i + 1] + EPS || y0 >= b[i + 4] - EPS) return dz;
  if (dz > 0 && z1 <= b[i + 2] + EPS) {
    const d = b[i + 2] - z1;
    if (d < dz) dz = d;
  } else if (dz < 0 && z0 >= b[i + 5] - EPS) {
    const d = b[i + 5] - z0;
    if (d > dz) dz = d;
  }
  return dz;
}

// Anything that walks, swims, takes damage.
export class Living extends Entity {
  constructor(world, x, y, z) {
    super(world, x, y, z);
    this.health = 20; this.maxHealth = 20;
    this.hurtTime = 0; this.invul = 0; this.deathTime = 0;
    this.moveSpeed = 0.1;
    this.airSpeed = 0.02;
    this.moveForward = 0; this.moveStrafe = 0;
    this.jumping = false; this.jumpTicks = 0;
    this.sneaking = false; this.sprinting = false; this.flying = false;
    this.limbSwing = 0; this.limbAmount = 0; this.plimbAmount = 0;
    this.headYaw = 0; this.pheadYaw = 0;
    this.stepHeight = 0.6;
    this.fire = 0;
    this.air = 300;
    this.climbs = false;
  }
  get alive() {
    return this.health > 0 && !this.dead;
  }
  eyeHeight() {
    return this.h * 0.85;
  }
  onLadder() {
    const id = this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    return blocks[id].climb === true || (this.climbs && this.collidedH);
  }
  moveRelative(strafe, forward, f) {
    let d = strafe * strafe + forward * forward;
    if (d < 1e-4) return;
    d = Math.sqrt(d);
    if (d < 1) d = 1;
    d = f / d;
    strafe *= d; forward *= d;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.vx += strafe * c - forward * s;
    this.vz += forward * c + strafe * s;
  }
  jump() {
    this.vy = 0.42;
    if (this.sprinting) {
      this.vx -= Math.sin(this.yaw) * 0.2;
      this.vz += Math.cos(this.yaw) * 0.2;
    }
  }
  travel(strafe, forward) {
    if (this.inWater && !this.flying) {
      const y0 = this.y;
      this.moveRelative(strafe, forward, 0.02);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8;
      this.vy -= 0.02;
      if (this.collidedH && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else if (this.inLava && !this.flying) {
      const y0 = this.y;
      this.moveRelative(strafe, forward, 0.02);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5;
      this.vy -= 0.02;
      if (this.collidedH && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else {
      let slip = 0.91;
      if (this.onGround) slip = blocks[this.world.getBlock(Math.floor(this.x), Math.floor(this.y) - 1, Math.floor(this.z))].slip * 0.91;
      const accel = this.onGround ? this.moveSpeed * (0.16277136 / (slip * slip * slip)) : this.airSpeed;
      this.moveRelative(strafe, forward, accel);
      const ladder = this.onLadder();
      if (ladder) {
        this.vx = Math.max(-0.15, Math.min(0.15, this.vx));
        this.vz = Math.max(-0.15, Math.min(0.15, this.vz));
        this.fallDist = 0;
        if (this.vy < -0.15) this.vy = -0.15;
        if (this.sneaking && this.vy < 0) this.vy = 0;
      }
      this.move(this.vx, this.vy, this.vz);
      if (this.collidedH && this.onLadder()) this.vy = 0.2;
      this.vy -= 0.08;
      this.vy *= 0.98;
      this.vx *= slip;
      this.vz *= slip;
    }
    // limb animation
    this.plimbAmount = this.limbAmount;
    const dx = this.x - this.px, dz = this.z - this.pz;
    let f = Math.sqrt(dx * dx + dz * dz) * 4;
    if (f > 1) f = 1;
    this.limbAmount += (f - this.limbAmount) * 0.4;
    this.limbSwing += this.limbAmount;
  }
  knockback(fromX, fromZ, strength = 0.4) {
    let dx = fromX - this.x, dz = fromZ - this.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    this.vx /= 2; this.vy /= 2; this.vz /= 2;
    this.vx -= dx * strength;
    this.vy += strength;
    this.vz -= dz * strength;
    if (this.vy > 0.4) this.vy = 0.4;
  }
  // returns true if damage was applied
  hurt(amount, source = null) {
    if (!this.alive || this.invul > 10) return false;
    this.health -= amount;
    this.hurtTime = 10;
    this.invul = 20;
    if (source && source.x !== undefined) this.knockback(source.x, source.z);
    if (this.health <= 0) {
      this.health = 0;
      this.onDeath(source);
    }
    return true;
  }
  onDeath() {}
  baseTick() {
    this.age++;
    this.savePrev();
    this.pheadYaw = this.headYaw;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invul > 0) this.invul--;
    this.updateFluidState();
    if (this.jumpTicks > 0) this.jumpTicks--;
    if (this.y < -40) this.hurt(4, { type: 'void' });
  }
}
