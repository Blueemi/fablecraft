// Procedural pixel-art: every texture in the game is painted here in code.
import { TEX, WOOL_COLORS, ANIM_FRAMES } from './blocks.js';
import { mulberry32, hashStr } from './noise.js';

const S = 16;
const c8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
export const rgb = (r, g, b) => (c8(r) << 16) | (c8(g) << 8) | c8(b);
export const mul = (c, f) => rgb(((c >> 16) & 255) * f, ((c >> 8) & 255) * f, (c & 255) * f);
export const mix = (a, b, t) =>
  rgb(
    ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t,
    ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t,
    (a & 255) + ((b & 255) - (a & 255)) * t,
  );
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (pal, v) => pal[clamp(Math.floor(v * pal.length), 0, pal.length - 1)];

export class Img {
  constructor(w = S, h = S) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = (c >> 16) & 255;
    this.d[i + 1] = (c >> 8) & 255;
    this.d[i + 2] = c & 255;
    this.d[i + 3] = a;
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return (this.d[i] << 16) | (this.d[i + 1] << 8) | this.d[i + 2];
  }
  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }
  fill(c, a = 255) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, a);
  }
  rect(x, y, w, h, c, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
  }
  each(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = fn(x, y);
      if (c === undefined || c === null) continue;
      if (c < 0) this.set(x, y, 0, 0);
      else this.set(x, y, c);
    }
  }
  blit(src, dx = 0, dy = 0) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const a = src.alpha(x, y);
      if (a) this.set(x + dx, y + dy, src.get(x, y), a);
    }
  }
  clone() {
    const o = new Img(this.w, this.h);
    o.d.set(this.d);
    return o;
  }
  toCanvas(scale = 1) {
    const c = document.createElement('canvas');
    c.width = this.w * scale;
    c.height = this.h * scale;
    const g = c.getContext('2d');
    if (scale === 1) g.putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
    else {
      const t = document.createElement('canvas');
      t.width = this.w; t.height = this.h;
      t.getContext('2d').putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(t, 0, 0, c.width, c.height);
    }
    return c;
  }
}

// tileable value noise over the 16px tile; px/py = lattice periods
function tnoise(r, px, py) {
  const g = [];
  for (let i = 0; i < px * py; i++) g.push(r());
  return (x, y) => {
    const u = ((x + 0.5) / S) * px, v = ((y + 0.5) / S) * py;
    const x0 = Math.floor(u), y0 = Math.floor(v);
    let fx = u - x0, fy = v - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % px) + px) % px, xb = (xa + 1) % px, ya = ((y0 % py) + py) % py, yb = (ya + 1) % py;
    const a = g[ya * px + xa], b = g[ya * px + xb], c = g[yb * px + xa], d = g[yb * px + xb];
    return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
  };
}

const painters = {};
const cache = new Map();
const T = (name, fn) => (painters[name] = fn);

export function getTex(name) {
  let im = cache.get(name);
  if (im) return im;
  im = new Img();
  const fn = painters[name];
  if (fn) fn(im, mulberry32(hashStr(name) ^ 0x9e3779b9));
  else {
    console.warn('missing texture painter:', name);
    im.each((x, y) => ((x >> 2) + (y >> 2)) & 1 ? 0xff00ff : 0x000000);
  }
  cache.set(name, im);
  return im;
}

// ASCII sprite helper: rows of chars mapped through a palette ('.'/' ' = clear)
function sprite(im, rows, pal, ox = 0, oy = 0) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const c = pal[ch];
      if (c !== undefined) im.set(x + ox, y + oy, c);
    }
  }
}

// ============================ natural blocks =====================================
const noisy = (pal, sx, sy, rnd, bias = 0) => (im, r) => {
  const n = tnoise(r, sx, sy);
  im.each((x, y) => pick(pal, n(x, y) * (1 - rnd) + r() * rnd + bias));
};

T('stone', (im, r) => {
  const n = tnoise(r, 4, 6), n2 = tnoise(r, 8, 8);
  const pal = [0x6c6c6c, 0x747474, 0x7b7b7b, 0x7f7f7f, 0x7f7f7f, 0x868686, 0x8e8e8e];
  im.each((x, y) => pick(pal, n(x, y) * 0.5 + n2(x, y) * 0.28 + r() * 0.22));
});
T('dirt', (im, r) => {
  const n = tnoise(r, 6, 6);
  const pal = [0x593d29, 0x6c4a33, 0x79553a, 0x866043, 0x866043, 0x966c4a, 0xb08158];
  im.each((x, y) => pick(pal, n(x, y) * 0.35 + r() * 0.65));
  for (let i = 0; i < 4; i++) im.set((r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? 0x8d8d8d : 0x6c6c6c);
});
const GRASS_PAL = [0x8a8a8a, 0x9a9a9a, 0xa9a9a9, 0xb6b6b6, 0xc4c4c4, 0xd6d6d6];
T('grass_top', (im, r) => {
  const n = tnoise(r, 5, 5);
  im.each((x, y) => pick(GRASS_PAL, n(x, y) * 0.4 + r() * 0.6));
});
T('grass_side', (im) => im.blit(getTex('dirt')));
T('grass_side_overlay', (im, r) => {
  for (let x = 0; x < S; x++) {
    const depth = 2 + ((r() * 3) | 0) + (r() < 0.15 ? 1 : 0);
    for (let y = 0; y < depth; y++) im.set(x, y, pick(GRASS_PAL, r() * 0.8 + (y === depth - 1 ? 0 : 0.2)));
  }
});
T('grass_side_snow', (im, r) => {
  im.blit(getTex('dirt'));
  for (let x = 0; x < S; x++) {
    const depth = 2 + ((r() * 3) | 0);
    for (let y = 0; y < depth; y++) im.set(x, y, pick([0xe4edf0, 0xf2f7f9, 0xffffff, 0xffffff], r()));
  }
});

function cells(im, r, grid, jitter, fn) {
  const pts = [];
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    pts.push([((gx + 0.5 + (r() - 0.5) * jitter) * S) / grid, ((gy + 0.5 + (r() - 0.5) * jitter) * S) / grid, r(), r()]);
  }
  im.each((x, y) => {
    let d1 = 1e9, d2 = 1e9, p1 = null, ox = 0, oy = 0;
    for (const p of pts) {
      let dx = x + 0.5 - p[0], dy = y + 0.5 - p[1];
      if (dx > 8) dx -= 16; else if (dx < -8) dx += 16;
      if (dy > 8) dy -= 16; else if (dy < -8) dy += 16;
      const d = Math.sqrt(dx * dx * 0.85 + dy * dy * 1.2);
      if (d < d1) { d2 = d1; d1 = d; p1 = p; ox = dx; oy = dy; } else if (d < d2) d2 = d;
    }
    return fn(d1, d2, p1, ox, oy, x, y);
  });
}
const cobblePainter = (im, r) => {
  const pal = [0x646464, 0x6f6f6f, 0x7a7a7a, 0x858585, 0x909090, 0x9b9b9b, 0xa5a5a5];
  cells(im, r, 3, 0.75, (d1, d2, p, ox, oy) => {
    if (d2 - d1 < 1.25) return r() < 0.35 ? 0x5c5c5c : 0x525252;
    return pick(pal, 0.3 + p[2] * 0.3 + (-ox - oy * 1.2) * 0.055 + (r() - 0.5) * 0.14);
  });
};
T('cobblestone', cobblePainter);
const mossify = (base) => (im, r) => {
  im.blit(getTex(base));
  const n = tnoise(r, 4, 4);
  const moss = [0x35521f, 0x45672a, 0x537a33, 0x628b3c];
  im.each((x, y) => {
    if (n(x, y) + r() * 0.25 < 0.62) return null;
    const b = (im.get(x, y) & 255) / 170;
    return mul(pick(moss, r()), clamp(b, 0.55, 1.15));
  });
};
T('mossy_cobblestone', mossify('cobblestone'));
T('gravel', (im, r) => {
  const bases = [0x7f7b7a, 0x8b8381, 0x6d6968, 0x9a928d, 0x77706d, 0x857c78, 0x8f8a88];
  cells(im, r, 4, 0.9, (d1, d2, p, ox, oy) => {
    if (d2 - d1 < 0.7) return r() < 0.5 ? 0x595554 : 0x646060;
    return mul(pick(bases, p[2]), 0.95 + (-ox - oy) * 0.05 + (r() - 0.5) * 0.1);
  });
});
T('sand', (im, r) => {
  const n = tnoise(r, 6, 6);
  const pal = [0xcbc18b, 0xd5cb97, 0xdbd3a0, 0xdbd3a0, 0xe1d9ab, 0xe9e2b9];
  im.each((x, y) => pick(pal, n(x, y) * 0.3 + r() * 0.7));
});
T('bedrock', (im, r) => {
  const n = tnoise(r, 5, 5);
  const pal = [0x1b1b1b, 0x2f2f2f, 0x4a4a4a, 0x565656, 0x6f6f6f, 0x959595];
  im.each((x, y) => pick(pal, n(x, y) * 0.55 + r() * 0.5 - 0.02));
});
T('clay', noisy([0x9197a3, 0x9aa0ab, 0xa1a7b3, 0xa1a7b3, 0xaab0bc], 5, 5, 0.6));
T('snow', noisy([0xe9f1f5, 0xf3f8fa, 0xfbfdfe, 0xffffff, 0xffffff], 4, 4, 0.5));
T('obsidian', (im, r) => {
  const n = tnoise(r, 4, 4);
  const pal = [0x07050d, 0x0f0b19, 0x15101f, 0x1c1530, 0x2a2044, 0x3d3160];
  im.each((x, y) => pick(pal, n(x, y) * 0.6 + r() * 0.42 - 0.08));
});
T('granite', noisy([0x7c4f3f, 0x8f5f4c, 0x9c6b57, 0xa77561, 0xb5846f, 0xc59a86], 6, 6, 0.75));
T('diorite', noisy([0x8d8d8d, 0xa9a9a9, 0xc6c6c6, 0xd6d6d6, 0xe4e4e4, 0xf0f0f0], 7, 7, 0.8));
T('andesite', noisy([0x6d6d71, 0x7c7c80, 0x88888b, 0x8e8e91, 0x99999c], 7, 7, 0.75));
T('smooth_stone', (im, r) => {
  const n = tnoise(r, 4, 4);
  im.each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return r() < 0.5 ? 0x8b8b8b : 0x929292;
    return pick([0x9c9c9c, 0xa2a2a2, 0xa8a8a8, 0xadadad], n(x, y) * 0.6 + r() * 0.4);
  });
});
T('ice', (im, r) => {
  const n = tnoise(r, 4, 4);
  const pal = [0x7aa8f8, 0x8ab4fb, 0x9cc0fd, 0xb4d1ff, 0xd0e3ff];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const streak = (x + y * 2) % 11 === 0 || (x * 2 + y + 5) % 13 === 0 ? 0.3 : 0;
    im.set(x, y, pick(pal, n(x, y) * 0.6 + r() * 0.2 + streak), 190);
  }
});
T('glowstone', (im, r) => {
  const pal = [0x7d5a2a, 0xa57a36, 0xd0a045, 0xf0c658, 0xfbe08a, 0xfff6c4];
  cells(im, r, 4, 0.9, (d1, d2, p) => pick(pal, clamp((d2 - d1) * 0.28 + p[2] * 0.25 + r() * 0.12, 0, 0.99)));
});

