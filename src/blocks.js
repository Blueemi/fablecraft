// Block registry: ids, physical/render properties, shapes and collision boxes.
// Shared by the main thread and the workers, so it must stay dependency-free.

export const CH = 16; // chunk width
export const WH = 128; // world height
export const SEA = 62; // sea level (top water block)

// ---- texture name registry (name -> array-texture layer) -------------------
export const TEX = [];
const texMap = new Map();
export function texId(name) {
  let i = texMap.get(name);
  if (i === undefined) {
    i = TEX.length;
    TEX.push(name);
    texMap.set(name, i);
  }
  return i;
}
function texAnim(name, frames) {
  const first = texId(name + '_0');
  for (let i = 1; i < frames; i++) texId(name + '_' + i);
  return first;
}
export const ANIM_FRAMES = 16;

// ---- shapes -----------------------------------------------------------------
export const SH = {
  CUBE: 0, CROSS: 1, TORCH: 2, SLAB: 3, STAIRS: 4, FLUID: 5, CACTUS: 6, FARMLAND: 7,
  DOOR: 8, LADDER: 9, SNOW: 10, CROP: 11, FENCE: 12, CHEST: 13, BED: 14, FIRE: 15,
};

export const blocks = new Array(256).fill(null);
export const B = {};
export const OPAQUE = new Uint8Array(256); // full cube that hides neighbours
export const LOPAC = new Uint8Array(256); // light opacity 0..15
export const LEMIT = new Uint8Array(256); // light emission 0..15
export const SHAPE = new Uint8Array(256);
export const SOLID = new Uint8Array(256); // has collision
export const TRANSL = new Uint8Array(256); // drawn in translucent pass
export const FLUID = new Uint8Array(256); // 1 water, 2 lava
export const REPLACEABLE = new Uint8Array(256);
export const TICKS = new Uint8Array(256); // receives random ticks
export const LTERM = new Uint8Array(256); // receives light but does not pass it on (slabs, stairs)

// face order: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
// facing (meta & 3): 0:+Z(south) 1:-X(west) 2:-Z(north) 3:+X(east)
export const FACING_DX = [0, -1, 0, 1];
export const FACING_DZ = [1, 0, -1, 0];
export const FACING_TO_FACE = [4, 1, 5, 0];

function def(id, key, name, o = {}) {
  const shape = o.shape ?? SH.CUBE;
  const t = o.tex ?? key;
  const faces = new Uint16Array(6);
  if (typeof t === 'string') faces.fill(texId(t));
  else {
    const side = texId(t.side ?? t.all);
    faces[0] = faces[1] = faces[4] = faces[5] = side;
    faces[2] = texId(t.top ?? t.all ?? t.side);
    faces[3] = texId(t.bottom ?? t.top ?? t.all ?? t.side);
  }
  const nonSolidShape = shape === SH.CROSS || shape === SH.TORCH || shape === SH.FLUID || shape === SH.CROP || shape === SH.FIRE || shape === SH.SNOW;
  const opaque = shape === SH.CUBE && !o.cutout && !o.transl;
  const d = {
    id, key, name, shape, faces,
    front: typeof t === 'object' && t.front ? texId(t.front) : -1,
    tex: {},
    solid: o.solid ?? !nonSolidShape,
    opaque,
    cutout: !!o.cutout,
    transl: !!o.transl,
    opac: o.opac ?? (opaque ? 15 : 0),
    emit: o.emit ?? 0,
    hard: o.h ?? 1,
    tool: o.t ?? null,
    level: o.lv ?? 0,
    need: !!o.need,
    sound: o.snd ?? 'stone',
    tint: o.tint ?? 0, // 1 grass, 2 foliage, 3 water, 4 fixed colour
    color: o.color ?? 0xffffff,
    flammable: !!o.flam,
    gravity: !!o.grav,
    slip: o.slip ?? 0.6,
    replaceable: !!o.repl,
    fluid: o.fluid ?? 0,
    anim: o.anim ?? 0,
    full: o.full ?? 0, // slabs: block made by stacking two
    noItem: !!o.noItem,
    flat: o.flat ?? null, // flat inventory icon texture
    climb: !!o.climb,
    ticks: !!o.ticks,
    resist: o.resist ?? (o.h ?? 1) * 5,
    selBox: o.sel ?? null,
    cullSame: !!o.cullSame,
    term: !!o.term,
  };
  if (typeof t === 'object') for (const k in t) d.tex[k] = texId(t[k]);
  blocks[id] = d;
  B[key.toUpperCase()] = id;
  OPAQUE[id] = opaque ? 1 : 0;
  LOPAC[id] = d.opac;
  LEMIT[id] = d.emit;
  SHAPE[id] = shape;
  SOLID[id] = d.solid ? 1 : 0;
  TRANSL[id] = d.transl ? 1 : 0;
  FLUID[id] = d.fluid;
  REPLACEABLE[id] = d.replaceable ? 1 : 0;
  TICKS[id] = d.ticks ? 1 : 0;
  LTERM[id] = d.term ? 1 : 0;
  return d;
}

