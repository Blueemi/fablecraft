// Chunk mesher: turns padded block/meta/light arrays into packed vertex buffers.
// Vertex (16 bytes): u16 x,y,z (1/256 block, +1 block bias), u16 layer,
//                    u8 u,v (1/128), u8 sky, u8 block, u8 r,g,b, u8 flags
// flags: bits 0-1 animation (1 water, 2 lava, 3 fire), bit 2 = no mipmaps
import { blocks, OPAQUE, SHAPE, SH, SOLID, B, WH, FACING_TO_FACE, FACING_DX, FACING_DZ, doorBoxIndex, fenceConnects, isLeaves } from './blocks.js';
import { hash2 } from './noise.js';

export const PW = 18;
export const PH = WH + 2;
const SX = PW * PH, SZ = PH;
export const PSIZE = PW * PW * PH;

class Buf {
  constructor() {
    this.cap = 8192;
    this.alloc();
    this.n = 0;
  }
  alloc() {
    this.ab = new ArrayBuffer(this.cap * 16);
    this.u16 = new Uint16Array(this.ab);
    this.u8 = new Uint8Array(this.ab);
  }
  grow() {
    const old = this.u8;
    this.cap *= 2;
    this.alloc();
    this.u8.set(old);
  }
  out() {
    return this.ab.slice(0, this.n * 16);
  }
}
const OPQ = new Buf(), TRN = new Buf();

// corner tables: per face 4 corners [x,y,z,u,v], CCW seen from outside
const FC = [
  [[1, 0, 1, 0, 1], [1, 0, 0, 1, 1], [1, 1, 0, 1, 0], [1, 1, 1, 0, 0]],
  [[0, 0, 0, 0, 1], [0, 0, 1, 1, 1], [0, 1, 1, 1, 0], [0, 1, 0, 0, 0]],
  [[0, 1, 1, 0, 1], [1, 1, 1, 1, 1], [1, 1, 0, 1, 0], [0, 1, 0, 0, 0]],
  [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [1, 0, 1, 1, 1], [0, 0, 1, 0, 1]],
  [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [1, 1, 1, 1, 0], [0, 1, 1, 0, 0]],
  [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]],
];
const FN = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const NOFF = FN.map(([x, y, z]) => x * SX + z * SZ + y);
export const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AOF = [0.4, 0.6, 0.8, 1.0];
const STRIDE = [SX, 1, SZ];
// AO sample offsets (relative to the cell in front of the face) per face/corner: side1, side2, corner
const AO = new Int32Array(6 * 4 * 3);
for (let f = 0; f < 6; f++) {
  const axis = f >> 1;
  const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
  for (let v = 0; v < 4; v++) {
    const c = FC[f][v];
    const o1 = (c[t1] ? 1 : -1) * STRIDE[t1], o2 = (c[t2] ? 1 : -1) * STRIDE[t2];
    AO[(f * 4 + v) * 3] = o1;
    AO[(f * 4 + v) * 3 + 1] = o2;
    AO[(f * 4 + v) * 3 + 2] = o1 + o2;
  }
}

let pb, pm, pl;
const skyV = new Float32Array(4), blkV = new Float32Array(4), aoV = new Float32Array(4);
const tints = { grass: new Int32Array(256), foliage: new Int32Array(256), water: new Int32Array(256) };

function vert(buf, x, y, z, layer, u, v, sky, blk, r, g, b, fl) {
  if (buf.n >= buf.cap) buf.grow();
  const o = buf.n * 16, h = o >> 1;
  buf.u16[h] = x; buf.u16[h + 1] = y; buf.u16[h + 2] = z; buf.u16[h + 3] = layer;
  const u8 = buf.u8;
  u8[o + 8] = u; u8[o + 9] = v; u8[o + 10] = sky; u8[o + 11] = blk;
  u8[o + 12] = r; u8[o + 13] = g; u8[o + 14] = b; u8[o + 15] = fl;
  buf.n++;
}
const P = (v) => Math.round((v + 1) * 256);
const UV = (v) => Math.round(v * 128);