// ============================ sandstone ===========================================
T('sandstone_top', noisy([0xd3c992, 0xd9d09c, 0xddd5a3, 0xe2daae], 5, 5, 0.6));
T('sandstone_bottom', noisy([0xc4b982, 0xcbc18b, 0xd2c894, 0xd8cf9c], 5, 5, 0.6));
T('sandstone_side', (im, r) => {
  const n = tnoise(r, 2, 8);
  im.each((x, y) => {
    if (y === 0) return 0xe6dfb6;
    if (y === 1) return r() < 0.5 ? 0xdcd4a4 : 0xd6cd9a;
    if (y === 2 || y === 13) return r() < 0.75 ? 0xb9ad76 : 0xc4b982;
    if (y === 15) return 0xc0b47c;
    return pick([0xcfc48d, 0xd5cb96, 0xdad1a0, 0xdfd7aa], n(x, y) * 0.7 + r() * 0.3);
  });
});

// ============================ wood ==================================================
const planks = (base) => (im, r) => {
  const c = [mul(base, 0.6), mul(base, 0.78), mul(base, 0.9), base, mul(base, 1.08)];
  const g = tnoise(r, 3, 16);
  const joints = [5, 13, 2, 10];
  im.each((x, y) => {
    const board = y >> 2, ry = y & 3;
    if (ry === 3) return r() < 0.8 ? c[0] : c[1];
    if (x === joints[board]) return c[1];
    const v = g(x + board * 5, y) * 0.75 + r() * 0.25;
    if (ry === 0 && v > 0.45) return c[4];
    return v < 0.3 ? c[2] : v > 0.72 ? c[4] : c[3];
  });
};
T('planks_oak', planks(0xb08e5a));
T('planks_birch', planks(0xd0c088));
T('planks_spruce', planks(0x735533));

const bark = (pal, spots) => (im, r) => {
  const n = tnoise(r, 16, 3);
  im.each((x, y) => pick(pal, n(x, y) * 0.75 + r() * 0.25));
  if (spots) {
    for (let i = 0; i < 9; i++) {
      const x = (r() * 16) | 0, y = (r() * 16) | 0, w = 2 + ((r() * 3) | 0);
      for (let j = 0; j < w; j++) im.set((x + j) % 16, y, r() < 0.7 ? spots[0] : spots[1]);
    }
  }
};
T('log_oak', bark([0x3d2f1b, 0x4d3c24, 0x5a472b, 0x665232, 0x735d3a], null));
T('log_spruce', bark([0x231709, 0x2e1f0e, 0x3a2914, 0x45321a, 0x503b20], null));
T('log_birch', bark([0xc9c9c0, 0xd6d6cf, 0xe2e2dc, 0xececE8, 0xf5f5f2], [0x2a2a26, 0x4a4a44]));
const logTop = (ring, barkCol) => (im, r) => {
  im.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 7) return mul(barkCol, 0.85 + r() * 0.3);
    if (d > 6) return mul(ring, 0.72 + r() * 0.08);
    const k = Math.floor(d) % 2 === 0 ? 1.0 : 0.86;
    return mul(ring, k + (r() - 0.5) * 0.07);
  });
};
T('log_oak_top', logTop(0xb8945f, 0x5a472b));
T('log_spruce_top', logTop(0x7d5f3a, 0x3a2914));
T('log_birch_top', logTop(0xd2c38c, 0xdcdcd6));

const leaves = (holes, pal) => (im, r) => {
  const n = tnoise(r, 8, 8);
  im.each((x, y) => {
    const v = n(x, y) * 0.55 + r() * 0.45;
    if (v < holes) return -1;
    return pick(pal, (v - holes) / (1 - holes) + (r() - 0.5) * 0.3);
  });
};
T('leaves_oak', leaves(0.34, [0x5e5e5e, 0x858585, 0xa3a3a3, 0xbdbdbd, 0xd3d3d3, 0xe8e8e8]));
T('leaves_birch', leaves(0.33, [0x6a6a6a, 0x8e8e8e, 0xababab, 0xc4c4c4, 0xdadada, 0xeeeeee]));
T('leaves_spruce', leaves(0.3, [0x4e4e4e, 0x707070, 0x8f8f8f, 0xa8a8a8, 0xbebebe, 0xd0d0d0]));

// ============================ ores & minerals =====================================
const ore = (light, main, dark) => (im, r) => {
  im.blit(getTex('stone'));
  const spots = [[3, 3], [10, 2], [6, 7], [12, 8], [2, 11], [8, 12], [13, 13], [1, 7]];
  for (const [sx, sy] of spots) {
    if (r() < 0.12) continue;
    const x = sx + ((r() * 3) | 0) - 1, y = sy + ((r() * 3) | 0) - 1;
    const shape = [[0, 0], [1, 0], [0, 1], [1, 1]];
    if (r() < 0.5) shape.push([2, r() < 0.5 ? 0 : 1]);
    if (r() < 0.4) shape.push([r() < 0.5 ? 0 : 1, -1]);
    if (r() < 0.35) shape.splice((r() * 4) | 0, 1);
    for (const [dx, dy] of shape) {
      const px = (x + dx + 16) % 16, py = (y + dy + 16) % 16;
      im.set(px, py, dx + dy <= 0 ? light : dx + dy >= 2 ? dark : main);
    }
    for (const [dx, dy] of shape) {
      const px = (x + dx + 16) % 16, py = (y + dy + 1 + 16) % 16;
      const c = im.get(px, py);
      if (c !== light && c !== main && c !== dark) im.set(px, py, 0x5c5c5c);
    }
  }
};
T('coal_ore', ore(0x454545, 0x2a2a2a, 0x151515));
T('iron_ore', ore(0xe6c3a8, 0xd0a584, 0xa87d60));
T('gold_ore', ore(0xfffbb0, 0xfcdc3a, 0xe0a51c));
T('diamond_ore', ore(0xd6fffa, 0x5decf5, 0x26b9c4));
T('redstone_ore', ore(0xff6a5a, 0xe01208, 0x8f0603));
T('lapis_ore', ore(0x5a85e8, 0x2452c0, 0x143080));

