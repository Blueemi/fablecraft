// Item registry, tool/food/armor stats, crafting & smelting recipes, block drops.
import { B, blocks, SH, WOOL_COLORS, isLeaves } from './blocks.js';

export const items = new Array(512).fill(null);
export const I = {};
export const itemByKey = new Map();
let nextId = 256;

function it(key, name, o = {}) {
  const id = nextId++;
  items[id] = { id, key, name, stack: 64, icon: 'item_' + key, ...o };
  I[key.toUpperCase()] = id;
  itemByKey.set(key, id);
  return id;
}

// block items share the block id
for (const b of blocks) {
  if (!b || b.id === 0) continue;
  const flat = b.flat ?? (b.shape === SH.CROSS ? blocks[b.id].key : null);
  items[b.id] = { id: b.id, key: b.key, name: b.name, stack: 64, block: b.id, icon: flat, hidden: b.noItem };
  itemByKey.set(b.key, b.id);
}
items[B.BED].stack = 1;

// ---- materials ----------------------------------------------------------------
it('stick', 'Stick', { fuel: 100 });
it('coal', 'Coal', { fuel: 1600 });
it('charcoal', 'Charcoal', { fuel: 1600 });
it('iron_ingot', 'Iron Ingot');
it('gold_ingot', 'Gold Ingot');
it('diamond', 'Diamond');
it('redstone', 'Redstone Dust');
it('lapis', 'Lapis Lazuli');
it('flint', 'Flint');
it('feather', 'Feather');
it('string', 'String');
it('gunpowder', 'Gunpowder');
it('bone', 'Bone');
it('bone_meal', 'Bone Meal');
it('leather', 'Leather');
it('clay_ball', 'Clay Ball');
it('brick', 'Brick');
it('snowball', 'Snowball', { stack: 16 });
it('paper', 'Paper');
it('book', 'Book');
it('wheat_seeds', 'Wheat Seeds', { place: B.WHEAT });
it('wheat', 'Wheat');
it('bowl', 'Bowl');

// ---- tools --------------------------------------------------------------------
export const TIERS = {
  wooden: { tier: 0, speed: 2, dur: 59, dmg: 0, name: 'Wooden' },
  stone: { tier: 1, speed: 4, dur: 131, dmg: 1, name: 'Stone' },
  iron: { tier: 2, speed: 6, dur: 250, dmg: 2, name: 'Iron' },
  golden: { tier: 0, speed: 12, dur: 32, dmg: 0, name: 'Golden' },
  diamond: { tier: 3, speed: 8, dur: 1561, dmg: 3, name: 'Diamond' },
};
const TOOL_KINDS = [['sword', 'Sword', 4], ['pickaxe', 'Pickaxe', 2], ['axe', 'Axe', 3], ['shovel', 'Shovel', 1], ['hoe', 'Hoe', 0]];
for (const m in TIERS) {
  const t = TIERS[m];
  for (const [k, n, base] of TOOL_KINDS) {
    it(`${m}_${k}`, `${t.name} ${n}`, {
      stack: 1, tool: k, tier: t.tier, speed: t.speed, dur: t.dur, dmg: k === 'hoe' ? 1 : base + t.dmg, mat: m,
      fuel: m === 'wooden' ? 200 : 0,
    });
  }
}
it('shears', 'Shears', { stack: 1, tool: 'shears', tier: 0, speed: 5, dur: 238, dmg: 1 });
it('flint_and_steel', 'Flint and Steel', { stack: 1, dur: 64 });
it('bucket', 'Bucket', { stack: 16 });
it('water_bucket', 'Water Bucket', { stack: 1 });
it('lava_bucket', 'Lava Bucket', { stack: 1, fuel: 20000 });
it('bow', 'Bow', { stack: 1, dur: 384, fuel: 300 });
it('arrow', 'Arrow');