const PICK = 'pickaxe', AXE = 'axe', SHOVEL = 'shovel';
const plant = (tex, extra = {}) => ({ shape: SH.CROSS, tex, h: 0, snd: 'grass', cutout: true, flat: tex, ...extra });

blocks[0] = { id: 0, key: 'air', name: 'Air', shape: SH.CUBE, faces: new Uint16Array(6), solid: false, opaque: false, opac: 0, emit: 0, hard: 0, replaceable: true, noItem: true, sound: 'stone', tex: {}, slip: 0.6, fluid: 0, resist: 0 };
B.AIR = 0;
REPLACEABLE[0] = 1;

def(1, 'stone', 'Stone', { h: 1.5, t: PICK, need: 1, resist: 30 });
def(2, 'grass', 'Grass Block', { tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side', overlay: 'grass_side_overlay', snow: 'grass_side_snow' }, h: 0.6, t: SHOVEL, snd: 'grass', tint: 1, ticks: 1 });
def(3, 'dirt', 'Dirt', { h: 0.5, t: SHOVEL, snd: 'gravel', ticks: 1 });
def(4, 'cobblestone', 'Cobblestone', { h: 2, t: PICK, need: 1, resist: 30 });
def(5, 'planks', 'Oak Planks', { tex: 'planks_oak', h: 2, t: AXE, snd: 'wood', flam: 1 });
def(6, 'sapling', 'Oak Sapling', plant('sapling_oak', { ticks: 1, sel: [0.1, 0, 0.1, 0.9, 0.8, 0.9] }));
def(7, 'bedrock', 'Bedrock', { h: -1, resist: 1e7 });
def(8, 'water', 'Water', { shape: SH.FLUID, tex: 'water_0', transl: 1, opac: 1, h: 100, tint: 3, repl: 1, fluid: 1, anim: 1, noItem: 1, cullSame: 1, resist: 500 });
texAnim('water', ANIM_FRAMES);
def(9, 'lava', 'Lava', { shape: SH.FLUID, tex: 'lava_0', emit: 15, h: 100, repl: 1, fluid: 2, anim: 2, noItem: 1, cullSame: 1, resist: 500 });
texAnim('lava', ANIM_FRAMES);
def(10, 'sand', 'Sand', { h: 0.5, t: SHOVEL, snd: 'sand', grav: 1 });
def(11, 'gravel', 'Gravel', { h: 0.6, t: SHOVEL, snd: 'gravel', grav: 1 });
def(12, 'gold_ore', 'Gold Ore', { h: 3, t: PICK, lv: 2, need: 1 });
def(13, 'iron_ore', 'Iron Ore', { h: 3, t: PICK, lv: 1, need: 1 });
def(14, 'coal_ore', 'Coal Ore', { h: 3, t: PICK, need: 1 });
def(15, 'log', 'Oak Log', { tex: { top: 'log_oak_top', side: 'log_oak' }, h: 2, t: AXE, snd: 'wood', flam: 1 });
def(16, 'leaves', 'Oak Leaves', { tex: 'leaves_oak', cutout: 1, opac: 1, h: 0.2, t: 'shears', snd: 'grass', tint: 2, flam: 1, ticks: 1 });
def(17, 'glass', 'Glass', { cutout: 1, h: 0.3, snd: 'glass', cullSame: 1 });
def(18, 'lapis_ore', 'Lapis Lazuli Ore', { h: 3, t: PICK, lv: 1, need: 1 });
def(19, 'sandstone', 'Sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, h: 0.8, t: PICK, need: 1 });
def(20, 'tall_grass', 'Grass', plant('tall_grass', { tint: 1, repl: 1, sel: [0.1, 0, 0.1, 0.9, 0.8, 0.9] }));
def(21, 'dead_bush', 'Dead Bush', plant('dead_bush', { repl: 1, sel: [0.1, 0, 0.1, 0.9, 0.8, 0.9] }));
def(22, 'dandelion', 'Dandelion', plant('dandelion', { sel: [0.3, 0, 0.3, 0.7, 0.6, 0.7] }));
def(23, 'poppy', 'Poppy', plant('poppy', { sel: [0.3, 0, 0.3, 0.7, 0.6, 0.7] }));
def(24, 'brown_mushroom', 'Brown Mushroom', plant('mushroom_brown', { emit: 1, sel: [0.3, 0, 0.3, 0.7, 0.4, 0.7] }));
def(25, 'red_mushroom', 'Red Mushroom', plant('mushroom_red', { sel: [0.3, 0, 0.3, 0.7, 0.4, 0.7] }));
def(26, 'gold_block', 'Block of Gold', { h: 3, t: PICK, lv: 2, need: 1, resist: 30 });
def(27, 'iron_block', 'Block of Iron', { h: 5, t: PICK, lv: 1, need: 1, resist: 30 });
def(28, 'bricks', 'Bricks', { h: 2, t: PICK, need: 1, resist: 30 });
def(29, 'tnt', 'TNT', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, h: 0, snd: 'grass', flam: 1 });
def(30, 'bookshelf', 'Bookshelf', { tex: { top: 'planks_oak', side: 'bookshelf' }, h: 1.5, t: AXE, snd: 'wood', flam: 1 });
def(31, 'mossy_cobblestone', 'Mossy Cobblestone', { h: 2, t: PICK, need: 1, resist: 30 });
def(32, 'obsidian', 'Obsidian', { h: 50, t: PICK, lv: 3, need: 1, resist: 6000 });
def(33, 'torch', 'Torch', { shape: SH.TORCH, cutout: 1, emit: 14, h: 0, snd: 'wood', flat: 'torch' });
def(34, 'chest', 'Chest', { shape: SH.CHEST, tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front' }, h: 2.5, t: AXE, snd: 'wood' });
def(35, 'diamond_ore', 'Diamond Ore', { h: 3, t: PICK, lv: 2, need: 1 });
def(36, 'diamond_block', 'Block of Diamond', { h: 5, t: PICK, lv: 2, need: 1, resist: 30 });
def(37, 'crafting_table', 'Crafting Table', { tex: { top: 'crafting_top', bottom: 'planks_oak', side: 'crafting_side', front: 'crafting_front' }, h: 2.5, t: AXE, snd: 'wood', flam: 1 });
def(38, 'farmland', 'Farmland', { shape: SH.FARMLAND, tex: { top: 'farmland_dry', wet: 'farmland_wet', side: 'dirt', bottom: 'dirt' }, term: 1, h: 0.6, t: SHOVEL, snd: 'gravel', ticks: 1, noItem: 1 });
def(39, 'wheat', 'Wheat Crops', { shape: SH.CROP, tex: 'wheat_0', cutout: 1, h: 0, snd: 'grass', ticks: 1, noItem: 1 });
for (let i = 1; i < 8; i++) texId('wheat_' + i);
def(40, 'furnace', 'Furnace', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, h: 3.5, t: PICK, need: 1 });
def(41, 'furnace_lit', 'Furnace', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' }, h: 3.5, t: PICK, need: 1, emit: 13, noItem: 1 });
def(42, 'ladder', 'Ladder', { shape: SH.LADDER, cutout: 1, h: 0.4, t: AXE, snd: 'wood', flat: 'ladder', climb: 1 });
def(43, 'door', 'Oak Door', { shape: SH.DOOR, tex: { all: 'door_bottom', top: 'door_top', bottom: 'door_bottom' }, cutout: 1, h: 3, t: AXE, snd: 'wood', flat: 'item_door' });
def(44, 'redstone_ore', 'Redstone Ore', { h: 3, t: PICK, lv: 2, need: 1 });
def(45, 'snow_layer', 'Snow', { shape: SH.SNOW, tex: 'snow', h: 0.1, t: SHOVEL, need: 1, snd: 'snow', repl: 1 });
def(46, 'ice', 'Ice', { transl: 1, opac: 2, h: 0.5, t: PICK, snd: 'glass', slip: 0.98, cullSame: 1 });
def(47, 'snow_block', 'Snow Block', { tex: 'snow', h: 0.2, t: SHOVEL, need: 1, snd: 'snow' });
def(48, 'cactus', 'Cactus', { shape: SH.CACTUS, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, cutout: 1, h: 0.4, snd: 'cloth', ticks: 1 });
def(49, 'clay', 'Clay', { h: 0.6, t: SHOVEL, snd: 'gravel' });
def(50, 'sugar_cane', 'Sugar Cane', plant('sugar_cane', { ticks: 1, sel: [0.125, 0, 0.125, 0.875, 1, 0.875] }));
def(51, 'pumpkin', 'Pumpkin', { tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' }, h: 1, t: AXE, snd: 'wood' });
def(52, 'jack_o_lantern', "Jack o'Lantern", { tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face_lit' }, h: 1, t: AXE, snd: 'wood', emit: 15 });
def(53, 'glowstone', 'Glowstone', { h: 0.3, snd: 'glass', emit: 15 });
def(54, 'birch_log', 'Birch Log', { tex: { top: 'log_birch_top', side: 'log_birch' }, h: 2, t: AXE, snd: 'wood', flam: 1 });
def(55, 'birch_leaves', 'Birch Leaves', { tex: 'leaves_birch', cutout: 1, opac: 1, h: 0.2, t: 'shears', snd: 'grass', tint: 4, color: 0x80a755, flam: 1, ticks: 1 });
def(56, 'birch_planks', 'Birch Planks', { tex: 'planks_birch', h: 2, t: AXE, snd: 'wood', flam: 1 });
def(57, 'spruce_log', 'Spruce Log', { tex: { top: 'log_spruce_top', side: 'log_spruce' }, h: 2, t: AXE, snd: 'wood', flam: 1 });
def(58, 'spruce_leaves', 'Spruce Leaves', { tex: 'leaves_spruce', cutout: 1, opac: 1, h: 0.2, t: 'shears', snd: 'grass', tint: 4, color: 0x619961, flam: 1, ticks: 1 });
def(59, 'spruce_planks', 'Spruce Planks', { tex: 'planks_spruce', h: 2, t: AXE, snd: 'wood', flam: 1 });
def(60, 'stone_bricks', 'Stone Bricks', { h: 1.5, t: PICK, need: 1, resist: 30 });
def(67, 'smooth_stone', 'Smooth Stone', { h: 2, t: PICK, need: 1, resist: 30 });
const slab = (o) => ({ shape: SH.SLAB, term: 1, ...o });
def(61, 'stone_slab', 'Stone Slab', slab({ tex: 'smooth_stone', h: 2, t: PICK, need: 1, full: 67 }));
def(62, 'oak_slab', 'Oak Slab', slab({ tex: 'planks_oak', h: 2, t: AXE, snd: 'wood', full: 5, flam: 1 }));
def(63, 'cobblestone_slab', 'Cobblestone Slab', slab({ tex: 'cobblestone', h: 2, t: PICK, need: 1, full: 4 }));
const stairs = (o) => ({ shape: SH.STAIRS, term: 1, ...o });
def(64, 'oak_stairs', 'Oak Stairs', stairs({ tex: 'planks_oak', h: 2, t: AXE, snd: 'wood', flam: 1 }));
def(65, 'cobblestone_stairs', 'Cobblestone Stairs', stairs({ tex: 'cobblestone', h: 2, t: PICK, need: 1 }));
def(66, 'stone_brick_stairs', 'Stone Brick Stairs', stairs({ tex: 'stone_bricks', h: 1.5, t: PICK, need: 1 }));
def(68, 'coal_block', 'Block of Coal', { h: 5, t: PICK, need: 1, resist: 30 });
def(69, 'lapis_block', 'Lapis Lazuli Block', { h: 3, t: PICK, lv: 1, need: 1 });
def(70, 'redstone_block', 'Block of Redstone', { h: 5, t: PICK, need: 1, resist: 30 });
def(71, 'birch_sapling', 'Birch Sapling', plant('sapling_birch', { ticks: 1, sel: [0.1, 0, 0.1, 0.9, 0.8, 0.9] }));
def(72, 'spruce_sapling', 'Spruce Sapling', plant('sapling_spruce', { ticks: 1, sel: [0.1, 0, 0.1, 0.9, 0.8, 0.9] }));
def(73, 'cornflower', 'Cornflower', plant('cornflower', { sel: [0.3, 0, 0.3, 0.7, 0.6, 0.7] }));
def(74, 'allium', 'Allium', plant('allium', { sel: [0.3, 0, 0.3, 0.7, 0.6, 0.7] }));
def(75, 'daisy', 'Oxeye Daisy', plant('daisy', { sel: [0.3, 0, 0.3, 0.7, 0.6, 0.7] }));
def(76, 'fence', 'Oak Fence', { shape: SH.FENCE, tex: 'planks_oak', h: 2, t: AXE, snd: 'wood', flam: 1 });
def(77, 'bed', 'Bed', { shape: SH.BED, tex: { all: 'bed_side', top: 'bed_top_foot', head: 'bed_top_head', bottom: 'planks_oak', side: 'bed_side', end: 'bed_end' }, cutout: 1, h: 0.2, snd: 'wood', flat: 'item_bed' });
def(78, 'granite', 'Granite', { h: 1.5, t: PICK, need: 1, resist: 30 });
def(79, 'diorite', 'Diorite', { h: 1.5, t: PICK, need: 1, resist: 30 });
def(80, 'andesite', 'Andesite', { h: 1.5, t: PICK, need: 1, resist: 30 });
def(81, 'fire', 'Fire', { shape: SH.FIRE, tex: 'fire_0', cutout: 1, emit: 15, h: 0, repl: 1, anim: 3, noItem: 1, ticks: 1, snd: 'cloth' });
texAnim('fire', ANIM_FRAMES);
def(83, 'brick_stairs', 'Brick Stairs', stairs({ tex: 'bricks', h: 2, t: PICK, need: 1 }));
def(84, 'brick_slab', 'Brick Slab', slab({ tex: 'bricks', h: 2, t: PICK, need: 1, full: 28 }));
def(85, 'stone_brick_slab', 'Stone Brick Slab', slab({ tex: 'stone_bricks', h: 2, t: PICK, need: 1, full: 60 }));
def(86, 'sandstone_stairs', 'Sandstone Stairs', stairs({ tex: { all: 'sandstone_side', top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, h: 0.8, t: PICK, need: 1 }));
def(87, 'sandstone_slab', 'Sandstone Slab', slab({ tex: { all: 'sandstone_side', top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, h: 2, t: PICK, need: 1, full: 19 }));
def(88, 'birch_slab', 'Birch Slab', slab({ tex: 'planks_birch', h: 2, t: AXE, snd: 'wood', full: 56, flam: 1 }));
def(89, 'spruce_slab', 'Spruce Slab', slab({ tex: 'planks_spruce', h: 2, t: AXE, snd: 'wood', full: 59, flam: 1 }));
def(90, 'birch_stairs', 'Birch Stairs', stairs({ tex: 'planks_birch', h: 2, t: AXE, snd: 'wood', flam: 1 }));
def(91, 'spruce_stairs', 'Spruce Stairs', stairs({ tex: 'planks_spruce', h: 2, t: AXE, snd: 'wood', flam: 1 }));
def(92, 'mossy_stone_bricks', 'Mossy Stone Bricks', { h: 1.5, t: PICK, need: 1, resist: 30 });

export const WOOL_COLORS = [
  ['white', 'White', 0xe9ecec], ['orange', 'Orange', 0xf07613], ['magenta', 'Magenta', 0xbd44b3], ['light_blue', 'Light Blue', 0x3aafd9],
  ['yellow', 'Yellow', 0xf8c627], ['lime', 'Lime', 0x70b919], ['pink', 'Pink', 0xed8dac], ['gray', 'Gray', 0x3e4447],
  ['light_gray', 'Light Gray', 0x8e8e86], ['cyan', 'Cyan', 0x158991], ['purple', 'Purple', 0x792aac], ['blue', 'Blue', 0x35399d],
  ['brown', 'Brown', 0x724728], ['green', 'Green', 0x546d1b], ['red', 'Red', 0xa12722], ['black', 'Black', 0x141519],
];
WOOL_COLORS.forEach(([k, n], i) => def(96 + i, k + '_wool', n + ' Wool', { tex: 'wool_' + i, h: 0.8, t: 'shears', snd: 'cloth', flam: 1 }));
B.WOOL = 96;

// misc non-block textures that live in the same array texture
for (let i = 0; i < 10; i++) texId('crack_' + i);
['p_smoke', 'p_flame', 'p_bubble', 'p_splash', 'p_crit', 'p_heart', 'p_note', 'p_white', 'p_explode', 'p_lava'].forEach(texId);

export const isLeaves = (id) => id === 16 || id === 55 || id === 58;
export const isLog = (id) => id === 15 || id === 54 || id === 57;
export const isSapling = (id) => id === 6 || id === 71 || id === 72;
export const isFlower = (id) => id === 22 || id === 23 || (id >= 73 && id <= 75);
export const isWool = (id) => id >= 96 && id < 112;

// ---- collision / selection boxes ---------------------------------------------
const FULL = [[0, 0, 0, 1, 1, 1]];
const NONE = [];
const SLAB_BOT = [[0, 0, 0, 1, 0.5, 1]];
const SLAB_TOP = [[0, 0.5, 0, 1, 1, 1]];
const p = 1 / 16;
const STEP = [
  [0, 0.5, 0.5, 1, 1, 1], // facing +Z
  [0, 0.5, 0, 0.5, 1, 1], // -X
  [0, 0.5, 0, 1, 1, 0.5], // -Z
  [0.5, 0.5, 0, 1, 1, 1], // +X
];
const STAIR_BOXES = [];
for (let m = 0; m < 8; m++) {
  const s = STEP[m & 3];
  STAIR_BOXES.push(m & 4 ? [[0, 0.5, 0, 1, 1, 1], [s[0], 0, s[2], s[3], 0.5, s[5]]] : [[0, 0, 0, 1, 0.5, 1], s]);
}
// thin slab positions for doors / ladders, indexed by facing
const DOOR_BOXES = [
  [[0, 0, 0, 1, 1, 3 * p]],
  [[1 - 3 * p, 0, 0, 1, 1, 1]],
  [[0, 0, 1 - 3 * p, 1, 1, 1]],
  [[0, 0, 0, 3 * p, 1, 1]],
];
const LADDER_BOXES = [
  [[0, 0, 0, 1, 1, 2 * p]],
  [[1 - 2 * p, 0, 0, 1, 1, 1]],
  [[0, 0, 1 - 2 * p, 1, 1, 1]],
  [[0, 0, 0, 2 * p, 1, 1]],
];
const TORCH_SEL = [
  [[0.4, 0, 0.4, 0.6, 0.6, 0.6]],
  [[0.35, 0.2, 0, 0.65, 0.8, 0.3]],
  [[0.7, 0.2, 0.35, 1, 0.8, 0.65]],
  [[0.35, 0.2, 0.7, 0.65, 0.8, 1]],
  [[0, 0.2, 0.35, 0.3, 0.8, 0.65]],
];
const CROSS_SEL = [[0.2, 0, 0.2, 0.8, 0.8, 0.8]];
const CACTUS_COL = [[p, 0, p, 1 - p, 1 - p, 1 - p]];
const CACTUS_SEL = [[p, 0, p, 1 - p, 1, 1 - p]];
const FARM_BOX = [[0, 0, 0, 1, 15 * p, 1]];
const SNOW_SEL = [[0, 0, 0, 1, 2 * p, 1]];
const CHEST_BOX = [[p, 0, p, 1 - p, 14 * p, 1 - p]];
const BED_BOX = [[0, 0, 0, 1, 9 * p, 1]];

export function doorBoxIndex(meta) {
  return meta & 4 ? ((meta & 3) + 3) & 3 : meta & 3;
}
export function fenceConnects(id) {
  return id === 76 || OPAQUE[id] === 1;
}

// sel=false: collision boxes, sel=true: selection (raycast) boxes.
// nb(dx,dz) returns a neighbour block id (only needed for fences).
export function getBoxes(id, meta, sel, nb) {
  switch (SHAPE[id]) {
    case SH.CUBE:
      return id === 0 ? NONE : FULL;
    case SH.CROSS:
      return sel ? (blocks[id].selBox ? [blocks[id].selBox] : CROSS_SEL) : NONE;
    case SH.CROP:
      return sel ? [[0, 0, 0, 1, 0.125 + (meta & 7) * 0.11, 1]] : NONE;
    case SH.FIRE:
      return NONE;
    case SH.TORCH:
      return sel ? TORCH_SEL[meta > 4 ? 0 : meta] : NONE;
    case SH.SLAB:
      return meta & 1 ? SLAB_TOP : SLAB_BOT;
    case SH.STAIRS:
      return STAIR_BOXES[meta & 7];
    case SH.FLUID:
      return NONE;
    case SH.CACTUS:
      return sel ? CACTUS_SEL : CACTUS_COL;
    case SH.FARMLAND:
      return FARM_BOX;
    case SH.DOOR:
      return DOOR_BOXES[doorBoxIndex(meta)];
    case SH.LADDER:
      return LADDER_BOXES[meta & 3];
    case SH.SNOW:
      return sel ? SNOW_SEL : NONE;
    case SH.FENCE: {
      const w = nb && fenceConnects(nb(-1, 0)), e = nb && fenceConnects(nb(1, 0));
      const n = nb && fenceConnects(nb(0, -1)), s = nb && fenceConnects(nb(0, 1));
      return [[w ? 0 : 0.375, 0, n ? 0 : 0.375, e ? 1 : 0.625, sel ? 1 : 1.5, s ? 1 : 0.625]];
    }
    case SH.CHEST:
      return CHEST_BOX;
    case SH.BED:
      return BED_BOX;
  }
  return FULL;
}