const mineral = (base, light, dark, band) => (im, r) => {
  im.each((x, y) => {
    if (x === 0 || y === 0) return light;
    if (x === 15 || y === 15) return dark;
    if (x === 1 || y === 1) return mix(base, light, 0.5);
    if (x === 14 || y === 14) return mix(base, dark, 0.5);
    if (band) return (y - 2) % 4 === 3 ? mix(base, dark, 0.35) : (y - 2) % 4 === 0 ? mix(base, light, 0.4) : base;
    const k = (x + y) % 7;
    return k === 0 ? mix(base, light, 0.65) : k === 3 ? mix(base, dark, 0.3) : r() < 0.06 ? light : base;
  });
};
T('gold_block', mineral(0xf6d33c, 0xffffb8, 0xc88a12, false));
T('iron_block', mineral(0xd9d9d9, 0xffffff, 0x9a9a9a, true));
T('diamond_block', mineral(0x60e6dc, 0xdafffa, 0x1f9d96, false));
T('coal_block', mineral(0x1c1c1c, 0x3a3a3a, 0x080808, false));
T('lapis_block', mineral(0x234fb4, 0x5a86e8, 0x122a78, false));
T('redstone_block', mineral(0xb81505, 0xff4a36, 0x700800, false));

// ============================ building blocks =====================================
T('bricks', (im, r) => {
  const pal = [0x8a4a37, 0x96553f, 0xa35f47, 0xae6a50];
  im.each((x, y) => {
    const row = y >> 2;
    if ((y & 3) === 3) return r() < 0.5 ? 0xb8ad9d : 0xa99e8e;
    const xo = (x + (row & 1 ? 4 : 0)) & 7;
    if (xo === 7) return r() < 0.5 ? 0xb8ad9d : 0xa99e8e;
    const base = pal[(row * 3 + ((x + (row & 1 ? 4 : 0)) >> 3) * 5) & 3];
    return mul(base, (y & 3) === 0 ? 1.08 : (y & 3) === 2 ? 0.92 : 1 + (r() - 0.5) * 0.06);
  });
});
const stoneBricks = (im, r) => {
  const n = tnoise(r, 4, 4);
  im.each((x, y) => {
    const top = y < 8, ry = y & 7;
    const seam = top ? 15 : 7;
    if (ry === 7 || x === seam) return r() < 0.6 ? 0x555555 : 0x606060;
    if (ry === 0 || x === (seam + 1) % 16) return 0x9a9a9a;
    return pick([0x717171, 0x7a7a7a, 0x808080, 0x878787], n(x, y) * 0.6 + r() * 0.4);
  });
};
T('stone_bricks', stoneBricks);
T('mossy_stone_bricks', mossify('stone_bricks'));
T('glass', (im) => {
  im.each((x, y) => {
    if (x === 0 || y === 0) return 0xe8f8fb;
    if (x === 15 || y === 15) return 0xa7c9cf;
    if ((x === 3 && y === 5) || (x === 4 && y === 4) || (x === 5 && y === 3) || (x === 4 && y === 7) || (x === 5 && y === 6)) return 0xe0f6fa;
    if ((x === 11 && y === 11) || (x === 12 && y === 10) || (x === 10 && y === 12)) return 0xcdeaf0;
    return -1;
  });
});
T('tnt_side', (im, r) => {
  im.each((x, y) => {
    if (y >= 5 && y <= 10) return y === 5 || y === 10 ? 0xcfcfcf : 0xeeeeee;
    const k = x & 3;
    const c = k === 3 ? 0x8e1a12 : k === 0 ? 0xe5402c : 0xcf2e1e;
    return mul(c, 0.96 + r() * 0.08);
  });
  const f = { T: ['###', '.#.', '.#.', '.#.'], N: ['#.#', '###', '###', '#.#'] };
  const draw = (g, ox) => g.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && im.set(ox + i, 6 + j, 0x1c1c1c)));
  draw(f.T, 2); draw(f.N, 6); draw(f.T, 10);
});
const tntEnd = (fuse) => (im, r) => {
  im.each((x, y) => {
    const cx = (x & 3) - 1.5, cy = (y & 3) - 1.5, d = cx * cx + cy * cy;
    if (d > 3.5) return 0x7a160f;
    return mul(d < 1 ? 0xe5402c : 0xc72a1b, 0.96 + r() * 0.08);
  });
  if (fuse) {
    im.rect(6, 6, 4, 4, 0x2e2e2e);
    im.rect(7, 7, 2, 2, 0x8a8a8a);
  }
};
T('tnt_top', tntEnd(true));
T('tnt_bottom', tntEnd(false));
T('bookshelf', (im, r) => {
  const pl = getTex('planks_oak');
  im.blit(pl);
  const cols = [0xa8362a, 0x3b7a3a, 0x34509a, 0x7a4a23, 0xc9b27a, 0x6b3a8a, 0x2f8a8a, 0xb8862a];
  for (const y0 of [2, 9]) {
    im.rect(0, y0, 16, 5, 0x2a1d10);
    let x = 0;
    while (x < 16) {
      const w = r() < 0.55 ? 2 : r() < 0.6 ? 1 : 3;
      const c = cols[(r() * cols.length) | 0], hgt = r() < 0.3 ? 4 : 5;
      for (let i = 0; i < w && x + i < 16; i++) for (let j = 5 - hgt; j < 5; j++) {
        im.set(x + i, y0 + j, mul(c, (i === 0 ? 1.1 : i === w - 1 && w > 1 ? 0.8 : 1) * (j === 1 || j === 3 ? 1 : 0.92)));
      }
      if (w > 1 && r() < 0.6) im.set(x, y0 + 2, 0xe8d9a0);
      x += w;
      if (r() < 0.2) x += 1;
    }
  }
});
const chest = (kind) => (im, r) => {
  const g = tnoise(r, 3, 12);
  im.each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return 0x2f2110;
    if (x === 1 || y === 1 || x === 14 || y === 14) return 0x4a3319;
    let c = mul(0xa8742c, 0.88 + g(x, y) * 0.24);
    if (kind !== 'top' && (y === 5 || y === 4)) c = y === 5 ? 0x33240f : mul(c, 0.8);
    if (kind === 'top' && (x === 7 || x === 8)) c = mul(c, 0.86);
    return c;
  });
  if (kind === 'front') {
    im.rect(6, 3, 4, 5, 0x3a3a3a);
    im.rect(7, 3, 2, 4, 0xd8d8d8);
    im.set(7, 6, 0x9a9a9a); im.set(8, 6, 0x9a9a9a);
  }
};
T('chest_top', chest('top'));
T('chest_side', chest('side'));
T('chest_front', chest('front'));
T('crafting_top', (im, r) => {
  const g = tnoise(r, 3, 12);
  im.each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return 0x4a3319;
    if (x === 1 || y === 1 || x === 14 || y === 14) return 0x6b4a26;
    const grid = x === 5 || x === 10 || y === 5 || y === 10;
    const c = mul(0xb8854a, 0.9 + g(x, y) * 0.2);
    return grid ? mul(c, 0.68) : c;
  });
});
const craftSide = (front) => (im) => {
  im.blit(getTex('planks_oak'));
  im.rect(0, 0, 16, 1, 0x6b4a26);
  im.rect(0, 1, 16, 2, 0x4a3319);
  im.rect(0, 3, 16, 1, 0x7a5a30);
  im.rect(0, 4, 1, 12, 0x5a4226); im.rect(15, 4, 1, 12, 0x5a4226);
  if (front) {
    sprite(im, ['.gg....', 'gkkg...', 'gkkg.b.', '.gg.b..', '...b...', '..b....', '.b.....'], { g: 0xbdbdbd, k: 0x8a8a8a, b: 0x5a4226 }, 3, 6);
    sprite(im, ['ggg', 'gkg', '.b.', '.b.', '.b.'], { g: 0xc8c8c8, k: 0x8a8a8a, b: 0x5a4226 }, 11, 7);
  } else {
    sprite(im, ['gggggg.', 'gkgkgk.', '.....bb', '.....bb'], { g: 0xc8c8c8, k: 0x7a7a7a, b: 0x5a4226 }, 3, 7);
    sprite(im, ['.bb', 'gbg', 'ggg', '.b.', '.b.'], { g: 0xbdbdbd, b: 0x5a4226 }, 11, 9);
  }
};
T('crafting_side', craftSide(false));
T('crafting_front', craftSide(true));
const furnaceBase = (im, r) => {
  const n = tnoise(r, 4, 4);
  im.each((x, y) => {
    if (y === 0 || y === 15) return 0x5a5a5a;
    if (x === 0 || x === 15) return 0x646464;
    if (y === 1 || y === 14) return 0x9a9a9a;
    return pick([0x767676, 0x808080, 0x888888, 0x909090], n(x, y) * 0.5 + r() * 0.5);
  });
};
T('furnace_side', (im, r) => {
  furnaceBase(im, r);
  for (let x = 1; x < 15; x++) { im.set(x, 5, 0x626262); im.set(x, 10, 0x626262); }
  for (const [x, y0] of [[5, 1], [11, 1], [8, 6], [3, 11], [12, 11]]) for (let y = y0; y < y0 + 4 && y < 15; y++) im.set(x, y, 0x626262);
});
T('furnace_top', (im, r) => {
  const n = tnoise(r, 4, 4);
  im.each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return 0x5a5a5a;
    if (x === 1 || y === 1 || x === 14 || y === 14) return 0x8e8e8e;
    return pick([0x6c6c6c, 0x747474, 0x7c7c7c], n(x, y) * 0.5 + r() * 0.5);
  });
});
const furnaceFront = (lit) => (im, r) => {
  furnaceBase(im, r);
  im.rect(4, 3, 8, 3, 0x2b2b2b);
  im.rect(5, 4, 6, 1, 0x161616);
  im.rect(3, 9, 10, 5, 0x3a3a3a);
  im.rect(4, 8, 8, 1, 0x3a3a3a);
  for (let y = 9; y < 14; y++) for (let x = 4; x < 12; x++) {
    if (!lit) im.set(x, y, y === 9 ? 0x101010 : 0x1b1b1b);
    else {
      const h = 13 - y + (r() - 0.5) * 1.6;
      im.set(x, y, h < 1 ? 0xfff2a0 : h < 2 ? 0xffc83a : h < 3.2 ? 0xf58a1a : 0xb8380f);
    }
  }
};
T('furnace_front', furnaceFront(false));
T('furnace_front_lit', furnaceFront(true));
T('ladder', (im, r) => {
  im.each(() => -1);
  for (let y = 0; y < 16; y++) {
    for (const x of [2, 12]) {
      im.set(x, y, mul(0x9b7a45, 0.95 + r() * 0.1));
      im.set(x + 1, y, 0x6b5230);
    }
  }
  for (const y of [1, 5, 9, 13]) {
    for (let x = 1; x < 15; x++) {
      im.set(x, y, mul(0xa8854c, 0.95 + r() * 0.1));
      im.set(x, y + 1, 0x5f4725);
    }
  }
});
const door = (top) => (im, r) => {
  const g = tnoise(r, 12, 3);
  im.each((x, y) => {
    if (x === 0 || x === 15) return 0x5a4226;
    const c = mul(0xa8854c, 0.9 + g(x, y) * 0.2);
    return c;
  });
  const hole = (x0, y0, w, h, clear) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      if (edge) im.set(x, y, 0x5f4725);
      else if (clear) im.set(x, y, 0, 0);
      else im.set(x, y, mul(im.get(x, y), 0.82));
    }
  };
  if (top) {
    im.rect(0, 0, 16, 1, 0x5a4226);
    hole(2, 2, 6, 6, true); hole(8, 2, 6, 6, true);
    hole(2, 8, 6, 6, true); hole(8, 8, 6, 6, true);
    im.rect(12, 14, 2, 2, 0xd0d0d0);
  } else {
    im.rect(0, 15, 16, 1, 0x5a4226);
    hole(2, 1, 12, 6, false);
    hole(2, 8, 12, 6, false);
  }
};
T('door_top', door(true));
T('door_bottom', door(false));
T('farmland_dry', (im, r) => {
  im.each((x, y) => mul(pick([0x6b4a31, 0x7a553a, 0x866043], r()), (y & 3) === 0 ? 0.72 : (y & 3) === 1 ? 0.88 : 1));
});
T('farmland_wet', (im, r) => {
  im.each((x, y) => mul(pick([0x3d2716, 0x47301c, 0x513822], r()), (y & 3) === 0 ? 0.7 : (y & 3) === 1 ? 0.88 : 1));
});
T('cactus_side', (im, r) => {
  im.each((x, y) => {
    const k = x % 3;
    const c = k === 1 ? 0x3d7a28 : k === 0 ? 0x5a9c3a : 0x4f8c32;
    return mul(c, 0.94 + r() * 0.12);
  });
  for (let i = 0; i < 14; i++) {
    const x = 1 + 3 * ((r() * 5) | 0), y = (r() * 16) | 0;
    im.set(x, y, r() < 0.6 ? 0xe6e6c8 : 0x1c2b10);
  }
});
T('cactus_top', (im, r) => {
  im.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 7) return 0x3d7a28;
    if (d > 6) return 0x356b22;
    return mul(d < 2 ? 0x74b84e : Math.floor(d) % 2 ? 0x5a9c3a : 0x66aa42, 0.95 + r() * 0.1);
  });
});
T('cactus_bottom', (im, r) => {
  im.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6) return 0x3d7a28;
    return mul(0xc9c98c, 0.9 + r() * 0.15);
  });
});
const pumpkinSide = (im, r) => {
  im.each((x, y) => {
    const k = x & 3;
    const c = k === 0 ? 0xa85a10 : k === 2 ? 0xe89628 : 0xd47e1c;
    return mul(c, (y < 2 ? 1.1 : y > 13 ? 0.85 : 1) * (0.95 + r() * 0.1));
  });
};
T('pumpkin_side', pumpkinSide);
T('pumpkin_top', (im, r) => {
  im.each((x, y) => {
    const dx = x - 7.5, dy = y - 7.5;
    const a = Math.atan2(dy, dx), seam = Math.abs(Math.sin(a * 4)) < 0.25 && Math.hypot(dx, dy) > 2.5;
    return mul(seam ? 0xa85a10 : 0xd98420, 0.94 + r() * 0.12);
  });
  im.rect(6, 6, 4, 4, 0x5c6b24);
  im.rect(7, 7, 2, 2, 0x7d8f33);
});
const pumpkinFace = (lit) => (im, r) => {
  pumpkinSide(im, r);
  const a = lit ? 0xffe14d : 0x2b1503, b = lit ? 0xf5a623 : 0x1c0d02;
  sprite(im, [
    '..aa......aa..',
    '.aaab....aaab.',
    '.abbb....abbb.',
    '..............',
    '......aa......',
    '.....abb......',
    '..............',
    '.a..a..a..a.a.',
    '.aaaaaaaaaaaa.',
    '..abbabbabbb..',
    '...b..b..b....',
  ], { a, b }, 1, 3);
};
T('pumpkin_face', pumpkinFace(false));
T('pumpkin_face_lit', pumpkinFace(true));
WOOL_COLORS.forEach(([, , col], i) =>
  T('wool_' + i, (im, r) => {
    const n = tnoise(r, 8, 8);
    im.each((x, y) => mul(col, 0.86 + n(x, y) * 0.16 + ((x + y) & 1 ? 0.03 : 0) + ((x * 3 + y) % 5 === 0 ? -0.05 : 0) + r() * 0.05));
  }),
);
const bedTop = (head) => (im, r) => {
  im.each((x, y) => mul(0xa32a2a, 0.92 + r() * 0.1 + ((x + y) & 1 ? 0.04 : 0)));
  if (head) {
    im.rect(0, 0, 16, 8, 0xa32a2a);
    for (let y = 1; y < 7; y++) for (let x = 1; x < 15; x++) im.set(x, y, mul(0xeaeaea, 0.94 + r() * 0.08 - (y === 6 || x === 14 ? 0.12 : 0)));
    im.rect(0, 0, 16, 1, 0x7a5a30);
  } else {
    im.rect(0, 15, 16, 1, 0x7a1f1f);
  }
};
T('bed_top_foot', bedTop(false));
T('bed_top_head', bedTop(true));
const bedSide = (im, r) => {
  im.each((x, y) => {
    if (y < 7) return -1;
    if (y < 12) return mul(0xa32a2a, 0.9 + r() * 0.1 - (y === 11 ? 0.12 : 0));
    if (y < 13) return mul(0x9a7a45, 1);
    return x < 3 || x > 12 ? mul(0x8a6a3a, 0.9 + r() * 0.15) : y === 13 ? 0x6b5230 : -1;
  });
};
T('bed_side', bedSide);
T('bed_end', bedSide);