// ---- food ---------------------------------------------------------------------
const food = (hunger, sat, o = {}) => ({ food: { hunger, sat }, ...o });
it('apple', 'Apple', food(4, 2.4));
it('golden_apple', 'Golden Apple', food(4, 9.6, { always: true }));
it('bread', 'Bread', food(5, 6));
it('porkchop', 'Raw Porkchop', food(3, 1.8));
it('cooked_porkchop', 'Cooked Porkchop', food(8, 12.8));
it('beef', 'Raw Beef', food(3, 1.8));
it('steak', 'Steak', food(8, 12.8));
it('chicken', 'Raw Chicken', food(2, 1.2));
it('cooked_chicken', 'Cooked Chicken', food(6, 7.2));
it('mutton', 'Raw Mutton', food(2, 1.2));
it('cooked_mutton', 'Cooked Mutton', food(6, 9.6));
it('rotten_flesh', 'Rotten Flesh', food(4, 0.8));
it('mushroom_stew', 'Mushroom Stew', food(6, 7.2, { stack: 1 }));

// ---- armor --------------------------------------------------------------------
export const ARMOR_MATS = {
  leather: { name: 'Leather', pts: [1, 3, 2, 1], dur: 5 },
  golden: { name: 'Golden', pts: [2, 5, 3, 1], dur: 7 },
  iron: { name: 'Iron', pts: [2, 6, 5, 2], dur: 15 },
  diamond: { name: 'Diamond', pts: [3, 8, 6, 3], dur: 33 },
};
const ARMOR_SLOTS = [['helmet', 'Helmet', 11], ['chestplate', 'Chestplate', 16], ['leggings', 'Leggings', 15], ['boots', 'Boots', 13]];
const LEATHER_NAMES = ['Leather Cap', 'Leather Tunic', 'Leather Pants', 'Leather Boots'];
for (const m in ARMOR_MATS) {
  const a = ARMOR_MATS[m];
  ARMOR_SLOTS.forEach(([k, n, d], slot) => {
    it(`${m}_${k}`, m === 'leather' ? LEATHER_NAMES[slot] : `${a.name} ${n}`, { stack: 1, armor: { slot, pts: a.pts[slot] }, dur: a.dur * d, mat: m });
  });
}

// fuels for block items
const FUEL = {
  [B.PLANKS]: 300, [B.BIRCH_PLANKS]: 300, [B.SPRUCE_PLANKS]: 300, [B.LOG]: 300, [B.BIRCH_LOG]: 300, [B.SPRUCE_LOG]: 300,
  [B.SAPLING]: 100, [B.BIRCH_SAPLING]: 100, [B.SPRUCE_SAPLING]: 100, [B.COAL_BLOCK]: 16000, [B.CRAFTING_TABLE]: 300,
  [B.CHEST]: 300, [B.BOOKSHELF]: 300, [B.FENCE]: 300, [B.OAK_SLAB]: 150, [B.BIRCH_SLAB]: 150, [B.SPRUCE_SLAB]: 150,
  [B.OAK_STAIRS]: 300, [B.BIRCH_STAIRS]: 300, [B.SPRUCE_STAIRS]: 300, [B.DOOR]: 200, [B.LADDER]: 300,
};
for (let i = 0; i < 16; i++) FUEL[B.WOOL + i] = 100;
export const fuelTime = (id) => (id < 256 ? FUEL[id] || 0 : items[id]?.fuel || 0);

// ---- smelting -------------------------------------------------------------------
export const SMELT = new Map([
  [B.IRON_ORE, I.IRON_INGOT], [B.GOLD_ORE, I.GOLD_INGOT], [B.SAND, B.GLASS], [B.COBBLESTONE, B.STONE], [B.STONE, B.SMOOTH_STONE],
  [B.LOG, I.CHARCOAL], [B.BIRCH_LOG, I.CHARCOAL], [B.SPRUCE_LOG, I.CHARCOAL], [I.CLAY_BALL, I.BRICK],
  [I.PORKCHOP, I.COOKED_PORKCHOP], [I.BEEF, I.STEAK], [I.CHICKEN, I.COOKED_CHICKEN], [I.MUTTON, I.COOKED_MUTTON],
  [B.COAL_ORE, I.COAL], [B.DIAMOND_ORE, I.DIAMOND], [B.REDSTONE_ORE, I.REDSTONE], [B.LAPIS_ORE, I.LAPIS],
]);