// Arbitrary quad from 4 corner positions (block units, chunk-local), flat light.
function quad(buf, layer, p, uv, light, shade, tint, fl, twoSided) {
  const sky = (light >> 4) * 17, blk = (light & 15) * 17;
  const r = ((tint >> 16) & 255) * shade, g = ((tint >> 8) & 255) * shade, b = (tint & 255) * shade;
  for (let i = 0; i < 4; i++) vert(buf, P(p[i * 3]), P(p[i * 3 + 1]), P(p[i * 3 + 2]), layer, UV(uv[i * 2]), UV(uv[i * 2 + 1]), sky, blk, r, g, b, fl);
  if (twoSided) for (let i = 3; i >= 0; i--) vert(buf, P(p[i * 3]), P(p[i * 3 + 1]), P(p[i * 3 + 2]), layer, UV(uv[i * 2]), UV(uv[i * 2 + 1]), sky, blk, r, g, b, fl);
}

const maxLight = (a, b) => Math.max(a & 0xf0, b & 0xf0) | Math.max(a & 15, b & 15);
const qp = new Float32Array(12), quv = new Float32Array(8);

// Axis-aligned box inside a block. layers: 6 texture layers; mask: bit per face to emit.
// Faces on the block boundary are culled against opaque neighbours and lit by the neighbour cell.
function box(buf, idx, bx, by, bz, x0, y0, z0, x1, y1, z1, layers, mask, tint, fl, topRot = 0, cullId = -1) {
  const own = pl[idx];
  for (let f = 0; f < 6; f++) {
    if (!(mask & (1 << f))) continue;
    let light = own;
    const onEdge = f === 0 ? x1 >= 1 : f === 1 ? x0 <= 0 : f === 2 ? y1 >= 1 : f === 3 ? y0 <= 0 : f === 4 ? z1 >= 1 : z0 <= 0;
    const nid = pb[idx + NOFF[f]];
    if (onEdge) {
      if (OPAQUE[nid] || nid === cullId) continue;
      light = pl[idx + NOFF[f]];
    } else if (!OPAQUE[nid]) light = maxLight(own, pl[idx + NOFF[f]]);
    const c = FC[f];
    for (let v = 0; v < 4; v++) {
      const x = c[v][0] ? x1 : x0, y = c[v][1] ? y1 : y0, z = c[v][2] ? z1 : z0;
      qp[v * 3] = bx + x; qp[v * 3 + 1] = by + y; qp[v * 3 + 2] = bz + z;
      let u, w;
      if (f === 0) { u = 1 - z; w = 1 - y; }
      else if (f === 1) { u = z; w = 1 - y; }
      else if (f === 2 || f === 3) {
        u = x; w = z;
        for (let k = 0; k < topRot; k++) { const t = u; u = w; w = 1 - t; }
      } else if (f === 4) { u = x; w = 1 - y; }
      else { u = 1 - x; w = 1 - y; }
      quv[v * 2] = u; quv[v * 2 + 1] = w;
    }
    quad(buf, layers[f], qp, quv, light, FACE_SHADE[f], tint, fl, false);
  }
}