// ============================ plants ================================================
T('tall_grass', (im, r) => {
  im.each(() => -1);
  for (let i = 0; i < 9; i++) {
    let x = 1 + ((r() * 14) | 0);
    const h = 4 + ((r() * 10) | 0), lean = r() < 0.5 ? -1 : 1, bend = 3 + ((r() * 4) | 0);
    for (let j = 0; j < h; j++) {
      const y = 15 - j;
      if (j > 0 && j % bend === 0) x += lean;
      im.set(x, y, pick(GRASS_PAL, 0.02 + (j / h) * 0.62 + (r() - 0.5) * 0.2));
    }
  }
});
T('dead_bush', (im, r) => {
  im.each(() => -1);
  const rows = [
    '................', '................', '.....b....b.....', '..b...b..b...b..', '...b..b..b..b...', '....b..bb..b....',
    '.b...b.bb.b...b.', '..bb..bbbb..bb..', '....bbbbbbbb....', '......bbbb......', '.......bb.......', '.......bb.......',
    '.......bb.......', '......bbb.......', '.......bb.......', '.......bb.......',
  ];
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'b' && im.set(x, y, pick([0x5a3d1a, 0x6b4a22, 0x7d5a2b, 0x8a6632], r()))));
});
const flower = (rows, pal) => (im) => {
  im.each(() => -1);
  sprite(im, rows, { g: 0x3f8a2a, G: 0x2f6b1e, ...pal });
};
T('dandelion', flower([
  '', '', '', '', '', '', '......yYy.......', '.....yYOYy......', '.....yYYYy......', '......yyy.......', '.......g........',
  '.......g........', '......Gg........', '.......g.G......', '.......gG.......', '.......g........',
], { y: 0xf2c81a, Y: 0xffec4f, O: 0xe8a00e }));
T('poppy', flower([
  '', '', '', '', '', '......rRr.......', '.....rRRRr......', '.....RRkRR......', '.....rRRRr......', '......rRr.......', '.......g........',
  '......Gg........', '.......g..G.....', '.......g.G......', '.......gG.......', '.......g........',
], { R: 0xe0251b, r: 0xa8160f, k: 0x2a0808 }));
T('cornflower', flower([
  '', '', '', '', '.....b.b.b......', '......bBb.......', '.....bBLBb......', '......bBb.......', '.....b.g.b......', '.......g........', '.......g........',
  '......Gg........', '.......g.G......', '.......gG.......', '.......g........', '.......g........',
], { B: 0x4a6cf0, b: 0x2f49b8, L: 0x9fb4ff }));
T('allium', flower([
  '', '', '......pPp.......', '.....pPPLp......', '....pPPPPPp.....', '....pPLPPPp.....', '.....pPPPp......', '......pPp.......', '.......g........',
  '.......g........', '.......g........', '.......g........', '......Gg........', '.......gG.......', '.......g........', '.......g........',
], { P: 0xb878e8, p: 0x8a4fc0, L: 0xe0c0ff }));
T('daisy', flower([
  '', '', '', '', '......w.w.......', '.....wwWww......', '......WYW.......', '.....wwWww......', '......w.w.......', '.......g........', '.......g........',
  '......Gg........', '.......g.G......', '.......gG.......', '.......g........', '.......g........',
], { w: 0xe8e8e8, W: 0xffffff, Y: 0xf2c81a }));
T('mushroom_brown', flower([
  '', '', '', '', '', '', '', '', '', '', '.....bbbbbb.....', '....bBBBBBBb....', '....bbbbbbbb....', '.......ss.......', '.......ss.......', '.......sS.......',
], { b: 0x8a6a4f, B: 0xb08e6c, s: 0xd8d0c0, S: 0xb8b0a0 }));
T('mushroom_red', flower([
  '', '', '', '', '', '', '', '', '', '......rrrr......', '.....rRwRRr.....', '....rRRRRwRr....', '....rwRRRRRr....', '.....s.ss.s.....', '.......ss.......', '.......sS.......',
], { r: 0xa81a12, R: 0xd92a1e, w: 0xf5f5f5, s: 0xd8d0c0, S: 0xb8b0a0 }));
T('sapling_oak', flower([
  '', '', '', '......ggg.......', '....gGGgGg......', '...gGgGGGGg.....', '...GGGGgGGg.....', '....gGGGGg..g...', '..gg.gGbGggGg...', '.gGGg.gbg.gg....',
  '..gg...b........', '.......bb.......', '.......b........', '......bb........', '.......b........', '.......b........',
], { G: 0x4f9a2e, g: 0x356e1c, b: 0x6b4a22 }));
T('sapling_birch', flower([
  '', '', '', '.......gg.......', '.....gGGGg......', '....gGGgGGg.....', '....GGGGGGg.....', '.....gGGGg......', '...g..gwg..gg...', '..gGg..w..gGg...',
  '...g...k...g....', '.......w........', '.......w........', '.......k........', '.......w........', '.......w........',
], { G: 0x8fc05a, g: 0x5f8f38, w: 0xe2e2dc, k: 0x4a4a44 }));
T('sapling_spruce', flower([
  '', '', '.......g........', '......gGg.......', '.......G........', '.....gGGGg......', '......gGg.......', '....gGGGGGg.....', '.....gGGGg......', '...gGGGGGGGg....',
  '....gGGbGGg.....', '.......b........', '.......b........', '.......b........', '.......b........', '.......b........',
], { G: 0x3f7a45, g: 0x285230, b: 0x3a2914 }));
T('sugar_cane', (im, r) => {
  im.each(() => -1);
  for (const x0 of [2, 7, 12]) {
    const off = (r() * 4) | 0;
    for (let y = 0; y < 16; y++) {
      const node = (y + off) % 5 === 0;
      im.set(x0, y, node ? 0x4f7f38 : 0x8ac464);
      im.set(x0 + 1, y, node ? 0x416b2e : 0x6ca84c);
    }
    for (let k = 0; k < 2; k++) {
      const y = 2 + ((r() * 11) | 0), dir = r() < 0.5 ? -1 : 2;
      im.set(x0 + dir, y, 0x6ca84c);
      im.set(x0 + dir + (dir < 0 ? -1 : 1), y - 1, 0x8ac464);
    }
  }
});
for (let st = 0; st < 8; st++) {
  T('wheat_' + st, (im, r) => {
    im.each(() => -1);
    const h = 3 + Math.round(st * 1.6);
    const green = [0x1f7a1a, 0x2f9a22, 0x45b02e], gold = [0xa8841e, 0xd0aa32, 0xe8c84a];
    const t = st < 5 ? 0 : st === 5 ? 0.35 : st === 6 ? 0.7 : 1;
    for (const x0 of [1, 3, 5, 7, 9, 11, 13, 14]) {
      const hh = Math.max(2, h - ((r() * 3) | 0));
      let x = x0;
      for (let j = 0; j < hh; j++) {
        if (j > 2 && r() < 0.18) x += r() < 0.5 ? -1 : 1;
        const k = (r() * 3) | 0;
        im.set(x, 15 - j, mix(green[k], gold[k], t));
        if (st >= 6 && j >= hh - 4) {
          im.set(x + (j & 1 ? 1 : -1), 15 - j, mix(green[2], st === 7 ? 0xf2d868 : 0xc8c050, t));
        }
      }
    }
  });
}
T('torch', (im) => {
  im.each(() => -1);
  sprite(im, ['WY', 'YO', 'bB', 'bB', 'dB', 'bB', 'bB', 'dB', 'bB', 'bB'], { W: 0xffffc0, Y: 0xffd83d, O: 0xf59a17, b: 0x6b5130, B: 0x8f6f42, d: 0x57412a }, 7, 6);
});

