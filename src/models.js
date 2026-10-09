// Box models for mobs & the player, with procedurally painted skins packed into one atlas.
import { m4, lerp } from './math.js';
import { pushBox } from './renderer.js';
import { hash2, hashStr } from './noise.js';
import { mul } from './textures.js';

const AW = 512, AH = 256;
const PI = Math.PI;

// ---- skins ---------------------------------------------------------------------------
const biped = (p) => ({ part, face, x, y, w, h }) => {
  if (part === 'head') {
    if (face === 2) return p.hair;
    if (face === 3) return p.skin;
    if (face === 5) return y < 6 ? p.hair : p.skin;
    if (face === 0 || face === 1) return y < 3 || (y < 5 && (face === 0 ? x > 4 : x < 3)) ? p.hair : p.skin;
    if (y < 2 || (y === 2 && (x < 1 || x > 6))) return p.hair;
    if (y === 4 && (x === 1 || x === 6)) return p.eye;
    if (y === 4 && (x === 2 || x === 5)) return p.iris;
    if (y === 5 && (x === 3 || x === 4)) return mul(p.skin, 0.8);
    if (y === 6 && x >= 2 && x <= 5) return p.mouth;
    return p.skin;
  }
  if (part === 'body') return y > 10 && face !== 2 ? mul(p.shirt, 0.85) : p.shirt;
  if (part.startsWith('arm')) return face === 3 ? p.skin : face === 2 || y < p.sleeve ? p.shirt : p.skin;
  if (face === 3 || (face !== 2 && y >= h - 2)) return p.shoes;
  return p.pants;
};
const SKINS = {
  player: biped({ skin: 0xc8946c, hair: 0x3d2a16, shirt: 0x1fa8b8, pants: 0x3c3ca8, shoes: 0x555555, eye: 0xffffff, iris: 0x5a3ab0, mouth: 0x7a4a32, sleeve: 4 }),
  zombie: biped({ skin: 0x5a8f4f, hair: 0x4a7a44, shirt: 0x2a8a8a, pants: 0x3b3b98, shoes: 0x4a4a4a, eye: 0x101010, iris: 0x101010, mouth: 0x2f4f2a, sleeve: 4 }),
  skeleton: ({ part, face, x, y }) => {
    const bone = 0xc6c6c6;
    if (part === 'head' && face === 4) {
      if ((y === 3 || y === 4) && (x === 1 || x === 2 || x === 5 || x === 6)) return 0x202020;
      if (y === 5 && (x === 3 || x === 4)) return 0x505050;
      if (y === 6 && x >= 1 && x <= 6) return x & 1 ? 0x303030 : 0x707070;
    }
    if (part === 'body') {
      if (face === 4 || face === 5) return y % 3 === 1 || x === 3 || x === 4 ? bone : 0x4c4c4c;
      return y % 3 === 1 ? bone : 0x5a5a5a;
    }
    return (x + y) % 5 === 0 ? 0xa8a8a8 : bone;
  },
  creeper: ({ part, face, x, y, h, k }) => {
    if (part === 'head' && face === 4) {
      const eye = (y === 2 || y === 3) && (x === 1 || x === 2 || x === 5 || x === 6);
      const mouth = (y === 4 && (x === 3 || x === 4)) || ((y === 5 || y === 6) && x >= 2 && x <= 5) || (y === 7 && (x === 2 || x === 5));
      if (eye || mouth) return 0x101010;
    }
    if (part.startsWith('leg') && face !== 2 && y >= h - 2) return k < 0.5 ? 0x1c1c1c : 0x2e3a2e;
    return [0x2f8f2f, 0x4cb043, 0x4cb043, 0x66c95a, 0x8adf7a, 0x3a9a3a][(k * 6) | 0];
  },
  spider: ({ part, face, x, y, k }) => {
    if (part === 'head' && face === 4) {
      if ((y === 2 && (x === 1 || x === 2 || x === 5 || x === 6)) || (y === 4 && (x === 0 || x === 3 || x === 4 || x === 7))) return 0xd01818;
    }
    if (part === 'body' && face === 2 && ((x + y) % 4 === 0 || (x === 4 || x === 5))) return 0x5a4638;
    if (part.startsWith('leg')) return k < 0.3 ? 0x1e1814 : 0x2c241e;
    return [0x2e2620, 0x3a3028, 0x3a3028, 0x463a30][(k * 4) | 0];
  },
  pig: ({ part, box, face, x, y, h }) => {
    if (part === 'head' && box === 0 && face === 4 && y === 3) {
      if (x === 0 || x === 7) return 0x101010;
      if (x === 1 || x === 6) return 0xffffff;
    }
    if (part === 'head' && box === 1) return face === 4 && y === 1 && (x === 0 || x === 3) ? 0x7a4040 : 0xe08f8c;
    if (part.startsWith('leg') && face !== 2 && y >= h - 1) return 0xb87e78;
    return 0xf0a5a2;
  },
  cow: ({ part, box, face, x, y, h }) => {
    if (part === 'head' && box > 0) return 0xd8d0c0;
    if (part === 'head' && face === 4) {
      if (y === 2 && (x === 0 || x === 7)) return 0x101010;
      if (y === 2 && (x === 1 || x === 6)) return 0xffffff;
      if (y >= 5) return y === 6 && (x === 2 || x === 5) ? 0x4a3a3a : 0xd9c9b9;
      if (x === 3 || x === 4) return 0xe8e8e8;
    }
    if (part.startsWith('leg') && face !== 2 && y >= h - 2) return 0x2a2420;
    const patch = hash2((x >> 1) + face * 31 + hashStr(part) % 97, (y >> 1) + box * 13, 4177) % 100 < 30;
    return patch ? 0xe8e8e8 : 0x4a3a28;
  },
  sheep: ({ part, face, x, y, h, tag }) => {
    if (tag === 'wool') return 0xf2f2f2;
    if (part === 'head' && face === 4) {
      if (y === 2 && (x === 0 || x === 5)) return 0x101010;
      if (y === 2 && (x === 1 || x === 4)) return 0xffffff;
      if (y === 4 && (x === 2 || x === 3)) return 0xe8a0a0;
    }
    if (part.startsWith('leg') && face !== 2 && y >= h - 1) return 0x5a4a40;
    return part === 'body' ? 0xf0dcc8 : 0xd9b99b;
  },
  chicken: ({ part, box, face, x, y }) => {
    if (part === 'head') {
      if (box === 1) return 0xe8a82a;
      if (box === 2) return 0xd82020;
      if (face === 4 && y === 1 && (x === 0 || x === 3)) return 0x101010;
    }
    if (part.startsWith('leg')) return 0xe0a020;
    if (part.startsWith('wing')) return 0xe6e6e6;
    return 0xf6f6f6;
  },
  arrow: ({ box }) => [0x8a6a3a, 0x9a9a9a, 0xf0f0f0][box],
  // first-person arm: built upside down (hand at +y), so the sleeve sits at the bottom rows
  arm1p: ({ face, y, h }) => (face === 2 ? 0xc8946c : face === 3 || y >= h - 4 ? 0x1fa8b8 : 0xc8946c),
};