function cube(id, meta, idx, x, y, z, d, col) {
  const buf = d.transl ? TRN : OPQ;
  const faces = d.faces;
  const front = d.front >= 0 ? FACING_TO_FACE[meta & 3] : -1;
  const fl = d.anim | (d.cutout && !isLeaves(id) ? 4 : 0);
  const X = (x + 1) * 256, Y = (y + 1) * 256, Z = (z + 1) * 256;
  const isGrass = id === B.GRASS;
  let tint = 0xffffff;
  if (d.tint === 2) tint = tints.foliage[col];
  else if (d.tint === 4) tint = d.color;
  for (let f = 0; f < 6; f++) {
    const fi = idx + NOFF[f];
    const nid = pb[fi];
    if (OPAQUE[nid] || (nid === id && d.cullSame)) continue;
    let layer = f === front ? d.front : faces[f];
    let ft = tint, overlay = false;
    if (isGrass) {
      if (f === 2) ft = tints.grass[col];
      else if (f !== 3) {
        const above = pb[idx + 1];
        if (above === B.SNOW_LAYER || above === B.SNOW_BLOCK) layer = d.tex.snow;
        else overlay = true;
      }
    }
    const l0 = pl[fi];
    const k0 = f * 12;
    for (let v = 0; v < 4; v++) {
      const k = k0 + v * 3;
      const i1 = fi + AO[k], i2 = fi + AO[k + 1], i3 = fi + AO[k + 2];
      const o1 = OPAQUE[pb[i1]], o2 = OPAQUE[pb[i2]], o3 = OPAQUE[pb[i3]];
      const both = o1 & o2;
      aoV[v] = both ? 0 : 3 - o1 - o2 - o3;
      const l1 = o1 ? l0 : pl[i1], l2 = o2 ? l0 : pl[i2], l3 = o3 || both ? l0 : pl[i3];
      skyV[v] = ((l0 >> 4) + (l1 >> 4) + (l2 >> 4) + (l3 >> 4)) * 4.25;
      blkV[v] = ((l0 & 15) + (l1 & 15) + (l2 & 15) + (l3 & 15)) * 4.25;
    }
    const sh = FACE_SHADE[f];
    const tr = ((ft >> 16) & 255) * sh, tg = ((ft >> 8) & 255) * sh, tb = (ft & 255) * sh;
    const m0 = AOF[aoV[0]] * (60 + Math.max(skyV[0], blkV[0])), m1 = AOF[aoV[1]] * (60 + Math.max(skyV[1], blkV[1]));
    const m2 = AOF[aoV[2]] * (60 + Math.max(skyV[2], blkV[2])), m3 = AOF[aoV[3]] * (60 + Math.max(skyV[3], blkV[3]));
    const start = m0 + m2 >= m1 + m3 ? 0 : 1;
    const c = FC[f];
    for (let n = 0; n < 4; n++) {
      const v = (n + start) & 3, cv = c[v], a = AOF[aoV[v]];
      vert(buf, X + cv[0] * 256, Y + cv[1] * 256, Z + cv[2] * 256, layer, cv[3] * 128, cv[4] * 128, skyV[v], blkV[v], tr * a, tg * a, tb * a, fl);
    }
    if (overlay) {
      const gt = tints.grass[col];
      const gr = ((gt >> 16) & 255) * sh, gg = ((gt >> 8) & 255) * sh, gb = (gt & 255) * sh;
      for (let n = 0; n < 4; n++) {
        const v = (n + start) & 3, cv = c[v], a = AOF[aoV[v]];
        vert(buf, X + cv[0] * 256, Y + cv[1] * 256, Z + cv[2] * 256, d.tex.overlay, cv[3] * 128, cv[4] * 128, skyV[v], blkV[v], gr * a, gg * a, gb * a, 4);
      }
    }
  }
}

function cross(id, idx, x, y, z, d, col, wx, wz) {
  let ox = 0, oz = 0;
  if (id === B.TALL_GRASS || (id >= B.DANDELION && id <= B.POPPY) || (id >= B.CORNFLOWER && id <= B.DAISY)) {
    const h = hash2(wx, wz, 9781);
    ox = (((h & 15) / 15) - 0.5) * 0.5;
    oz = ((((h >> 4) & 15) / 15) - 0.5) * 0.5;
  }
  const tint = d.tint === 1 ? tints.grass[col] : 0xffffff;
  const light = pl[idx], fl = d.anim | 4, layer = d.faces[0];
  const a = 0.5 - 0.45, b = 0.5 + 0.45;
  const cx = x + ox, cz = z + oz;
  quv.set([0, 1, 1, 1, 1, 0, 0, 0]);
  qp.set([cx + a, y, cz + a, cx + b, y, cz + b, cx + b, y + 1, cz + b, cx + a, y + 1, cz + a]);
  quad(OPQ, layer, qp, quv, light, 1, tint, fl, true);
  qp.set([cx + a, y, cz + b, cx + b, y, cz + a, cx + b, y + 1, cz + a, cx + a, y + 1, cz + b]);
  quad(OPQ, layer, qp, quv, light, 1, tint, fl, true);
}