// ============================ fluids & fire (animated) ============================
for (let f = 0; f < ANIM_FRAMES; f++) {
  T('water_' + f, (im) => {
    const r = mulberry32(777);
    const n = tnoise(r, 4, 4), n2 = tnoise(r, 8, 8);
    const ph = (f / ANIM_FRAMES) * Math.PI * 2;
    const pal = [0xa8a8a8, 0xb8b8b8, 0xc6c6c6, 0xd2d2d2, 0xe2e2e2, 0xf6f6f6];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = 0.5 + 0.09 * Math.sin(((x + y * 0.5) * Math.PI) / 4 + ph) + 0.08 * Math.sin(((y * 1.5 - x * 0.5) * Math.PI) / 4 - ph * 2) +
        (n(x, y) - 0.5) * 0.22 * Math.cos(ph) + (n2(x, y) - 0.5) * 0.34 * Math.sin(ph) + (n2((x + 5) % 16, (y + 9) % 16) - 0.5) * 0.3 * Math.cos(ph + 1.3);
      im.set(x, y, pick(pal, v), 160 + ((v * 40) | 0));
    }
  });
  T('lava_' + f, (im) => {
    const r = mulberry32(4242);
    const a = tnoise(r, 3, 3), b = tnoise(r, 4, 4), c = tnoise(r, 8, 8);
    const ph = (f / ANIM_FRAMES) * Math.PI * 2;
    const pal = [0xa83206, 0xc4500c, 0xd96a12, 0xe8841a, 0xf5a626, 0xf9cc40, 0xfdf07a];
    im.each((x, y) => {
      const v = a(x, y) * (0.5 + 0.3 * Math.cos(ph)) + b(x, y) * (0.5 + 0.3 * Math.sin(ph)) + c(x, y) * 0.2 + 0.1 * Math.sin(((x + y) * Math.PI) / 8 + ph);
      return pick(pal, v * 0.95 - 0.05);
    });
  });
  T('fire_' + f, (im) => {
    const r = mulberry32(999 + f * 31);
    const ph = (f / ANIM_FRAMES) * Math.PI * 2;
    im.each((x, y) => {
      const h = 9 + 3 * Math.sin(x * 1.3 + ph * 2) + 2.5 * Math.sin(x * 2.9 - ph * 3 + 1) + r() * 2.5;
      const fy = 15 - y;
      if (fy > h) return -1;
      const t = fy / h + (r() - 0.5) * 0.25;
      if (t > 0.75 && r() < 0.3) return -1;
      return t < 0.2 ? 0xfff6b0 : t < 0.42 ? 0xffd23a : t < 0.68 ? 0xf58a1a : 0xd0440f;
    });
  });
}

