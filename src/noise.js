// Seeded RNG, integer hashing and Perlin gradient noise.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 2D/3D integer hash → uint32
export function hash2(x, z, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  return (h ^ (h >>> 15)) >>> 0;
}
export function hash3(x, y, z, seed) {
  return hash2(x + Math.imul(y, 31337), z + Math.imul(y, 7919), seed);
}
// hash → float in [0,1)
export const rand2 = (x, z, seed) => hash2(x, z, seed) / 4294967296;

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class Perlin {
  constructor(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const r = mulberry32(seed);
    for (let i = 255; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }
  noise2(x, y) {
    const p = this.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = fade(xf), v = fade(yf);
    const a = p[X] + Y, b = p[X + 1] + Y;
    const g = (h, x, y) => {
      switch (h & 7) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        case 3: return -x - y;
        case 4: return x;
        case 5: return -x;
        case 6: return y;
        default: return -y;
      }
    };
    const n00 = g(p[a], xf, yf), n10 = g(p[b], xf - 1, yf);
    const n01 = g(p[a + 1], xf, yf - 1), n11 = g(p[b + 1], xf - 1, yf - 1);
    const nx0 = n00 + u * (n10 - n00), nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  }
  noise3(x, y, z) {
    const p = this.p;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const Bq = p[X + 1] + Y, BA = p[Bq] + Z, BB = p[Bq + 1] + Z;
    const g = (h, x, y, z) => {
      h &= 15;
      const a = h < 8 ? x : y;
      const b = h < 4 ? y : h === 12 || h === 14 ? x : z;
      return ((h & 1) === 0 ? a : -a) + ((h & 2) === 0 ? b : -b);
    };
    const x1 = xf - 1, y1 = yf - 1, z1 = zf - 1;
    const l1 = g(p[AA], xf, yf, zf), l2 = g(p[BA], x1, yf, zf);
    const l3 = g(p[AB], xf, y1, zf), l4 = g(p[BB], x1, y1, zf);
    const l5 = g(p[AA + 1], xf, yf, z1), l6 = g(p[BA + 1], x1, yf, z1);
    const l7 = g(p[AB + 1], xf, y1, z1), l8 = g(p[BB + 1], x1, y1, z1);
    const a1 = l1 + u * (l2 - l1), a2 = l3 + u * (l4 - l3);
    const a3 = l5 + u * (l6 - l5), a4 = l7 + u * (l8 - l7);
    const b1 = a1 + v * (a2 - a1), b2 = a3 + v * (a4 - a3);
    return b1 + w * (b2 - b1);
  }
  // fractal sums, normalised to roughly [-1,1]
  fbm2(x, y, oct, lac = 2, gain = 0.5) {
    let amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise2(x, y);
      norm += amp;
      amp *= gain; x = x * lac + 17.13; y = y * lac + 31.71;
    }
    return sum / norm;
  }
  fbm3(x, y, z, oct, lac = 2, gain = 0.5) {
    let amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise3(x, y, z);
      norm += amp;
      amp *= gain; x = x * lac + 11.3; y = y * lac + 7.7; z = z * lac + 23.9;
    }
    return sum / norm;
  }
}