function crop(meta, idx, x, y, z, d) {
  const layer = d.faces[0] + (meta & 7), light = pl[idx];
  const y0 = y - 1 / 16, y1 = y + 15 / 16;
  quv.set([0, 1, 1, 1, 1, 0, 0, 0]);
  for (const o of [0.25, 0.75]) {
    qp.set([x + o, y0, z, x + o, y0, z + 1, x + o, y1, z + 1, x + o, y1, z]);
    quad(OPQ, layer, qp, quv, light, 1, 0xffffff, 4, true);
    qp.set([x, y0, z + o, x + 1, y0, z + o, x + 1, y1, z + o, x, y1, z + o]);
    quad(OPQ, layer, qp, quv, light, 1, 0xffffff, 4, true);
  }
}

function fire(idx, x, y, z, d) {
  const layer = d.faces[0], light = 0x0f | (pl[idx] & 0xf0);
  quv.set([0, 1, 1, 1, 1, 0, 0, 0]);
  const fl = 3 | 4;
  qp.set([x, y, z, x + 1, y, z + 1, x + 1, y + 1, z + 1, x, y + 1, z]);
  quad(OPQ, layer, qp, quv, light, 1, 0xffffff, fl, true);
  qp.set([x, y, z + 1, x + 1, y, z, x + 1, y + 1, z, x, y + 1, z + 1]);
  quad(OPQ, layer, qp, quv, light, 1, 0xffffff, fl, true);
  for (const o of [0.05, 0.95]) {
    qp.set([x + o, y, z, x + o, y, z + 1, x + o, y + 1, z + 1, x + o, y + 1, z]);
    quad(OPQ, layer, qp, quv, light, 1, 0xffffff, fl, true);
    qp.set([x, y, z + o, x + 1, y, z + o, x + 1, y + 1, z + o, x, y + 1, z + o]);
    quad(OPQ, layer, qp, quv, light, 1, 0xffffff, fl, true);
  }
}

function torch(meta, idx, x, y, z, d) {
  const layer = d.faces[0], light = pl[idx] | 0x0e;
  // base centre, vertical offset and shear (per unit height) for wall torches
  let bx = 0.5, bz = 0.5, by = 0, sx = 0, sz = 0;
  if (meta >= 1 && meta <= 4) {
    const f = meta - 1;
    const dx = FACING_DX[f], dz = FACING_DZ[f];
    bx -= dx * 0.4; bz -= dz * 0.4; by = 0.2; sx = dx * 0.4; sz = dz * 0.4;
  }
  const X0 = x + bx, Z0 = z + bz, Y0 = y + by, w = 1 / 16;
  const X1 = X0 + sx, Z1 = Z0 + sz, Y1 = Y0 + 1;
  // four full-size side quads set in by 7/16 (texture is transparent outside the stick)
  quv.set([0, 1, 1, 1, 1, 0, 0, 0]);
  qp.set([X0 + w, Y0, Z0 + 0.5, X0 + w, Y0, Z0 - 0.5, X1 + w, Y1, Z1 - 0.5, X1 + w, Y1, Z1 + 0.5]);
  quad(OPQ, layer, qp, quv, light, 1, 0xffffff, 4, false);
  qp.set([X0 - w, Y0, Z0 - 0.5, X0 - w, Y0, Z0 + 0.5, X1 - w, Y1, Z1 + 0.5, X1 - w, Y1, Z1 - 0.5]);
  quad(OPQ, layer, qp, quv, light, 1, 0xffffff, 4, false);
  qp.set([X0 - 0.5, Y0, Z0 + w, X0 + 0.5, Y0, Z0 + w, X1 + 0.5, Y1, Z1 + w, X1 - 0.5, Y1, Z1 + w]);
  quad(OPQ, layer, qp, quv, light, 1, 0xffffff, 4, false);
  qp.set([X0 + 0.5, Y0, Z0 - w, X0 - 0.5, Y0, Z0 - w, X1 - 0.5, Y1, Z1 - w, X1 + 0.5, Y1, Z1 - w]);
  quad(OPQ, layer, qp, quv, light, 1, 0xffffff, 4, false);
  // top cap
  const t = 10 / 16, tx = X0 + sx * t, tz = Z0 + sz * t, ty = Y0 + t;
  quv.set([7 / 16, 8 / 16, 9 / 16, 8 / 16, 9 / 16, 6 / 16, 7 / 16, 6 / 16]);
  qp.set([tx - w, ty, tz + w, tx + w, ty, tz + w, tx + w, ty, tz - w, tx - w, ty, tz - w]);
  quad(OPQ, layer, qp, quv, light, 1, 0xffffff, 4, false);
}