// ============================ overlays & particles ================================
{
  // crack growth: random walks from the centre, revealed progressively
  const r = mulberry32(31337);
  const order = [];
  const seen = new Set();
  for (let w = 0; w < 9; w++) {
    let x = 7 + ((r() * 2) | 0), y = 7 + ((r() * 2) | 0);
    let dx = Math.cos((w / 9) * Math.PI * 2 + r()), dy = Math.sin((w / 9) * Math.PI * 2 + r());
    let fx = x, fy = y;
    for (let i = 0; i < 14; i++) {
      const k = x + y * 16;
      if (x < 0 || y < 0 || x > 15 || y > 15) break;
      if (!seen.has(k)) { seen.add(k); order.push([x, y, i + w * 0.6 + r() * 2]); }
      const a = (r() - 0.5) * 1.4;
      const ndx = dx * Math.cos(a) - dy * Math.sin(a), ndy = dx * Math.sin(a) + dy * Math.cos(a);
      dx = dx * 0.6 + ndx * 0.4; dy = dy * 0.6 + ndy * 0.4;
      fx += dx; fy += dy;
      x = Math.round(fx); y = Math.round(fy);
    }
  }
  order.sort((a, b) => a[2] - b[2]);
  for (let s = 0; s < 10; s++) {
    T('crack_' + s, (im) => {
      const n = Math.floor(order.length * ((s + 1) / 10) ** 0.85);
      for (let i = 0; i < n; i++) im.set(order[i][0], order[i][1], 0x000000, i > n - 8 ? 130 : 200);
    });
  }
}
const puff = (col, rad) => (im, r) => {
  im.each((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5) + (r() - 0.5) * 2.2;
    if (d > rad) return -1;
    return mul(col, 0.75 + r() * 0.3 + (d < rad * 0.5 ? 0.1 : 0));
  });
};
T('p_smoke', puff(0x8a8a8a, 6));
T('p_explode', puff(0xe8e8e8, 7.5));
T('p_white', (im) => im.fill(0xffffff));
T('p_flame', (im) => {
  sprite(im, ['...oo...', '..oYYo..', '.oYWWYo.', '.oYWWYo.', '..oYYo..', '...oo...'], { o: 0xf58a1a, Y: 0xffd83d, W: 0xfffbd0 }, 4, 5);
});
T('p_lava', (im) => {
  sprite(im, ['.oo.', 'oYYo', 'oYYo', '.oo.'], { o: 0xe8601a, Y: 0xffc83a }, 6, 6);
});
T('p_bubble', (im) => {
  sprite(im, ['..bbbb..', '.bw...b.', 'bw.....b', 'b......b', 'b......b', 'b.....Bb', '.b...Bb.', '..bbbb..'], { b: 0x9fc4ff, w: 0xffffff, B: 0x5a86d8 }, 4, 4);
});
T('p_splash', (im) => {
  sprite(im, ['..b..', '.bwb.', '.bbb.', 'bbbbb', '.bbb.'], { b: 0x6a9cf0, w: 0xd8e8ff }, 5, 5);
});
T('p_crit', (im) => {
  sprite(im, ['...y...', '...y...', '.y.Y.y.', '..YWY..', 'yyYWYyy', '..YWY..', '.y.Y.y.', '...y...'], { y: 0xc8a83a, Y: 0xffe66a, W: 0xffffff }, 4, 4);
});
T('p_heart', (im) => {
  sprite(im, ['.rr.rr.', 'rRRrRRr', 'rRRRRRr', 'rRRRRRr', '.rRRRr.', '..rRr..', '...r...'], { r: 0xa81010, R: 0xf02a2a }, 4, 4);
});
T('p_note', (im) => {
  sprite(im, ['...kkk', '...k.k', '...k.k', '.kkk..', 'kkkk..', '.kk...'], { k: 0xffffff }, 5, 5);
});

// ============================ item icons ============================================
const TOOL_PAL = {
  wooden: { h: 0x4a3618, H: 0x8f6f3d, L: 0xb8935a },
  stone: { h: 0x4a4a4a, H: 0x8f8f8f, L: 0xc4c4c4 },
  iron: { h: 0x5f5f5f, H: 0xd4d4d4, L: 0xffffff },
  golden: { h: 0x9a6410, H: 0xf2c935, L: 0xfff7a0 },
  diamond: { h: 0x14756c, H: 0x3fe0d0, L: 0xc0fff7 },
  leather: { h: 0x47230f, H: 0x9b5a32, L: 0xc47c4c },
};
const STICK = { s: 0x493615, S: 0x8a6a3a };
const TOOL_ART = {
  pickaxe: [
    '................', '....hhhhhhh.....', '...hLLLLLLHhh...', '....hhhhhHHLHh..', '.......sSshHLHh.', '......sSs..hHLh.', '.....sSs...hHLh.', '....sSs.....hLh.',
    '...sSs......hLh.', '..sSs.......hLh.', '.sSs.........hh.', 'sSs.............', 'ss..............', '................', '................', '................',
  ],
  axe: [
    '................', '..........hh....', '........hhLLh...', '.......hLLHHsh..', '.......hLHHsSs..', '.......hHHsSs...', '........hsSs....', '........sSs.....',
    '.......sSs......', '......sSs.......', '.....sSs........', '....sSs.........', '...sSs..........', '..sSs...........', '..ss............', '................',
  ],
  shovel: [
    '................', '...........hhh..', '..........hLLLh.', '.........hLHHLh.', '.........hHHHLh.', '.........hHHHh..', '........sShhh...', '.......sSs......',
    '......sSs.......', '.....sSs........', '....sSs.........', '...sSs..........', '..sSs...........', '.sSs............', '.ss.............', '................',
  ],
  hoe: [
    '................', '.........hhhh...', '........hLLLLh..', '.........hhsHh..', '..........sShh..', '.........sSs....', '........sSs.....', '.......sSs......',
    '......sSs.......', '.....sSs........', '....sSs.........', '...sSs..........', '..sSs...........', '.sSs............', '.ss.............', '................',
  ],
  sword: [
    '................', '.............hhh', '............hLLh', '...........hLHLh', '..........hLHLh.', '.........hLHLh..', '........hLHLh...', '..hh...hLHLh....',
    '..hHh.hLHLh.....', '...hHhLHLh......', '....hHHLh.......', '....shHHh.......', '...sSshHh.......', '..sSs..hh.......', '.hSs............', '.hh.............',
  ],
  helmet: [
    '', '', '', '....hhhhhhhh....', '...hLLLLLLLLh...', '..hLLHHHHHHHHh..', '..hLHHHHHHHHHh..', '..hLHHHHHHHHHh..', '..hLHHhhhhHHHh..', '..hLHh....hHHh..', '..hHHh....hHHh..', '..hhhh....hhhh..',
  ],
  chestplate: [
    '', '..hhh......hhh..', '.hLLLh....hLHHh.', '.hLHHHhhhhHHHHh.', '.hLHHHHHHHHHHHh.', '.hhHHHHHHHHHHhh.', '..hhLHHHHHHHhh..', '...hLHHHHHHHh...', '...hLHHHHHHHh...',
    '...hLHHHHHHHh...', '...hLHHHHHHHh...', '...hLHHHHHHHh...', '...hHHHHHHHHh...', '...hhhhhhhhhh...',
  ],
  leggings: [
    '', '...hhhhhhhhhh...', '...hLLLLLLLHh...', '...hLHHHHHHHh...', '...hLHHHHHHHh...', '...hLHHhhHHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...',
    '...hLHh..hHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...', '...hHHh..hHHh...', '...hhhh..hhhh...',
  ],
  boots: [
    '', '', '', '', '', '..hhhh....hhhh..', '..hLHh....hLHh..', '..hLHh....hLHh..', '..hLHh....hLHh..', '..hLHh....hLHh..', '.hhLHh....hLHhh.', 'hLLHHh....hLHHHh', 'hLHHHh....hHHHHh', 'hhhhhh....hhhhhh',
  ],
};
for (const m of ['wooden', 'stone', 'iron', 'golden', 'diamond']) {
  for (const k of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) T(`item_${m}_${k}`, (im) => sprite(im, TOOL_ART[k], { ...TOOL_PAL[m], ...STICK }));
}
for (const m of ['leather', 'iron', 'golden', 'diamond']) {
  for (const k of ['helmet', 'chestplate', 'leggings', 'boots']) T(`item_${m}_${k}`, (im) => sprite(im, TOOL_ART[k], TOOL_PAL[m]));
}

