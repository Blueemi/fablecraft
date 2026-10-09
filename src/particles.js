// Lightweight CPU particles rendered as camera-facing quads from the block texture array.
import { blocks, texId, SOLID, OPAQUE, isLeaves, B } from './blocks.js';
import { lightRGB } from './renderer.js';

const rnd = Math.random;
const L = [1, 1, 1];

export class Particles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.max = 3000;
  }
  clear() {
    this.list.length = 0;
  }
  _light(x, y, z) {
    const g = this.game;
    return lightRGB(g.world.getLightRaw(Math.floor(x), Math.floor(y), Math.floor(z)), g.renderer.sun, g.renderer.settings.gamma, L);
  }
  // generic textured particle (tex = full 16x16 layer name)
  spawn(tex, x, y, z, vx, vy, vz, life, size, o = {}) {
    if (this.list.length >= this.max) return null;
    const lit = o.bright ? [1, 1, 1] : this._light(x, y, z);
    const p = {
      x, y, z, px: x, py: y, pz: z, vx, vy, vz, age: 0, life, size,
      layer: typeof tex === 'number' ? tex : texId(tex), u: o.u ?? 0, v: o.v ?? 0, us: o.us ?? 1,
      r: lit[0] * (o.r ?? 1), g: lit[1] * (o.g ?? 1), b: lit[2] * (o.b ?? 1), a: o.a ?? 1,
      grav: o.grav ?? 0, shrink: o.shrink ?? true, collide: o.collide ?? false, drag: o.drag ?? 0.98, fade: o.fade ?? false,
    };
    this.list.push(p);
    return p;
  }
  _blockTint(id, x, z) {
    const d = blocks[id], g = this.game;
    let t = 0xffffff;
    if (d.tint === 1 && id !== B.GRASS) t = g.world.gen.climate.grass(x, z);
    else if (d.tint === 2) t = g.world.gen.climate.foliage(x, z);
    else if (d.tint === 4) t = d.color;
    else if (d.tint === 3) t = g.world.gen.climate.water(x, z);
    return [((t >> 16) & 255) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255];
  }
  _blockLayer(id) {
    const d = blocks[id];
    return id === B.GRASS ? d.faces[3] : d.faces[0];
  }
  blockBreak(x, y, z, id) {
    const layer = this._blockLayer(id), t = this._blockTint(id, x, z);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      if (rnd() < 0.45) continue;
      const px = x + (i + 0.5) / 4, py = y + (j + 0.5) / 4, pz = z + (k + 0.5) / 4;
      this.spawn(layer, px, py, pz, (px - x - 0.5) * 0.25 + (rnd() - 0.5) * 0.1, (py - y - 0.5) * 0.25 + 0.1 + rnd() * 0.1, (pz - z - 0.5) * 0.25 + (rnd() - 0.5) * 0.1,
        8 + ((rnd() * 22) | 0), 0.06 + rnd() * 0.05, { u: rnd() * 0.75, v: rnd() * 0.75, us: 0.25, grav: 1, collide: true, shrink: false, r: t[0], g: t[1], b: t[2] });
    }
  }
  blockHit(x, y, z, nx, ny, nz, id) {
    const layer = this._blockLayer(id), t = this._blockTint(id, x, z);
    const px = x + 0.5 + nx * 0.55 + (nx ? 0 : rnd() - 0.5) * 0.8, py = y + 0.5 + ny * 0.55 + (ny ? 0 : rnd() - 0.5) * 0.8, pz = z + 0.5 + nz * 0.55 + (nz ? 0 : rnd() - 0.5) * 0.8;
    this.spawn(layer, px, py, pz, nx * 0.04 + (rnd() - 0.5) * 0.06, 0.06 + rnd() * 0.06, nz * 0.04 + (rnd() - 0.5) * 0.06, 10 + ((rnd() * 14) | 0), 0.05 + rnd() * 0.03,
      { u: rnd() * 0.75, v: rnd() * 0.75, us: 0.25, grav: 1, collide: true, shrink: false, r: t[0], g: t[1], b: t[2] });
  }
  itemBits(x, y, z, layerOrId, vx, vy, vz) {
    for (let i = 0; i < 5; i++) {
      this.spawn(layerOrId, x, y, z, vx + (rnd() - 0.5) * 0.1, vy + rnd() * 0.1, vz + (rnd() - 0.5) * 0.1, 10 + ((rnd() * 8) | 0), 0.04, { u: rnd() * 0.75, v: rnd() * 0.75, us: 0.25, grav: 1, collide: true, shrink: false });
    }
  }
  smoke(x, y, z, n = 1, spread = 0.2) {
    for (let i = 0; i < n; i++) {
      const s = 0.25 + rnd() * 0.35;
      this.spawn('p_smoke', x + (rnd() - 0.5) * spread * 2, y + (rnd() - 0.5) * spread, z + (rnd() - 0.5) * spread * 2, (rnd() - 0.5) * 0.02, 0.02 + rnd() * 0.03, (rnd() - 0.5) * 0.02, 14 + ((rnd() * 16) | 0), 0.1 + rnd() * 0.08, { r: s, g: s, b: s, bright: true });
    }
  }
  flame(x, y, z) {
    this.spawn('p_flame', x, y, z, 0, 0.004, 0, 14 + ((rnd() * 8) | 0), 0.07, { bright: true });
  }
  explosion(x, y, z, power) {
    const n = 20 + power * 8;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, b = rnd() * Math.PI - Math.PI / 2, r = rnd() * power * 0.9;
      const dx = Math.cos(a) * Math.cos(b), dy = Math.sin(b), dz = Math.sin(a) * Math.cos(b);
      const s = 0.6 + rnd() * 0.4;
      this.spawn('p_explode', x + dx * r, y + dy * r, z + dz * r, dx * 0.12, dy * 0.12 + 0.02, dz * 0.12, 10 + ((rnd() * 18) | 0), 0.5 + rnd() * 0.7, { r: s, g: s, b: s, bright: true });
    }
    this.smoke(x, y, z, 24, power * 0.7);
  }
  splash(x, y, z, n = 10, w = 0.3) {
    for (let i = 0; i < n; i++) {
      this.spawn('p_splash', x + (rnd() - 0.5) * w * 2, y, z + (rnd() - 0.5) * w * 2, (rnd() - 0.5) * 0.12, 0.12 + rnd() * 0.16, (rnd() - 0.5) * 0.12, 10 + ((rnd() * 10) | 0), 0.05 + rnd() * 0.04, { grav: 1.2, shrink: false });
    }
  }
  bubbles(x, y, z, n = 3) {
    for (let i = 0; i < n; i++) this.spawn('p_bubble', x + (rnd() - 0.5) * 0.4, y + (rnd() - 0.5) * 0.3, z + (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.02, 0.06 + rnd() * 0.04, (rnd() - 0.5) * 0.02, 20 + ((rnd() * 20) | 0), 0.04 + rnd() * 0.03, { shrink: false, water: true });
  }
  crit(x, y, z, w, h) {
    for (let i = 0; i < 12; i++) this.spawn('p_crit', x + (rnd() - 0.5) * w * 1.6, y + rnd() * h, z + (rnd() - 0.5) * w * 1.6, (rnd() - 0.5) * 0.3, rnd() * 0.25, (rnd() - 0.5) * 0.3, 8 + ((rnd() * 8) | 0), 0.09, { grav: 0.6, bright: true });
  }
  bonemeal(x, y, z) {
    for (let i = 0; i < 12; i++) this.spawn('p_white', x + rnd(), y + rnd() * 0.8, z + rnd(), 0, 0.01 + rnd() * 0.02, 0, 12 + ((rnd() * 12) | 0), 0.04, { r: 0.25, g: 0.9, b: 0.25, bright: true });
  }
  hearts(x, y, z) {
    for (let i = 0; i < 5; i++) this.spawn('p_heart', x + (rnd() - 0.5), y + rnd() * 0.6, z + (rnd() - 0.5), 0, 0.04, 0, 20, 0.12, { bright: true, shrink: false });
  }

  tick() {
    const list = this.list, w = this.game.world;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (++p.age >= p.life) {
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.vy -= 0.04 * p.grav;
      let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
      if (p.collide) {
        const id = w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (SOLID[id] && OPAQUE[id]) {
          if (!(SOLID[w.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))] && OPAQUE[w.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))])) { nx = p.x; nz = p.z; p.vx = p.vz = 0; }
          else { ny = p.y; p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; nx = p.x + p.vx; nz = p.z + p.vz; }
        }
      }
      if (p.water && w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz)) !== B.WATER) { p.age = p.life; }
      p.x = nx; p.y = ny; p.z = nz;
      p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
    }
  }
}