function fluidCorner(id, i00, i10, i01, i11) {
  let sum = 0, cnt = 0;
  for (let k = 0; k < 4; k++) {
    const c = k === 0 ? i00 : k === 1 ? i10 : k === 2 ? i01 : i11;
    if (pb[c + 1] === id) return 1;
    const b = pb[c];
    if (b === id) {
      let m = pm[c];
      if (m >= 8) m = 0;
      const pct = (m + 1) / 9;
      if (m === 0) { sum += pct * 10; cnt += 10; } else { sum += pct; cnt++; }
    } else if (!SOLID[b]) { sum += 1; cnt++; }
  }
  return 1 - sum / cnt;
}

function fluid(id, idx, x, y, z, d, col) {
  const buf = d.transl ? TRN : OPQ;
  const layer = d.faces[0], fl = d.anim;
  const tint = d.tint === 3 ? tints.water[col] : 0xffffff;
  const lava = id === B.LAVA;
  const above = pb[idx + 1] === id;
  let h00 = 1, h10 = 1, h01 = 1, h11 = 1;
  if (!above) {
    h00 = fluidCorner(id, idx - SX - SZ, idx - SZ, idx - SX, idx);
    h10 = fluidCorner(id, idx - SZ, idx + SX - SZ, idx, idx + SX);
    h01 = fluidCorner(id, idx - SX, idx, idx - SX + SZ, idx + SZ);
    h11 = fluidCorner(id, idx, idx + SX, idx + SZ, idx + SX + SZ);
  }
  const own = lava ? 0xff : pl[idx];
  const lit = (n) => (lava ? 0xff : maxLight(own, pl[n]));
  const shade = (f) => (lava ? 1 : FACE_SHADE[f]);
  if (!above && !(OPAQUE[pb[idx + 1]] && h00 >= 1 && h10 >= 1 && h01 >= 1 && h11 >= 1)) {
    quv.set([0, 1, 1, 1, 1, 0, 0, 0]);
    qp.set([x, y + h01, z + 1, x + 1, y + h11, z + 1, x + 1, y + h10, z, x, y + h00, z]);
    quad(buf, layer, qp, quv, lit(idx + 1), 1, tint, fl, false);
  }
  const nb = pb[idx - 1];
  if (nb !== id && !OPAQUE[nb]) {
    quv.set([0, 0, 1, 0, 1, 1, 0, 1]);
    qp.set([x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1]);
    quad(buf, layer, qp, quv, lit(idx - 1), shade(3), tint, fl, false);
  }
  const side = (f, n, ax, az, ha, bx2, bz2, hb) => {
    const b = pb[n];
    if (b === id || OPAQUE[b]) return;
    quv.set([0, 1, 1, 1, 1, 1 - hb, 0, 1 - ha]);
    qp.set([ax, y, az, bx2, y, bz2, bx2, y + hb, bz2, ax, y + ha, az]);
    quad(buf, layer, qp, quv, lit(n), shade(f), tint, fl, false);
  };
  side(0, idx + SX, x + 1, z + 1, h11, x + 1, z, h10);
  side(1, idx - SX, x, z, h00, x, z + 1, h01);
  side(4, idx + SZ, x, z + 1, h01, x + 1, z + 1, h11);
  side(5, idx - SZ, x + 1, z, h10, x, z, h00);
}

const L6 = new Uint16Array(6);
const fillL = (v) => { L6.fill(v); return L6; };
const p16 = 1 / 16;