// shaded shapes: digits 0..4 index a 5-colour ramp (0 = outline)
const shaded = (rows, pal) => (im) => sprite(im, rows, { 0: pal[0], 1: pal[1], 2: pal[2], 3: pal[3], 4: pal[4] });
const LUMP = [
  '', '', '', '.....0000.......', '....012210000...', '...01223221110..', '...012332221110.', '..0122322221110.', '..0112222211100.', '..011122211110..', '...01111111110..', '...0011111100...', '.....000000.....',
];
const BALL = [
  '', '', '', '', '.....00000......', '....0233210.....', '...023432110....', '...023322110....', '...022221110....', '...021111110....', '....0111110.....', '.....00000......',
];
const INGOT = [
  '', '', '', '', '', '.......00000000.', '.....0034444430.', '...00344444320..', '.003444443210...', '.03333332110....', '.0222222110.....', '.011111110......', '.00000000.......',
];
const GEM = [
  '', '', '', '.....000000.....', '....03444430....', '...0344334320...', '..034433322210..', '..033332222110..', '...0322221110...', '....03221110....', '.....032110.....', '......0210......', '.......00.......',
];
const PILE = [
  '', '', '', '', '', '', '.......2........', '......232..1....', '....2.2332......', '...2313223.2....', '..232232132232..', '..223312332132..', '...2132232231...',
];
T('item_coal', shaded(LUMP, [0x080808, 0x1a1a1a, 0x2c2c2c, 0x444444, 0x5c5c5c]));
T('item_charcoal', shaded(LUMP, [0x120c06, 0x2a2016, 0x3f3224, 0x5a4a38, 0x74624c]));
T('item_flint', shaded(LUMP, [0x101010, 0x2b2b2b, 0x454545, 0x666666, 0x8c8c8c]));
T('item_lapis', shaded(LUMP, [0x0c1f5c, 0x173a9a, 0x2452c0, 0x4a78e0, 0x86a8f5]));
T('item_leather', shaded(LUMP, [0x47230f, 0x7a4424, 0x9b5a32, 0xb87244, 0xd0905e]));
T('item_rotten_flesh', shaded(LUMP, [0x3a2412, 0x6b4a22, 0x8a5a2e, 0x9a7a3a, 0x7a8f3a]));
T('item_clay_ball', shaded(BALL, [0x5c606a, 0x858a96, 0x9aa0ab, 0xb0b6c2, 0xcdd2dc]));
T('item_snowball', shaded(BALL, [0x9ab0bc, 0xd0dde4, 0xe8f0f4, 0xf8fbfd, 0xffffff]));
T('item_iron_ingot', shaded(INGOT, [0x4a4a4a, 0x8f8f8f, 0xb8b8b8, 0xd8d8d8, 0xffffff]));
T('item_gold_ingot', shaded(INGOT, [0x8a5a0c, 0xc88a12, 0xe8b424, 0xf8d848, 0xffffb0]));
T('item_brick', shaded(INGOT, [0x4a2418, 0x7a3e2c, 0x96553f, 0xae6a50, 0xc88468]));
T('item_diamond', shaded(GEM, [0x0f6b66, 0x1aa3a0, 0x33e0d5, 0x8cf4ea, 0xe6ffff]));
T('item_redstone', shaded(PILE, [0, 0x8f0603, 0xe01208, 0xff5a4a, 0]));
T('item_gunpowder', shaded(PILE, [0, 0x3a3a3a, 0x5c5c5c, 0x8a8a8a, 0]));
T('item_bone_meal', shaded(PILE, [0, 0xb8b8c0, 0xe0e0e6, 0xffffff, 0]));
T('item_wheat_seeds', shaded(PILE, [0, 0x2f6b1e, 0x4f9a2e, 0x8fc05a, 0]));
T('item_stick', (im) => sprite(im, [
  '', '', '............sS..', '...........sSs..', '..........sSs...', '.........sSs....', '........sSs.....', '.......sSs......', '......sSs.......', '.....sSs........', '....sSs.........', '...sSs..........', '..sSs...........', '..ss............',
], STICK));
T('item_feather', (im) => sprite(im, [
  '', '.............kk.', '...........kkWWk', '..........kWWWgk', '.........kWWWgk.', '........kWWWgk..', '.......kWWWgk...', '......kWWggk....', '.....kWWgkk.....', '....kWggk.......', '...kWgkk........', '..kgkk..........', '.kgk............', '.kk.............',
], { k: 0x6b6b6b, W: 0xffffff, g: 0xcfcfcf }));
T('item_string', (im) => sprite(im, [
  '', '', '....kkk.........', '...kWWWk........', '..kWk.kWk.......', '..kWk..kWk......', '...k...kWk......', '......kWk.......', '.....kWk........', '....kWk.........', '....kWk..k......', '....kWk.kWk.....', '.....kWWWk......', '......kkk.......',
], { k: 0x8a8a8a, W: 0xf5f5f5 }));
T('item_bone', (im) => sprite(im, [
  '', '', '..........kk.kk.', '.........kWWkWWk', '.........kWWWWWk', '..........kWWWk.', '.........kWWgk..', '........kWWgk...', '.......kWWgk....', '......kWWgk.....', '.....kWWgk......', '..kkkWWgk.......', '.kWWWWWk........', '.kWWkWWk........', '..kk.kk.........',
], { k: 0x7a7a70, W: 0xf2f2e6, g: 0xc8c8b8 }));
T('item_wheat', (im) => sprite(im, [
  '', '..........y.y...', '.........yYyYy..', '........yYyYyY..', '.......yYyYyYy..', '......yYyYyYy...', '.....yYyYyYd....', '....dYyYyYd.....', '...dydYyYd......', '..dy.dydd.......', '.dy..dy.........', '.d..dy..........', '...dy...........', '...d............',
], { y: 0xc8a030, Y: 0xe8cc58, d: 0x8a6a1c }));
T('item_bread', (im) => sprite(im, [
  '', '', '', '', '.........kkkk...', '.......kkLLLLk..', '.....kkLLBBdBLk.', '...kkLLBdBBBBLk.', '..kLLBBBBBdBBk..', '.kLBdBBBBBBkk...', '.kBBBBBBBkk.....', '.kBBBBBkk.......', '..kkkkk.........',
], { k: 0x5a3a14, L: 0xd8a85a, B: 0xb8843a, d: 0x8f6224 }));
const apple = (pal) => (im) => sprite(im, [
  '', '', '.........bg.....', '........bgg.....', '....kkkkb.kk....', '...kRRLRkRRRk...', '..kRLLRRRRRRRk..', '..kRLRRRRRRRdk..', '..kRRRRRRRRRdk..', '..kRRRRRRRRddk..', '..kRRRRRRRRddk..', '...kRRRRRRddk...', '...kdRRRdddk....', '....kkk.kkk.....',
], pal);
T('item_apple', apple({ k: 0x5c0a08, R: 0xe02a1e, L: 0xff8a7a, d: 0xa8160f, b: 0x5a3a14, g: 0x4f9a2e }));
T('item_golden_apple', apple({ k: 0x8a5a0c, R: 0xf8d848, L: 0xffffc0, d: 0xd89a1c, b: 0x5a3a14, g: 0x4f9a2e }));
const meat = (pal) => (im) => sprite(im, [
  '', '', '', '......kkkkk.....', '....kkMMMMMk....', '...kMMMFFMMMk...', '..kMMMFMMMMMMk..', '..kMMMMMMMFMMk..', '..kMFMMMMFFMMk..', '..kMMMMMMMMMk...', '...kMMdMMMdk....', '....kkddddk.....', '......kkkk......',
], pal);
T('item_porkchop', meat({ k: 0x7a2a2a, M: 0xf08a8a, F: 0xffd0c8, d: 0xc85a5a }));
T('item_cooked_porkchop', meat({ k: 0x4a2a10, M: 0xc8843a, F: 0xe8c48a, d: 0x8f5a22 }));
T('item_beef', meat({ k: 0x5c0f0f, M: 0xd0302a, F: 0xf5c8c0, d: 0x9a1a16 }));
T('item_steak', meat({ k: 0x2e1a0c, M: 0x8a4f24, F: 0xb87a44, d: 0x5c3214 }));
T('item_mutton', meat({ k: 0x6b1818, M: 0xe05a50, F: 0xf8e0d8, d: 0xb03a32 }));
T('item_cooked_mutton', meat({ k: 0x3a2210, M: 0xa86a3a, F: 0xd0a070, d: 0x70401c }));
const drum = (pal) => (im) => sprite(im, [
  '', '', '.......kkkk.....', '.....kkMMMMk....', '....kMMMLMMMk...', '....kMMLMMMMk...', '....kMMMMMMdk...', '....kMMMMMddk...', '.....kMMMddk....', '....kkkdddk.....', '...kWWkkkk......', '..kWWk..........', '.kWkWk..........', '.kk.kk..........',
], pal);
T('item_chicken', drum({ k: 0x8a5a4a, M: 0xf5c8b0, L: 0xffe8d8, d: 0xe0a088, W: 0xf2f2e6 }));
T('item_cooked_chicken', drum({ k: 0x4a2a10, M: 0xc8843a, L: 0xe8b060, d: 0x9a5a22, W: 0xf2f2e6 }));
const bucket = (fill, fill2) => (im) => sprite(im, [
  '', '', '', '..kkkkkkkkkkkk..', '.kLLffffffffLGk.', '.kGLffFFffffGGk.', '..kGLLLLLLGGGk..', '..kGLGGGGGGGDk..', '..kGLGGGGGGGDk..', '...kLGGGGGGDk...', '...kLGGGGGGDk...', '...kGGGGGGDDk...', '....kGGGDDDk....', '....kkkkkkkk....',
], { k: 0x3a3a3a, L: 0xf5f5f5, G: 0xc0c0c0, D: 0x8a8a8a, f: fill, F: fill2 });
T('item_bucket', bucket(0x5a5a5a, 0x4a4a4a));
T('item_water_bucket', bucket(0x3f76e4, 0x7aa4f5));
T('item_lava_bucket', bucket(0xe8781a, 0xfbd040));
T('item_flint_and_steel', (im) => sprite(im, [
  '', '', '..kkkkkk........', '.kSSSSSSk.......', '.kSkkkkSSk......', '.kSk...kSk......', '.kSk...kk.......', '.kSk.......kk...', '.kSk......kFFk..', '.kSSk....kFfFk..', '..kSSkkkkFFfk...', '...kSSSkFfFk....', '....kkkkFFk.....', '.........kk.....',
], { k: 0x2b2b2b, S: 0xc8c8c8, F: 0x555555, f: 0x7a7a7a }));
T('item_shears', (im) => sprite(im, [
  '', '', '.........kk.....', '........kSSk....', '.......kSSk..kk.', '......kSSk.kkSSk', '..kkk.kSkkSSSk..', '.kRRRkkSSSkk....', '.kR.RkSkk.......', '.kRRRkRRk.......', '..kkkR..Rk......', '....kRRRRk......', '.....kkkk.......',
], { k: 0x3a3a3a, S: 0xd8d8d8, R: 0x9a3a2a }));
T('item_bow', (im) => sprite(im, [
  '', '.......kkkk.....', '.....kkBBBwk....', '....kBBkkkw.....', '...kBkk..w......', '..kBk...w.......', '..kBk..w........', '.kBk..w.........', '.kBk.w..........', '.kBkw...........', '.kBw............', '.kwk............', '..k.............',
], { k: 0x3a2812, B: 0x8a6a3a, w: 0xe8e8e8 }));
T('item_arrow', (im) => sprite(im, [
  '', '..........kkkk..', '..........kHHk..', '.........kSHHk..', '........kSkkkk..', '.......kSk......', '......kSk.......', '.....kSk........', '..k.kSk.........', '.kWkSk..........', '..kWWk..........', '.kWkWWk.........', '.kk.kkk.........',
], { k: 0x3a3a3a, H: 0xb8b8b8, S: 0x8a6a3a, W: 0xf0f0f0 }));
T('item_paper', (im) => sprite(im, [
  '', '', '....kkkkkkkkk...', '...kWWWWWWWWWk..', '...kWWWWWWWWgk..', '...kWWWWWWWWgk..', '...kWWWWWWWWgk..', '...kWWWWWWWWgk..', '...kWWWWWWWWgk..', '...kWWWWWWWWgk..', '...kWWWWWWWggk..', '...kWgggggggk...', '....kkkkkkkk....',
], { k: 0x8a8a8a, W: 0xfafafa, g: 0xd8d8d8 }));
T('item_book', (im) => sprite(im, [
  '', '', '....kkkkkkkkk...', '...kBBBBBBBBBk..', '..kBLBBBBBBBBk..', '..kBLBBBYYBBBk..', '..kBLBBBYYBBBk..', '..kBLBBBBBBBBk..', '..kBLBBBBBBBBk..', '..kBLBBBBBBBkk..', '..kBkkkkkkkkWk..', '..kWWWWWWWWWk...', '...kkkkkkkkk....',
], { k: 0x2e1a0c, B: 0x7a3a1c, L: 0xa85a30, Y: 0xe8c84a, W: 0xf0ead8 }));
const bowl = (fill) => (im) => sprite(im, [
  '', '', '', '', '', '', '.kkkkkkkkkkkkkk.', '.kLffffffffffDk.', '..kLffffffffDk..', '..kBLBBBBBBDBk..', '...kBBBBBBBBk...', '....kkBBBBkk....', '......kkkk......',
], { k: 0x3a2812, L: 0xa8804a, B: 0x7a5a30, D: 0x5a4020, f: fill });
T('item_bowl', bowl(0x4a3418));
T('item_mushroom_stew', bowl(0xc8805a));
T('item_door', (im) => sprite(im, [
  '', '....kkkkkkkk....', '....kBBBBBBk....', '....kBkkkkBk....', '....kBk..kBk....', '....kBkkkkBk....', '....kBBBBBBk....', '....kBBBBgBk....', '....kBDDDDBk....', '....kBDDDDBk....', '....kBDDDDBk....', '....kBDDDDBk....', '....kBBBBBBk....', '....kkkkkkkk....',
], { k: 0x4a3618, B: 0xa8854c, D: 0x8a6a3a, g: 0xd8d8d8 }));
T('item_bed', (im) => sprite(im, [
  '', '', '', '', '', '', '.kkkkkkkkkkkkkk.', '.kWWWkRRRRRRRRk.', '.kWWWkRRRRRRRRk.', '.kkkkkrrrrrrrrk.', '.kBBBBBBBBBBBBk.', '.kBk........kBk.', '.kk..........kk.',
], { k: 0x3a2812, W: 0xf0f0f0, R: 0xb83030, r: 0x8a2020, B: 0x9a7a45 }));

