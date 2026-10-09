// Terrain generation: climate, heightmap, biomes, caves, ores, trees and plants.
// Everything is a pure function of (seed, position) so chunks can be built in any order.
import { Perlin, hash2, hash3, rand2, mulberry32 } from './noise.js';
import { B, CH, WH, SEA, OPAQUE } from './blocks.js';
import { clamp, lerp, smoothstep } from './math.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH_FOREST: 4, TAIGA: 5, SNOWY_TUNDRA: 6,
  SNOWY_TAIGA: 7, DESERT: 8, SAVANNA: 9, SWAMP: 10, MOUNTAINS: 11, RIVER: 12,
};
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest', 'Taiga', 'Snowy Tundra', 'Snowy Taiga', 'Desert', 'Savanna', 'Swamp', 'Mountains', 'River'];

const mixc = (a, b, t) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  return (
    (Math.round(ar + (((b >> 16) & 255) - ar) * t) << 16) |
    (Math.round(ag + (((b >> 8) & 255) - ag) * t) << 8) |
    Math.round(ab + ((b & 255) - ab) * t)
  );
};

export class Climate {
  constructor(seed) {
    this.tn = new Perlin(seed ^ 0x51ab37);
    this.hn = new Perlin(seed ^ 0x77c1d9);
  }
  temp(x, z) {
    return clamp(0.5 + this.tn.fbm2(x / 560, z / 560, 3) * 1.6, 0, 1);
  }
  humid(x, z) {
    return clamp(0.5 + this.hn.fbm2(x / 440 + 100, z / 440 - 50, 3) * 1.6, 0, 1);
  }
  swampy(t, h) {
    return smoothstep(0.66, 0.74, h) * smoothstep(0.38, 0.44, t) * (1 - smoothstep(0.62, 0.68, t));
  }
  grass(x, z) {
    const t = this.temp(x, z), h = this.humid(x, z);
    const T = clamp(t * 1.7 + 0.08, 0, 1);
    const c = mixc(0x80b497, mixc(0xbfb755, 0x59c93c, h), T);
    return mixc(c, 0x6a7039, this.swampy(t, h) * 0.85);
  }
  foliage(x, z) {
    const t = this.temp(x, z), h = this.humid(x, z);
    const T = clamp(t * 1.7 + 0.08, 0, 1);
    const c = mixc(0x60a17b, mixc(0xaea42a, 0x1abf00, h * 0.8), T);
    return mixc(c, 0x6a7039, this.swampy(t, h) * 0.85);
  }
  water(x, z) {
    const t = this.temp(x, z), h = this.humid(x, z);
    const c = t < 0.5 ? mixc(0x3d57d6, 0x3f76e4, t * 2) : mixc(0x3f76e4, 0x45adf2, (t - 0.5) * 2);
    return mixc(c, 0x617b64, this.swampy(t, h) * 0.9);
  }
}

// Tree shapes as lists of [dx,dy,dz,kind] (kind 0 = log, 1 = leaves). type: 0 oak, 1 birch, 2 spruce.
export function treeShape(type, rnd) {
  const out = [];
  if (type === 2) {
    const h = 6 + ((rnd() * 4) | 0), bare = 1 + ((rnd() * 2) | 0), maxR = 2 + ((rnd() * 2) | 0);
    let rad = (rnd() * 2) | 0, curMax = 1, reset = 0;
    for (let j = 0; j <= h - bare; j++) {
      const yy = h - j;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (Math.abs(dx) !== rad || Math.abs(dz) !== rad || rad <= 0) out.push([dx, yy, dz, 1]);
      }
      if (rad >= curMax) {
        rad = reset; reset = 1;
        if (++curMax > maxR) curMax = maxR;
      } else rad++;
    }
    const gap = (rnd() * 3) | 0;
    for (let y = 0; y < h - gap; y++) out.push([0, y, 0, 0]);
  } else {
    const h = (type === 1 ? 5 : 4) + ((rnd() * 3) | 0);
    for (let yy = h - 3; yy <= h; yy++) {
      const rad = yy >= h - 1 ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && (yy === h || rnd() < 0.5)) continue;
        out.push([dx, yy, dz, 1]);
      }
    }
    for (let y = 0; y < h; y++) out.push([0, y, 0, 0]);
  }
  return out;
}
export const TREE_LOG = [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG];
export const TREE_LEAVES = [B.LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES];