function special(id, meta, idx, x, y, z, d, col, wx, wz) {
  const fl = d.cutout ? 4 : 0;
  switch (d.shape) {
    case SH.CROSS: cross(id, idx, x, y, z, d, col, wx, wz); break;
    case SH.CROP: crop(meta, idx, x, y, z, d); break;
    case SH.FIRE: fire(idx, x, y, z, d); break;
    case SH.TORCH: torch(meta, idx, x, y, z, d); break;
    case SH.FLUID: fluid(id, idx, x, y, z, d, col); break;
    case SH.SLAB:
      if (meta & 1) box(OPQ, idx, x, y, z, 0, 0.5, 0, 1, 1, 1, d.faces, 63, 0xffffff, fl);
      else box(OPQ, idx, x, y, z, 0, 0, 0, 1, 0.5, 1, d.faces, 63, 0xffffff, fl);
      break;
    case SH.STAIRS: {
      const up = meta & 4, f = meta & 3;
      if (up) box(OPQ, idx, x, y, z, 0, 0.5, 0, 1, 1, 1, d.faces, 63, 0xffffff, fl);
      else box(OPQ, idx, x, y, z, 0, 0, 0, 1, 0.5, 1, d.faces, 63, 0xffffff, fl);
      const ya = up ? 0 : 0.5, yb = up ? 0.5 : 1, m = up ? 63 & ~4 : 63 & ~8;
      if (f === 0) box(OPQ, idx, x, y, z, 0, ya, 0.5, 1, yb, 1, d.faces, m, 0xffffff, fl);
      else if (f === 1) box(OPQ, idx, x, y, z, 0, ya, 0, 0.5, yb, 1, d.faces, m, 0xffffff, fl);
      else if (f === 2) box(OPQ, idx, x, y, z, 0, ya, 0, 1, yb, 0.5, d.faces, m, 0xffffff, fl);
      else box(OPQ, idx, x, y, z, 0.5, ya, 0, 1, yb, 1, d.faces, m, 0xffffff, fl);
      break;
    }
    case SH.CACTUS:
      box(OPQ, idx, x, y, z, p16, 0, p16, 1 - p16, 1, 1 - p16, d.faces, 63, 0xffffff, 4, 0, id);
      break;
    case SH.FARMLAND: {
      L6.set(d.faces);
      if (meta > 0) L6[2] = d.tex.wet;
      box(OPQ, idx, x, y, z, 0, 0, 0, 1, 15 * p16, 1, L6, 63, 0xffffff, 0);
      break;
    }
    case SH.SNOW:
      box(OPQ, idx, x, y, z, 0, 0, 0, 1, 2 * p16, 1, d.faces, 63, 0xffffff, 0);
      break;
    case SH.CHEST: {
      L6.set(d.faces);
      L6[FACING_TO_FACE[meta & 3]] = d.front;
      box(OPQ, idx, x, y, z, p16, 0, p16, 1 - p16, 14 * p16, 1 - p16, L6, 63, 0xffffff, 0);
      break;
    }
    case SH.DOOR: {
      const t = 3 * p16, k = doorBoxIndex(meta);
      fillL(meta & 8 ? d.tex.top : d.tex.bottom);
      if (k === 0) box(OPQ, idx, x, y, z, 0, 0, 0, 1, 1, t, L6, 63, 0xffffff, 4, 0, id);
      else if (k === 1) box(OPQ, idx, x, y, z, 1 - t, 0, 0, 1, 1, 1, L6, 63, 0xffffff, 4, 0, id);
      else if (k === 2) box(OPQ, idx, x, y, z, 0, 0, 1 - t, 1, 1, 1, L6, 63, 0xffffff, 4, 0, id);
      else box(OPQ, idx, x, y, z, 0, 0, 0, t, 1, 1, L6, 63, 0xffffff, 4, 0, id);
      break;
    }
    case SH.LADDER: {
      const t = p16, k = meta & 3, light = pl[idx];
      quv.set([0, 1, 1, 1, 1, 0, 0, 0]);
      if (k === 0) qp.set([x, y, z + t, x + 1, y, z + t, x + 1, y + 1, z + t, x, y + 1, z + t]);
      else if (k === 1) qp.set([x + 1 - t, y, z, x + 1 - t, y, z + 1, x + 1 - t, y + 1, z + 1, x + 1 - t, y + 1, z]);
      else if (k === 2) qp.set([x + 1, y, z + 1 - t, x, y, z + 1 - t, x, y + 1, z + 1 - t, x + 1, y + 1, z + 1 - t]);
      else qp.set([x + t, y, z + 1, x + t, y, z, x + t, y + 1, z, x + t, y + 1, z + 1]);
      quad(OPQ, d.faces[0], qp, quv, light, 0.85, 0xffffff, 4, true);
      break;
    }
    case SH.FENCE: {
      box(OPQ, idx, x, y, z, 6 * p16, 0, 6 * p16, 10 * p16, 1, 10 * p16, d.faces, 63, 0xffffff, 0);
      const bars = [[12 * p16, 15 * p16], [6 * p16, 9 * p16]];
      for (const [ya, yb] of bars) {
        if (fenceConnects(pb[idx + SX])) box(OPQ, idx, x, y, z, 10 * p16, ya, 7 * p16, 1, yb, 9 * p16, d.faces, 63 & ~2, 0xffffff, 0, 0, id);
        if (fenceConnects(pb[idx - SX])) box(OPQ, idx, x, y, z, 0, ya, 7 * p16, 6 * p16, yb, 9 * p16, d.faces, 63 & ~1, 0xffffff, 0, 0, id);
        if (fenceConnects(pb[idx + SZ])) box(OPQ, idx, x, y, z, 7 * p16, ya, 10 * p16, 9 * p16, yb, 1, d.faces, 63 & ~32, 0xffffff, 0, 0, id);
        if (fenceConnects(pb[idx - SZ])) box(OPQ, idx, x, y, z, 7 * p16, ya, 0, 9 * p16, yb, 6 * p16, d.faces, 63 & ~16, 0xffffff, 0, 0, id);
      }
      break;
    }
    case SH.BED: {
      const f = meta & 3, head = meta & 4;
      L6.set(d.faces);
      L6[2] = head ? d.tex.head : d.tex.top;
      L6[3] = d.tex.bottom;
      // outer end of each half uses the end texture; the joint between halves is hidden
      const outer = FACING_TO_FACE[head ? f : (f + 2) & 3], inner = FACING_TO_FACE[head ? (f + 2) & 3 : f];
      L6[outer] = d.tex.end;
      const rot = [2, 3, 0, 1][f];
      box(OPQ, idx, x, y, z, 0, 0, 0, 1, 9 * p16, 1, L6, 63 & ~(1 << inner), 0xffffff, 4, rot);
      break;
    }
  }
}