// ============================ sky ===================================================
export function sunImage() {
  const im = new Img(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
    if (d < 5) im.set(x, y, d < 4 ? 0xfffff0 : 0xfff6a8, 255);
    else if (d < 14) {
      const a = Math.pow(1 - (d - 5) / 9, 2.4) * 130;
      im.set(x, y, 0xffe890, a | 0);
    }
  }
  return im;
}
export function moonImage() {
  const im = new Img(32, 32);
  const r = mulberry32(5150);
  const craters = [[13, 13, 1.6], [18, 14, 1.2], [14, 18, 1.4], [18, 18.5, 1], [16.5, 11.5, 0.8]];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
    if (d < 5) {
      let c = 0xdfe6f2;
      for (const [cx, cy, cr] of craters) if (Math.hypot(x - cx, y - cy) < cr) c = 0xaab4c8;
      im.set(x, y, mul(c, 0.96 + r() * 0.06), 255);
    } else if (d < 11) im.set(x, y, 0x9fb4e0, (Math.pow(1 - (d - 5) / 6, 2.5) * 70) | 0);
  }
  return im;
}

// ============================ packing ===============================================
// RGBA data for the block array texture (one 16x16 layer per TEX entry).
export function buildArrayData() {
  const out = new Uint8Array(TEX.length * S * S * 4);
  TEX.forEach((name, layer) => {
    const im = getTex(name);
    const d = new Uint8ClampedArray(im.d);
    // give fully transparent texels the average opaque colour so mipmaps don't darken edges
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n > 0 && n < S * S) {
      r = (r / n) | 0; g = (g / n) | 0; b = (b / n) | 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
    }
    out.set(d, layer * S * S * 4);
  });
  return out;
}