// ---- geometry ---------------------------------------------------------------------------
const box = (from, size, o = {}) => ({ from, size, ...o });
const quadLeg = (name, x, z, h) => ({ name, pivot: [x, h, z], boxes: [box([-2, -h, -2], [4, h, 4])] });
const bipedParts = (limb) => [
  { name: 'head', pivot: [0, 24, 0], boxes: [box([-4, 0, -4], [8, 8, 8])] },
  { name: 'body', pivot: [0, 0, 0], boxes: [box([-4, 12, -2], [8, 12, 4])] },
  { name: 'armR', pivot: [-5, 22, 0], boxes: [limb === 4 ? box([-3, -10, -2], [4, 12, 4]) : box([-1, -10, -1], [2, 12, 2])] },
  { name: 'armL', pivot: [5, 22, 0], boxes: [limb === 4 ? box([-1, -10, -2], [4, 12, 4]) : box([-1, -10, -1], [2, 12, 2])] },
  { name: 'legR', pivot: [-2, 12, 0], boxes: [limb === 4 ? box([-2, -12, -2], [4, 12, 4]) : box([-1, -12, -1], [2, 12, 2])] },
  { name: 'legL', pivot: [2, 12, 0], boxes: [limb === 4 ? box([-2, -12, -2], [4, 12, 4]) : box([-1, -12, -1], [2, 12, 2])] },
];
const spiderLegs = [];
for (let i = 0; i < 4; i++) {
  const z = [-2, -1, 0, 1][i];
  spiderLegs.push({ name: 'legR' + i, pivot: [-4, 9, z], boxes: [box([-15, -1, -1], [16, 2, 2])] });
  spiderLegs.push({ name: 'legL' + i, pivot: [4, 9, z], boxes: [box([-1, -1, -1], [16, 2, 2])] });
}
const DEFS = {
  player: { skin: 'player', parts: bipedParts(4) },
  zombie: { skin: 'zombie', parts: bipedParts(4) },
  skeleton: { skin: 'skeleton', parts: bipedParts(2) },
  creeper: {
    skin: 'creeper',
    parts: [
      { name: 'head', pivot: [0, 18, 0], boxes: [box([-4, 0, -4], [8, 8, 8])] },
      { name: 'body', pivot: [0, 0, 0], boxes: [box([-4, 6, -2], [8, 12, 4])] },
      quadLeg('leg0', -2, -4, 6), quadLeg('leg1', 2, -4, 6), quadLeg('leg2', -2, 4, 6), quadLeg('leg3', 2, 4, 6),
    ],
  },
  spider: {
    skin: 'spider',
    parts: [
      { name: 'head', pivot: [0, 9, 3], boxes: [box([-4, -4, 0], [8, 8, 8])] },
      { name: 'neck', pivot: [0, 0, 0], boxes: [box([-3, 6, -3], [6, 6, 6])] },
      { name: 'body', pivot: [0, 0, 0], boxes: [box([-5, 5, -15], [10, 8, 12])] },
      ...spiderLegs,
    ],
  },
  pig: {
    skin: 'pig',
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [box([-5, 6, -8], [10, 8, 16])] },
      { name: 'head', pivot: [0, 12, 6], boxes: [box([-4, -4, 0], [8, 8, 8]), box([-2, -3, 8], [4, 3, 1])] },
      quadLeg('leg0', -3, -7, 6), quadLeg('leg1', 3, -7, 6), quadLeg('leg2', -3, 5, 6), quadLeg('leg3', 3, 5, 6),
    ],
  },
  cow: {
    skin: 'cow',
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [box([-6, 12, -9], [12, 10, 18])] },
      { name: 'head', pivot: [0, 20, 8], boxes: [box([-4, -4, 0], [8, 8, 6]), box([-5, 2, 2], [1, 3, 1]), box([4, 2, 2], [1, 3, 1])] },
      quadLeg('leg0', -4, -7, 12), quadLeg('leg1', 4, -7, 12), quadLeg('leg2', -4, 6, 12), quadLeg('leg3', 4, 6, 12),
    ],
  },
  sheep: {
    skin: 'sheep',
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [box([-4, 12, -8], [8, 6, 16]), box([-4, 12, -8], [8, 6, 16], { inflate: 1.75, tag: 'wool' })] },
      { name: 'head', pivot: [0, 18, 8], boxes: [box([-3, -2, -2], [6, 6, 8]), box([-3, -2, -2], [6, 6, 6], { inflate: 0.6, tag: 'wool' })] },
      ...[['leg0', -3, -7], ['leg1', 3, -7], ['leg2', -3, 5], ['leg3', 3, 5]].map(([n, x, z]) => ({
        name: n, pivot: [x, 12, z], boxes: [box([-2, -12, -2], [4, 12, 4]), box([-2, -6, -2], [4, 6, 4], { inflate: 0.5, tag: 'wool' })],
      })),
    ],
  },
  chicken: {
    skin: 'chicken',
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [box([-3, 5, -4], [6, 6, 8])] },
      { name: 'head', pivot: [0, 9, 4], boxes: [box([-2, 0, -1], [4, 6, 3]), box([-2, 2, 2], [4, 2, 2]), box([-1, 0, 1], [2, 2, 2])] },
      { name: 'leg0', pivot: [-1.5, 5, 0.5], boxes: [box([-0.5, -5, -0.5], [1, 5, 1]), box([-1.5, -5, -0.5], [3, 0.5, 2])] },
      { name: 'leg1', pivot: [1.5, 5, 0.5], boxes: [box([-0.5, -5, -0.5], [1, 5, 1]), box([-1.5, -5, -0.5], [3, 0.5, 2])] },
      { name: 'wingR', pivot: [-3, 11, 0], boxes: [box([-1, -4, -3], [1, 4, 6])] },
      { name: 'wingL', pivot: [3, 11, 0], boxes: [box([0, -4, -3], [1, 4, 6])] },
    ],
  },
  arm1p: { skin: 'arm1p', parts: [{ name: 'arm', pivot: [-5, 2, 0], boxes: [box([-3, -2, -2], [4, 12, 4])] }] },
  arrow: {
    skin: 'arrow',
    parts: [{ name: 'shaft', pivot: [0, 0, 0], boxes: [box([-0.5, -0.5, -8], [1, 1, 10]), box([-1, -1, 2], [2, 2, 2]), box([-1.5, -0.25, -8], [3, 0.5, 3])] }],
  },
};