// Mesh one chunk. pb/pm/pl are padded (18 x 18 x 130) block/meta/light arrays.
export function meshChunk(b, m, l, cx, cz, climate) {
  pb = b; pm = m; pl = l;
  OPQ.n = 0; TRN.n = 0;
  const wx0 = cx * 16, wz0 = cz * 16;
  let tinted = false;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const colBase = ((x + 1) * PW + (z + 1)) * PH + 1;
    let top = WH - 1;
    while (top >= 0 && pb[colBase + top] === 0) top--;
    const col = x * 16 + z;
    for (let y = 0; y <= top; y++) {
      const idx = colBase + y, id = pb[idx];
      if (id === 0) continue;
      const d = blocks[id];
      if (d.tint && !tinted) {
        tinted = true;
        for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
          tints.grass[i * 16 + j] = climate.grass(wx0 + i, wz0 + j);
          tints.foliage[i * 16 + j] = climate.foliage(wx0 + i, wz0 + j);
          tints.water[i * 16 + j] = climate.water(wx0 + i, wz0 + j);
        }
      }
      if (SHAPE[id] === SH.CUBE) cube(id, pm[idx], idx, x, y, z, d, col);
      else special(id, pm[idx], idx, x, y, z, d, col, wx0 + x, wz0 + z);
    }
  }
  return { opaque: OPQ.out(), trans: TRN.out() };
}

// Standalone mesh of a single block (for held items, dropped items, falling blocks).
let single = null;
export function meshSingle(id, meta = 0) {
  if (!single) single = { b: new Uint8Array(PSIZE), m: new Uint8Array(PSIZE), l: new Uint8Array(PSIZE).fill(0xf0) };
  const i = (1 * PW + 1) * PH + 1;
  single.b[i] = id; single.m[i] = meta;
  const fake = { grass: () => 0x7fb84a, foliage: () => 0x5fa82e, water: () => 0x3f76e4 };
  const r = meshChunk(single.b, single.m, single.l, 0, 0, fake);
  single.b[i] = 0; single.m[i] = 0;
  return r;
}