// ---- crafting -------------------------------------------------------------------
const G = {
  planks: [B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS],
  logs: [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG],
  wool: Array.from({ length: 16 }, (_, i) => B.WOOL + i),
  coal: [I.COAL, I.CHARCOAL],
};
export const recipes = [];
const norm = (x) => (typeof x === 'string' ? G[x.slice(1)] : x);
function shaped(out, count, pattern, key) {
  const h = pattern.length, w = pattern[0].length, grid = [];
  for (const row of pattern) for (const ch of row) grid.push(ch === ' ' ? 0 : norm(key[ch]));
  recipes.push({ w, h, grid, out, count });
}
function shapeless(out, count, list) {
  recipes.push({ shapeless: list.map(norm), out, count });
}
const P = '#planks';

shaped(B.PLANKS, 4, ['L'], { L: B.LOG });
shaped(B.BIRCH_PLANKS, 4, ['L'], { L: B.BIRCH_LOG });
shaped(B.SPRUCE_PLANKS, 4, ['L'], { L: B.SPRUCE_LOG });
shaped(I.STICK, 4, ['P', 'P'], { P });
shaped(B.CRAFTING_TABLE, 1, ['PP', 'PP'], { P });
shaped(B.FURNACE, 1, ['CCC', 'C C', 'CCC'], { C: B.COBBLESTONE });
shaped(B.CHEST, 1, ['PPP', 'P P', 'PPP'], { P });
shaped(B.TORCH, 4, ['C', 'S'], { C: '#coal', S: I.STICK });
const TOOL_MAT = { wooden: P, stone: B.COBBLESTONE, iron: I.IRON_INGOT, golden: I.GOLD_INGOT, diamond: I.DIAMOND };
for (const m in TOOL_MAT) {
  const k = { M: TOOL_MAT[m], S: I.STICK };
  shaped(I[`${m}_PICKAXE`.toUpperCase()], 1, ['MMM', ' S ', ' S '], k);
  shaped(I[`${m}_AXE`.toUpperCase()], 1, ['MM', 'MS', ' S'], k);
  shaped(I[`${m}_SHOVEL`.toUpperCase()], 1, ['M', 'S', 'S'], k);
  shaped(I[`${m}_SWORD`.toUpperCase()], 1, ['M', 'M', 'S'], k);
  shaped(I[`${m}_HOE`.toUpperCase()], 1, ['MM', ' S', ' S'], k);
}
const ARMOR_MAT = { leather: I.LEATHER, iron: I.IRON_INGOT, golden: I.GOLD_INGOT, diamond: I.DIAMOND };
for (const m in ARMOR_MAT) {
  const k = { M: ARMOR_MAT[m] };
  shaped(I[`${m}_HELMET`.toUpperCase()], 1, ['MMM', 'M M'], k);
  shaped(I[`${m}_CHESTPLATE`.toUpperCase()], 1, ['M M', 'MMM', 'MMM'], k);
  shaped(I[`${m}_LEGGINGS`.toUpperCase()], 1, ['MMM', 'M M', 'M M'], k);
  shaped(I[`${m}_BOOTS`.toUpperCase()], 1, ['M M', 'M M'], k);
}
shaped(B.STONE_BRICKS, 4, ['SS', 'SS'], { S: B.STONE });
shaped(B.SANDSTONE, 1, ['SS', 'SS'], { S: B.SAND });
shaped(B.BRICKS, 1, ['BB', 'BB'], { B: I.BRICK });
shaped(B.SNOW_BLOCK, 1, ['SS', 'SS'], { S: I.SNOWBALL });
shaped(B.CLAY, 1, ['CC', 'CC'], { C: I.CLAY_BALL });
shaped(B.WOOL, 1, ['SS', 'SS'], { S: I.STRING });
shaped(B.STONE_SLAB, 6, ['SSS'], { S: B.SMOOTH_STONE });
shaped(B.STONE_SLAB, 6, ['SSS'], { S: B.STONE });
shaped(B.OAK_SLAB, 6, ['SSS'], { S: B.PLANKS });
shaped(B.BIRCH_SLAB, 6, ['SSS'], { S: B.BIRCH_PLANKS });
shaped(B.SPRUCE_SLAB, 6, ['SSS'], { S: B.SPRUCE_PLANKS });
shaped(B.COBBLESTONE_SLAB, 6, ['SSS'], { S: B.COBBLESTONE });
shaped(B.BRICK_SLAB, 6, ['SSS'], { S: B.BRICKS });
shaped(B.STONE_BRICK_SLAB, 6, ['SSS'], { S: B.STONE_BRICKS });
shaped(B.SANDSTONE_SLAB, 6, ['SSS'], { S: B.SANDSTONE });
const stairsOf = (out, m) => shaped(out, 4, ['M  ', 'MM ', 'MMM'], { M: m });
stairsOf(B.OAK_STAIRS, B.PLANKS);
stairsOf(B.BIRCH_STAIRS, B.BIRCH_PLANKS);
stairsOf(B.SPRUCE_STAIRS, B.SPRUCE_PLANKS);
stairsOf(B.COBBLESTONE_STAIRS, B.COBBLESTONE);
stairsOf(B.STONE_BRICK_STAIRS, B.STONE_BRICKS);
stairsOf(B.BRICK_STAIRS, B.BRICKS);
stairsOf(B.SANDSTONE_STAIRS, B.SANDSTONE);
shaped(B.TNT, 1, ['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND });
shaped(B.BOOKSHELF, 1, ['PPP', 'BBB', 'PPP'], { P, B: I.BOOK });
shaped(I.PAPER, 3, ['SSS'], { S: B.SUGAR_CANE });
shapeless(I.BOOK, 1, [I.PAPER, I.PAPER, I.PAPER, I.LEATHER]);
shaped(B.BED, 1, ['WWW', 'PPP'], { W: '#wool', P });
shaped(B.DOOR, 3, ['PP', 'PP', 'PP'], { P });
shaped(B.LADDER, 3, ['S S', 'SSS', 'S S'], { S: I.STICK });
shaped(B.FENCE, 3, ['PSP', 'PSP'], { P, S: I.STICK });
shaped(I.BUCKET, 1, ['I I', ' I '], { I: I.IRON_INGOT });
shaped(I.SHEARS, 1, [' I', 'I '], { I: I.IRON_INGOT });
shapeless(I.FLINT_AND_STEEL, 1, [I.IRON_INGOT, I.FLINT]);
shaped(I.BOW, 1, [' SW', 'S W', ' SW'], { S: I.STICK, W: I.STRING });
shaped(I.ARROW, 4, ['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER });
shaped(I.BREAD, 1, ['WWW'], { W: I.WHEAT });
shapeless(I.BONE_MEAL, 3, [I.BONE]);
shaped(I.BOWL, 4, ['P P', ' P '], { P });
shapeless(I.MUSHROOM_STEW, 1, [B.RED_MUSHROOM, B.BROWN_MUSHROOM, I.BOWL]);
shaped(I.GOLDEN_APPLE, 1, ['GGG', 'GAG', 'GGG'], { G: I.GOLD_INGOT, A: I.APPLE });
shaped(B.JACK_O_LANTERN, 1, ['P', 'T'], { P: B.PUMPKIN, T: B.TORCH });
shaped(B.GLOWSTONE, 1, ['RG', 'GR'], { R: I.REDSTONE, G: I.GOLD_INGOT });
shapeless(B.MOSSY_COBBLESTONE, 1, [B.COBBLESTONE, B.TALL_GRASS]);
shapeless(B.MOSSY_STONE_BRICKS, 1, [B.STONE_BRICKS, B.TALL_GRASS]);
const blockOf = (block, item) => {
  shaped(block, 1, ['XXX', 'XXX', 'XXX'], { X: item });
  shapeless(item, 9, [block]);
};
blockOf(B.IRON_BLOCK, I.IRON_INGOT);
blockOf(B.GOLD_BLOCK, I.GOLD_INGOT);
blockOf(B.DIAMOND_BLOCK, I.DIAMOND);
blockOf(B.COAL_BLOCK, I.COAL);
blockOf(B.LAPIS_BLOCK, I.LAPIS);
blockOf(B.REDSTONE_BLOCK, I.REDSTONE);

const ingMatch = (ing, id) => (Array.isArray(ing) ? ing.includes(id) : ing === id);

// grid: array of item ids (0 = empty), size gw*gw. Returns {id,count} or null.
export function matchRecipe(grid, gw) {
  let x0 = gw, y0 = gw, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < gw; y++) for (let x = 0; x < gw; x++) {
    if (grid[y * gw + x]) {
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!n) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  for (const r of recipes) {
    if (r.shapeless) {
      if (r.shapeless.length !== n) continue;
      const used = new Array(gw * gw).fill(false);
      let ok = true;
      for (const ing of r.shapeless) {
        let found = false;
        for (let i = 0; i < grid.length; i++) {
          if (grid[i] && !used[i] && ingMatch(ing, grid[i])) { used[i] = found = true; break; }
        }
        if (!found) { ok = false; break; }
      }
      if (ok) return { id: r.out, count: r.count };
      continue;
    }
    if (r.w !== w || r.h !== h) continue;
    for (let flip = 0; flip < 2; flip++) {
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) {
        const want = r.grid[y * w + (flip ? w - 1 - x : x)];
        const have = grid[(y0 + y) * gw + x0 + x];
        if (want === 0 ? have !== 0 : !ingMatch(want, have)) { ok = false; break; }
      }
      if (ok) return { id: r.out, count: r.count };
    }
  }
  return null;
}

// ---- mining -----------------------------------------------------------------------
export function canHarvest(blockId, tool) {
  const b = blocks[blockId];
  if (!b.need) return true;
  return !!tool && tool.tool === b.tool && tool.tier >= b.level;
}

export function digSpeed(blockId, tool) {
  const b = blocks[blockId];
  if (!tool || !tool.tool) return 1;
  if (tool.tool === 'sword') return isLeaves(blockId) ? 1.5 : 1.5;
  if (tool.tool === 'shears') return isLeaves(blockId) ? 15 : b.tool === 'shears' ? 5 : 1;
  return tool.tool === b.tool ? tool.speed : 1;
}

const ri = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));

// Items dropped when a block is broken. tool = item def of the held item (or null).
export function getDrops(id, meta, tool, rand = Math.random) {
  const b = blocks[id];
  if (!b || !canHarvest(id, tool)) return [];
  const one = (i, c = 1) => [{ id: i, count: c }];
  const shears = tool && tool.tool === 'shears';
  switch (id) {
    case B.STONE: return one(B.COBBLESTONE);
    case B.GRASS: case B.FARMLAND: return one(B.DIRT);
    case B.COAL_ORE: return one(I.COAL);
    case B.DIAMOND_ORE: return one(I.DIAMOND);
    case B.REDSTONE_ORE: return one(I.REDSTONE, ri(rand, 4, 5));
    case B.LAPIS_ORE: return one(I.LAPIS, ri(rand, 4, 8));
    case B.LEAVES: case B.BIRCH_LEAVES: case B.SPRUCE_LEAVES: {
      if (shears) return one(id);
      const out = [];
      if (rand() < 0.06) out.push({ id: id === B.LEAVES ? B.SAPLING : id === B.BIRCH_LEAVES ? B.BIRCH_SAPLING : B.SPRUCE_SAPLING, count: 1 });
      if (id === B.LEAVES && rand() < 0.01) out.push({ id: I.APPLE, count: 1 });
      if (rand() < 0.03) out.push({ id: I.STICK, count: 1 });
      return out;
    }
    case B.GLASS: case B.ICE: case B.FIRE: case B.BEDROCK: case B.WATER: case B.LAVA: return [];
    case B.TALL_GRASS: return shears ? one(id) : rand() < 0.15 ? one(I.WHEAT_SEEDS) : [];
    case B.DEAD_BUSH: return shears ? one(id) : rand() < 0.7 ? one(I.STICK, ri(rand, 1, 2)) : [];
    case B.GRAVEL: return rand() < 0.1 ? one(I.FLINT) : one(id);
    case B.GLOWSTONE: return one(id);
    case B.BOOKSHELF: return one(I.BOOK, 3);
    case B.CLAY: return one(I.CLAY_BALL, 4);
    case B.SNOW_LAYER: return one(I.SNOWBALL);
    case B.SNOW_BLOCK: return one(I.SNOWBALL, 4);
    case B.WHEAT:
      return (meta & 7) === 7 ? [{ id: I.WHEAT, count: 1 }, { id: I.WHEAT_SEEDS, count: ri(rand, 1, 3) }] : one(I.WHEAT_SEEDS);
    case B.FURNACE_LIT: return one(B.FURNACE);
    case B.DOOR: return meta & 8 ? [] : one(B.DOOR);
    case B.BED: return meta & 4 ? [] : one(B.BED);
  }
  return one(id);
}

// xp granted for mining
export function blockXp(id, rand = Math.random) {
  switch (id) {
    case B.COAL_ORE: return ri(rand, 0, 2);
    case B.DIAMOND_ORE: return ri(rand, 3, 7);
    case B.LAPIS_ORE: return ri(rand, 2, 5);
    case B.REDSTONE_ORE: return ri(rand, 1, 5);
  }
  return 0;
}

export const maxStack = (id) => items[id]?.stack ?? 64;
export const itemName = (id) => items[id]?.name ?? 'Unknown';

// creative inventory order
export const CREATIVE = (() => {
  const out = [];
  const add = (...ids) => ids.forEach((i) => i !== undefined && !out.includes(i) && out.push(i));
  add(B.STONE, B.GRASS, B.DIRT, B.COBBLESTONE, B.MOSSY_COBBLESTONE, B.GRANITE, B.DIORITE, B.ANDESITE, B.SMOOTH_STONE);
  add(B.STONE_BRICKS, B.MOSSY_STONE_BRICKS, B.BRICKS, B.SAND, B.SANDSTONE, B.GRAVEL, B.CLAY, B.OBSIDIAN, B.BEDROCK);
  add(B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS, B.LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES);
  add(B.GLASS, B.ICE, B.SNOW_BLOCK, B.SNOW_LAYER, B.GLOWSTONE, B.BOOKSHELF, B.PUMPKIN, B.JACK_O_LANTERN, B.CACTUS);
  add(B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.REDSTONE_ORE, B.LAPIS_ORE);
  add(B.COAL_BLOCK, B.IRON_BLOCK, B.GOLD_BLOCK, B.DIAMOND_BLOCK, B.REDSTONE_BLOCK, B.LAPIS_BLOCK);
  add(B.STONE_SLAB, B.COBBLESTONE_SLAB, B.STONE_BRICK_SLAB, B.BRICK_SLAB, B.SANDSTONE_SLAB, B.OAK_SLAB, B.BIRCH_SLAB, B.SPRUCE_SLAB);
  add(B.COBBLESTONE_STAIRS, B.STONE_BRICK_STAIRS, B.BRICK_STAIRS, B.SANDSTONE_STAIRS, B.OAK_STAIRS, B.BIRCH_STAIRS, B.SPRUCE_STAIRS);
  for (let i = 0; i < 16; i++) add(B.WOOL + i);
  add(B.CRAFTING_TABLE, B.FURNACE, B.CHEST, B.TORCH, B.LADDER, B.DOOR, B.FENCE, B.BED, B.TNT);
  add(B.SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING, B.TALL_GRASS, B.DEAD_BUSH, B.DANDELION, B.POPPY, B.CORNFLOWER, B.ALLIUM, B.DAISY);
  add(B.BROWN_MUSHROOM, B.RED_MUSHROOM, B.SUGAR_CANE);
  for (let i = 256; i < nextId; i++) add(i);
  return out;
})();