export class Models {
  constructor(renderer) {
    this.r = renderer;
    this.data = new Uint8Array(AW * AH * 4);
    this.sx = 1; this.sy = 1; this.sh = 0;
    this.models = {};
    for (const name in DEFS) this.models[name] = this._build(name, DEFS[name]);
    this.tex = renderer.texture2D(this.data, AW, AH);
    this.m = m4.create();
    this.pose = {};
  }
  _alloc(w, h) {
    if (this.sx + w + 1 > AW) { this.sx = 1; this.sy += this.sh + 1; this.sh = 0; }
    const r = [this.sx, this.sy];
    this.sx += w + 1;
    if (h > this.sh) this.sh = h;
    return r;
  }
  _build(name, def) {
    const paint = SKINS[def.skin];
    const parts = [];
    for (const part of def.parts) {
      const groups = {};
      part.boxes.forEach((b, bi) => {
        const [fx, fy, fz] = b.from, [w, h, d] = b.size;
        const inf = b.inflate || 0;
        const out = (groups[b.tag || ''] = groups[b.tag || ''] || []);
        const tw = Math.max(1, Math.round(w)), th = Math.max(1, Math.round(h)), td = Math.max(1, Math.round(d));
        const rects = [];
        for (let f = 0; f < 6; f++) {
          const pw = f < 2 ? td : tw, ph = f === 2 || f === 3 ? td : th;
          const [ax, ay] = this._alloc(pw, ph);
          for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
            const k = hash2(x + f * 17 + bi * 5, y + hashStr(name + part.name) % 1000, 911) / 4294967296;
            let c = paint({ part: part.name, box: bi, face: f, x, y, w: pw, h: ph, k, tag: b.tag });
            if (c !== 0x101010 && c !== 0xffffff) c = mul(c, 0.93 + (hash2(x * 7 + f, y * 13 + bi, hashStr(name)) / 4294967296) * 0.14);
            const i = ((ay + y) * AW + ax + x) * 4;
            this.data[i] = (c >> 16) & 255; this.data[i + 1] = (c >> 8) & 255; this.data[i + 2] = c & 255; this.data[i + 3] = 255;
          }
          const e = 0.02;
          rects.push([(ax + e) / AW, (ay + e) / AH, (ax + pw - e) / AW, (ay + ph - e) / AH]);
        }
        const s = 1 / 16;
        pushBox(out, (fx - inf) * s, (fy - inf) * s, (fz - inf) * s, (fx + w + inf) * s, (fy + h + inf) * s, (fz + d + inf) * s, (f) => rects[f]);
      });
      const meshes = {};
      for (const tag in groups) meshes[tag] = this.r.createMesh(groups[tag]);
      parts.push({ name: part.name, pivot: part.pivot.map((v) => v / 16), meshes });
    }
    return { parts };
  }

  // Draw a model. base: camera-relative entity matrix (already rotated to the body yaw).
  // pose: { partName: [rx, ry, rz] }, tags: which tagged box groups to draw besides the base ('')
  draw(name, base, pose, light, overlay = null, tags = null, scale = null) {
    const model = this.models[name], m = this.m;
    for (const p of model.parts) {
      m4.translate(m, base, p.pivot[0], p.pivot[1], p.pivot[2]);
      const r = pose[p.name];
      if (r) {
        if (r[2]) m4.rotZ(m, m, r[2]);
        if (r[1]) m4.rotY(m, m, r[1]);
        if (r[0]) m4.rotX(m, m, r[0]);
      }
      if (scale) m4.scale(m, m, scale, scale, scale);
      this.r.drawMesh(p.meshes[''], m, this.tex, light, undefined, overlay);
      if (tags) for (const t of tags) if (p.meshes[t]) this.r.drawMesh(p.meshes[t], m, this.tex, light, undefined, overlay);
    }
  }

  // limb poses per model family
  poseFor(kind, e, alpha) {
    const sw = e.limbSwing - e.limbAmount * (1 - alpha), am = lerp(e.plimbAmount, e.limbAmount, alpha);
    const headYaw = -(lerpAngle(e.pheadYaw, e.headYaw, alpha) - lerpAngle(e.pyaw, e.yaw, alpha));
    const headPitch = lerp(e.ppitch, e.pitch, alpha);
    const a = Math.cos(sw * 0.6662), b = Math.cos(sw * 0.6662 + PI);
    const pose = this.pose;
    for (const k in pose) delete pose[k];
    pose.head = [headPitch, headYaw, 0];
    switch (kind) {
      case 'player': case 'zombie': case 'skeleton': {
        pose.legR = [a * 1.4 * am, 0, 0];
        pose.legL = [b * 1.4 * am, 0, 0];
        if (kind === 'player') {
          pose.armR = [b * am, 0, 0];
          pose.armL = [a * am, 0, 0];
          const s = e.swingAnim ? e.swingAnim(alpha) : 0;
          if (s > 0) pose.armR = [pose.armR[0] - Math.sin(s * PI) * 1.4, Math.sin(Math.sqrt(s) * PI * 2) * 0.2, 0];
          if (e.sneaking) { pose.body = [0, 0, 0]; }
        } else {
          const bob = Math.sin((e.age + alpha) * 0.067) * 0.05;
          const atk = e.attackAnim > 0 ? Math.sin(((e.attackAnim - alpha) / 6) * PI) * 0.6 : 0;
          pose.armR = [-PI / 2 + bob - atk, 0.1, 0];
          pose.armL = [-PI / 2 - bob - atk, -0.1, 0];
        }
        break;
      }
      case 'creeper': case 'pig': case 'cow': case 'sheep':
        pose.leg0 = [a * 1.4 * am, 0, 0]; pose.leg1 = [b * 1.4 * am, 0, 0];
        pose.leg2 = [b * 1.4 * am, 0, 0]; pose.leg3 = [a * 1.4 * am, 0, 0];
        if (kind === 'sheep' && e.eatAnim > 0) pose.head = [0.9, 0, 0];
        break;
      case 'chicken': {
        pose.leg0 = [a * 1.4 * am, 0, 0]; pose.leg1 = [b * 1.4 * am, 0, 0];
        const flap = e.onGround ? 0 : (Math.sin((e.age + alpha) * 1.5) + 1) * 0.7;
        pose.wingR = [0, 0, -flap]; pose.wingL = [0, 0, flap];
        break;
      }
      case 'spider': {
        const base = [0.785, 0.39, -0.39, -0.785];
        for (let i = 0; i < 4; i++) {
          const ph = [0, PI, PI / 2, (PI * 3) / 2][i];
          const yv = -(Math.cos(sw * 0.6662 * 2 + ph) * 0.4) * am;
          const zv = Math.abs(Math.sin(sw * 0.6662 + ph) * 0.4) * am;
          const tilt = i === 0 || i === 3 ? 0.785 : 0.58;
          pose['legR' + i] = [0, -base[i] + yv, tilt + zv];
          pose['legL' + i] = [0, base[i] - yv, -tilt - zv];
        }
        break;
      }
    }
    return pose;
  }
}

export function lerpAngle(a, b, t) {
  let d = (b - a) % (PI * 2);
  if (d > PI) d -= PI * 2;
  if (d < -PI) d += PI * 2;
  return a + d * t;
}