const PAD = 5;
const PW = CH + PAD * 2;
const TREE_DENSITY = [0, 0, 0.004, 0.075, 0.07, 0.07, 0.003, 0.055, 0, 0.006, 0.04, 0.012, 0];

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    const s = this.seed;
    this.climate = new Climate(s);
    this.cont = new Perlin(s ^ 0x1001);
    this.hill = new Perlin(s ^ 0x2002);
    this.mtn = new Perlin(s ^ 0x3003);
    this.ridge = new Perlin(s ^ 0x4004);
    this.river = new Perlin(s ^ 0x5005);
    this.detail = new Perlin(s ^ 0x6006);
    this.caveA = new Perlin(s ^ 0x7007);
    this.caveB = new Perlin(s ^ 0x8008);
    this.cheese = new Perlin(s ^ 0x9009);
    this.misc = new Perlin(s ^ 0xa00a);
    // scratch outputs of column()
    this.oH = 0; this.oBiome = 0; this.oMount = 0; this.oTemp = 0;
    this.pH = new Int16Array(PW * PW);
    this.pB = new Uint8Array(PW * PW);
  }

  // Computes surface height + biome for a column. Results in this.oH / this.oBiome.
  column(x, z) {
    const c = this.cont.fbm2(x / 820, z / 820, 4) * 1.75 + 0.14;
    let base;
    if (c < -0.5) base = 34;
    else if (c < -0.2) base = lerp(34, 52, (c + 0.5) / 0.3);
    else if (c < -0.06) base = lerp(52, 61, (c + 0.2) / 0.14);
    else if (c < 0.02) base = lerp(61, 64.5, (c + 0.06) / 0.08);
    else if (c < 0.3) base = lerp(64.5, 69, (c - 0.02) / 0.28);
    else base = lerp(69, 76, Math.min(1, (c - 0.3) / 0.6));
    const land = smoothstep(-0.08, 0.12, c);
    const rough = smoothstep(-0.25, 0.35, this.hill.fbm2(x / 620 + 50, z / 620 + 50, 2) * 1.6);
    const hills = this.hill.fbm2(x / 170, z / 170, 4) * lerp(3, 17, rough) * (0.3 + 0.7 * land);
    const m = smoothstep(0.08, 0.5, this.mtn.fbm2(x / 900, z / 900, 3) * 1.9) * smoothstep(0.05, 0.35, c);
    let mh = 0;
    if (m > 0) {
      const r = Math.max(0, 1 - Math.abs(this.ridge.fbm2(x / 250, z / 250, 4)) * 2.3);
      mh = m * (r * r * 48 + 10);
    }
    const det = this.detail.fbm2(x / 36, z / 36, 2);
    let h = base + hills + mh + det * 1.6;
    const t = this.climate.temp(x, z), hu = this.climate.humid(x, z);
    // swamps flatten the land down to the waterline
    const sw = this.climate.swampy(t, hu);
    if (sw > 0 && h > 58 && h < 72) h = lerp(h, 61.7 + det * 1.3, sw * 0.9 * (1 - smoothstep(66, 72, h)));
    // rivers
    const rv = Math.abs(this.river.fbm2(x / 460, z / 460, 2));
    const rf = (1 - smoothstep(0.012, 0.05, rv)) * land * (1 - m * 0.8);
    if (rf > 0 && h > 56.5) h = lerp(h, 56.5, rf);
    if (h > 96) h = 96 + (h - 96) * 0.6;
    h = clamp(Math.floor(h), 2, WH - 8);
    let biome;
    if (h < SEA) biome = rf > 0.35 && land > 0.6 ? BIOME.RIVER : BIOME.OCEAN;
    else if (m > 0.45 && h > 84) biome = BIOME.MOUNTAINS;
    else if (h <= SEA + 1 && land < 0.75 && sw < 0.3) biome = BIOME.BEACH;
    else if (t < 0.22) biome = hu > 0.5 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_TUNDRA;
    else if (t < 0.38) biome = hu > 0.38 ? BIOME.TAIGA : BIOME.PLAINS;
    else if (t > 0.68) biome = hu < 0.44 ? BIOME.DESERT : hu < 0.62 ? BIOME.SAVANNA : BIOME.FOREST;
    else if (hu < 0.36) biome = BIOME.PLAINS;
    else if (hu < 0.58) biome = BIOME.FOREST;
    else if (hu < 0.68) biome = BIOME.BIRCH_FOREST;
    else biome = h < 67 ? BIOME.SWAMP : BIOME.FOREST;
    this.oH = h; this.oBiome = biome; this.oMount = m; this.oTemp = t;
    return h;
  }
  heightAt(x, z) {
    return this.column(x, z);
  }
  biomeAt(x, z) {
    this.column(x, z);
    return this.oBiome;
  }

  isCave(x, y, z, surf, wet) {
    if (y < 2) return false;
    if (wet && y > surf - 7) return false;
    const a = this.caveA.noise3(x / 48, y / 30, z / 48);
    const b = this.caveB.noise3(x / 48 + 100, y / 30, z / 48 - 100);
    let thr = 0.0058;
    if (y > surf - 8) thr *= 0.3 + (0.7 * (surf - y)) / 8;
    if (a * a + b * b < thr) return true;
    if (y < 50) {
      const ch = this.cheese.fbm3(x / 64, y / 36, z / 64, 2);
      if (ch > 0.5 - 0.1 * smoothstep(50, 30, y) + (y < 8 ? (8 - y) * 0.06 : 0)) return true;
    }
    return false;
  }

  // which tree (0 none, 1 oak, 2 birch, 3 spruce, 4 cactus) grows at this column
  treeAt(x, z, biome, h) {
    const dens = TREE_DENSITY[biome] || (biome === BIOME.DESERT ? 0.008 : 0);
    if (!dens || h < SEA) return 0;
    const s = this.seed ^ 0x7ee5;
    const u = rand2(x, z, s);
    if (u >= dens) return 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if ((dx || dz) && rand2(x + dx, z + dz, s) < u) return 0;
    }
    switch (biome) {
      case BIOME.FOREST: return (hash2(x, z, s + 1) & 7) < 2 ? 2 : 1;
      case BIOME.BIRCH_FOREST: return 2;
      case BIOME.TAIGA: case BIOME.SNOWY_TAIGA: case BIOME.SNOWY_TUNDRA: return 3;
      case BIOME.MOUNTAINS: return h < 92 ? 3 : 0;
      case BIOME.DESERT: return 4;
      default: return 1;
    }
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CH * CH * WH);
    const meta = new Uint8Array(CH * CH * WH);
    const { pH, pB, seed } = this;
    const x0 = cx * CH, z0 = cz * CH;
    const temps = new Float32Array(CH * CH), mounts = new Float32Array(CH * CH);
    for (let px = 0; px < PW; px++) for (let pz = 0; pz < PW; pz++) {
      const wx = x0 + px - PAD, wz = z0 + pz - PAD;
      pH[px * PW + pz] = this.column(wx, wz);
      pB[px * PW + pz] = this.oBiome;
      const lx = px - PAD, lz = pz - PAD;
      if (lx >= 0 && lx < CH && lz >= 0 && lz < CH) {
        temps[lx * CH + lz] = this.oTemp;
        mounts[lx * CH + lz] = this.oMount;
      }
    }
    const H = (lx, lz) => pH[(lx + PAD) * PW + lz + PAD];
    const BI = (lx, lz) => pB[(lx + PAD) * PW + lz + PAD];

    // ---- base terrain -------------------------------------------------------
    for (let x = 0; x < CH; x++) for (let z = 0; z < CH; z++) {
      const wx = x0 + x, wz = z0 + z;
      const h = H(x, z), biome = BI(x, z);
      const col = (x << 11) | (z << 7);
      const wet = h < SEA;
      const n = this.misc.noise2(wx / 9, wz / 9);
      let top = B.GRASS, fill = B.DIRT, depth = 3 + (hash2(wx, wz, seed) & 1);
      let under = B.STONE;
      switch (biome) {
        case BIOME.OCEAN: case BIOME.RIVER: {
          const k = this.misc.noise2(wx / 23 + 40, wz / 23);
          top = fill = h > SEA - 7 ? (k > 0.45 ? B.GRAVEL : k < -0.5 ? B.CLAY : B.SAND) : k > 0.2 ? B.GRAVEL : k < -0.45 ? B.CLAY : B.DIRT;
          if (biome === BIOME.RIVER && top === B.SAND && k > -0.1) top = fill = B.DIRT;
          break;
        }
        case BIOME.BEACH: top = fill = B.SAND; under = B.SANDSTONE; break;
        case BIOME.DESERT: top = fill = B.SAND; depth = 4; under = B.SANDSTONE; break;
        case BIOME.MOUNTAINS:
          if (h > 99 + n * 4) { top = B.SNOW_BLOCK; fill = B.STONE; } else if (h > 88 + n * 5) { top = fill = B.STONE; }
          break;
        default:
          if (wet) top = h > SEA - 3 && n > 0.2 ? B.SAND : B.DIRT;
      }
      const leak = wet ? 0 : Math.min(H(x - 1, z), H(x + 1, z), H(x, z - 1), H(x, z + 1));
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y < 5 && (hash3(wx, y, wz, seed) & 7) < 6 - y) id = B.BEDROCK;
        else if (this.isCave(wx, y, wz, h, wet) && !(y <= SEA && leak < y)) id = y <= 10 ? B.LAVA : B.AIR;
        else if (y === h) id = top;
        else if (y > h - depth) id = fill;
        else if (under !== B.STONE && y > h - depth - 3) id = under;
        else id = B.STONE;
        blocks[col + y] = id;
      }
      if (wet) {
        for (let y = h + 1; y <= SEA; y++) blocks[col + y] = B.WATER;
        if (temps[x * CH + z] < 0.22) blocks[col + SEA] = B.ICE;
      }
    }

    // ---- ores & stone variants ---------------------------------------------
    const r = mulberry32(hash2(cx, cz, seed ^ 0x0be5));
    const vein = (id, count, size, y0, y1) => {
      for (let i = 0; i < count; i++) {
        let x = (r() * 16) | 0, z = (r() * 16) | 0, y = (y0 + r() * (y1 - y0)) | 0;
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH) {
            const i2 = (x << 11) | (z << 7) | y;
            if (blocks[i2] === B.STONE) blocks[i2] = id;
          }
          const d = (r() * 6) | 0;
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    };
    vein(B.DIRT, 4, 36, 10, 90); vein(B.GRAVEL, 3, 36, 5, 80);
    vein(B.GRANITE, 3, 44, 5, 80); vein(B.DIORITE, 3, 44, 5, 80); vein(B.ANDESITE, 3, 44, 5, 80);
    vein(B.COAL_ORE, 18, 14, 5, 120); vein(B.IRON_ORE, 16, 9, 4, 62);
    vein(B.GOLD_ORE, 3, 9, 4, 31); vein(B.REDSTONE_ORE, 6, 8, 3, 16);
    vein(B.DIAMOND_ORE, 2, 7, 3, 15); vein(B.LAPIS_ORE, 2, 7, 4, 30);

    // ---- trees (may originate in neighbouring chunks) -----------------------
    for (let tx = -PAD + 1; tx < CH + PAD - 1; tx++) for (let tz = -PAD + 1; tz < CH + PAD - 1; tz++) {
      const wx = x0 + tx, wz = z0 + tz;
      const h = H(tx, tz), biome = BI(tx, tz);
      const kind = this.treeAt(wx, wz, biome, h);
      if (!kind) continue;
      if (biome === BIOME.MOUNTAINS && h > 88) continue;
      if (this.isCave(wx, h, wz, h, false)) continue;
      const tr = mulberry32(hash2(wx, wz, seed ^ 0x77ee));
      if (kind === 4) {
        if (tx < 0 || tx >= CH || tz < 0 || tz >= CH) continue;
        if (H(tx - 1, tz) > h || H(tx + 1, tz) > h || H(tx, tz - 1) > h || H(tx, tz + 1) > h) continue;
        const ch = 1 + ((tr() * 3) | 0);
        for (let y = 1; y <= ch; y++) blocks[(tx << 11) | (tz << 7) | (h + y)] = B.CACTUS;
        continue;
      }
      const type = kind - 1;
      const shape = treeShape(type, tr);
      for (const [dx, dy, dz, k] of shape) {
        const x = tx + dx, z = tz + dz, y = h + 1 + dy;
        if (x < 0 || x >= CH || z < 0 || z >= CH || y >= WH) continue;
        const i = (x << 11) | (z << 7) | y;
        if (k === 0) blocks[i] = TREE_LOG[type];
        else if (blocks[i] === B.AIR) blocks[i] = TREE_LEAVES[type];
      }
    }

    // ---- plants & snow --------------------------------------------------------
    for (let x = 0; x < CH; x++) for (let z = 0; z < CH; z++) {
      const wx = x0 + x, wz = z0 + z;
      const h = H(x, z), biome = BI(x, z);
      const col = (x << 11) | (z << 7);
      const snowy = temps[x * CH + z] < 0.22 || (biome === BIOME.MOUNTAINS && h > 94);
      const ground = blocks[col + h];
      if (h >= SEA && h < WH - 2 && blocks[col + h + 1] === B.AIR && !snowy) {
        const u = rand2(wx, wz, seed ^ 0x9a55);
        const u2 = rand2(wx, wz, seed ^ 0x1f0e);
        if (ground === B.GRASS) {
          let grass = 0, flowers = 0.004, shroom = 0;
          switch (biome) {
            case BIOME.PLAINS: grass = 0.3; flowers = this.misc.noise2(wx / 40, wz / 40) > 0.3 ? 0.14 : 0.006; break;
            case BIOME.FOREST: case BIOME.BIRCH_FOREST: grass = 0.1; flowers = 0.012; shroom = 0.003; break;
            case BIOME.TAIGA: grass = 0.14; shroom = 0.006; break;
            case BIOME.SAVANNA: grass = 0.42; break;
            case BIOME.SWAMP: grass = 0.22; shroom = 0.012; break;
            case BIOME.MOUNTAINS: grass = 0.06; break;
          }
          if (u < grass) blocks[col + h + 1] = B.TALL_GRASS;
          else if (u < grass + flowers) {
            const patch = Math.floor(this.misc.noise2(wx / 60 + 9, wz / 60) * 3 + 3 + u2 * 1.5) % 5;
            blocks[col + h + 1] = [B.DANDELION, B.POPPY, B.CORNFLOWER, B.DAISY, B.ALLIUM][Math.abs(patch)];
          } else if (u < grass + flowers + shroom) blocks[col + h + 1] = u2 < 0.5 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
          else if (u > 0.9992) { blocks[col + h + 1] = B.PUMPKIN; meta[col + h + 1] = (u2 * 4) | 0; }
        } else if (ground === B.SAND && biome === BIOME.DESERT) {
          if (u < 0.012) blocks[col + h + 1] = B.DEAD_BUSH;
        }
        // sugar cane on the waterline
        if (h === SEA && (ground === B.GRASS || ground === B.SAND || ground === B.DIRT) && blocks[col + h + 1] === B.AIR) {
          const nearWater = H(x - 1, z) < SEA || H(x + 1, z) < SEA || H(x, z - 1) < SEA || H(x, z + 1) < SEA;
          if (nearWater && u2 < 0.18 && this.misc.noise2(wx / 12, wz / 12 + 77) > 0.1) {
            const ch = 1 + ((u * 97) % 3 | 0);
            for (let y = 1; y <= ch; y++) blocks[col + h + y] = B.SUGAR_CANE;
          }
        }
      }
      if (snowy) {
        let y = WH - 2;
        while (y > 0 && blocks[col + y] === B.AIR) y--;
        const id = blocks[col + y];
        if (id !== B.WATER && id !== B.ICE && id !== B.SNOW_BLOCK && id !== B.LAVA && (OPAQUE[id] || id === B.LEAVES || id === B.SPRUCE_LEAVES || id === B.BIRCH_LEAVES)) {
          blocks[col + y + 1] = B.SNOW_LAYER;
        }
      }
    }
    return { blocks, meta };
  }
}
