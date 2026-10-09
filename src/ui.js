// DOM user interface: HUD, inventory & container screens, menus, chat and debug overlay.
import { B, blocks, SH, TEX } from './blocks.js';
import { items, I, CREATIVE, matchRecipe, maxStack, SMELT, fuelTime, itemName } from './items.js';
import { getTex, Img, mul } from './textures.js';
import { drawText, textWidth, glyphs } from './font.js';
import { BIOME_NAMES } from './worldgen.js';
import { mulberry32 } from './noise.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};
const GRASS_TINT = 0x7fb84a, LEAF_TINT = 0x5fa82e;

// ---- item icons ----------------------------------------------------------------------
class Icons {
  constructor() {
    this.urls = new Map();
    this.faces = new Map();
  }
  _face(name, shade, tint = 0xffffff) {
    const k = name + '|' + shade + '|' + tint;
    let c = this.faces.get(k);
    if (c) return c;
    const src = getTex(name), im = new Img();
    const tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;
    for (let i = 0; i < 1024; i += 4) {
      im.d[i] = src.d[i] * shade * tr; im.d[i + 1] = src.d[i + 1] * shade * tg; im.d[i + 2] = src.d[i + 2] * shade * tb; im.d[i + 3] = src.d[i + 3];
    }
    c = im.toCanvas();
    this.faces.set(k, c);
    return c;
  }
  _grassSide(shade) {
    const k = 'grass_side_full|' + shade;
    let c = this.faces.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.drawImage(this._face('grass_side', shade), 0, 0);
    g.drawImage(this._face('grass_side_overlay', shade, GRASS_TINT), 0, 0);
    this.faces.set(k, c);
    return c;
  }
  _block(id) {
    const d = blocks[id];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const p = 1 / 16;
    let boxes = [[0, 0, 0, 1, 1, 1]];
    switch (d.shape) {
      case SH.SLAB: boxes = [[0, 0, 0, 1, 0.5, 1]]; break;
      case SH.STAIRS: boxes = [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]]; break;
      case SH.FENCE: boxes = [[6 * p, 0, 0, 10 * p, 1, 4 * p], [7 * p, 12 * p, 4 * p, 9 * p, 15 * p, 12 * p], [7 * p, 6 * p, 4 * p, 9 * p, 9 * p, 12 * p], [6 * p, 0, 12 * p, 10 * p, 1, 1]]; break;
      case SH.CHEST: boxes = [[p, 0, p, 1 - p, 14 * p, 1 - p]]; break;
      case SH.CACTUS: boxes = [[p, 0, p, 1 - p, 1, 1 - p]]; break;
      case SH.SNOW: boxes = [[0, 0, 0, 1, 2 * p, 1]]; break;
    }
    const tint = d.tint === 2 ? LEAF_TINT : d.tint === 4 ? d.color : 0xffffff;
    const tex = (face, shade) => {
      if (id === B.GRASS) return face === 2 ? this._face('grass_top', shade, GRASS_TINT) : this._grassSide(shade);
      const layer = face === 4 && d.front >= 0 ? d.front : d.faces[face];
      return this._face(TEX[layer], shade, tint);
    };
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      // top (y = y1)
      g.setTransform(28 / 16, 14 / 16, -28 / 16, 14 / 16, 32, 4 + (1 - y1) * 30);
      g.drawImage(tex(2, 1), x0 * 16, z0 * 16, (x1 - x0) * 16, (z1 - z0) * 16, x0 * 16, z0 * 16, (x1 - x0) * 16, (z1 - z0) * 16);
      // south (z = z1)
      g.setTransform(28 / 16, 14 / 16, 0, 30 / 16, 32 - z1 * 28, 4 + z1 * 14);
      g.drawImage(tex(4, 0.8), x0 * 16, (1 - y1) * 16, (x1 - x0) * 16, (y1 - y0) * 16, x0 * 16, (1 - y1) * 16, (x1 - x0) * 16, (y1 - y0) * 16);
      // east (x = x1)
      g.setTransform(28 / 16, -14 / 16, 0, 30 / 16, 32 + (x1 - 1) * 28, 4 + (x1 + 1) * 14);
      g.drawImage(tex(0, 0.6), (1 - z1) * 16, (1 - y1) * 16, (z1 - z0) * 16, (y1 - y0) * 16, (1 - z1) * 16, (1 - y1) * 16, (z1 - z0) * 16, (y1 - y0) * 16);
    }
    return c;
  }
  canvas(id) {
    const it = items[id];
    if (!it) return null;
    if (it.icon) {
      const tint = id < 256 && blocks[id].tint === 1 ? GRASS_TINT : 0xffffff;
      return this._face(it.icon, 1, tint);
    }
    return this._block(id);
  }
  url(id) {
    let u = this.urls.get(id);
    if (u === undefined) {
      const c = this.canvas(id);
      u = c ? c.toDataURL() : '';
      this.urls.set(id, u);
    }
    return u;
  }
  isFlat(id) {
    return !!(items[id] && items[id].icon);
  }
}

const sprite = (rows, pal) => {
  const im = new Img(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => pal[ch] !== undefined && im.set(x, y, pal[ch])));
  return im.toCanvas();
};
const HEART = ['.KK.KK...', 'KRRKRRK..', 'KRHRRRK..', 'KRRRRRK..', '.KRRRK...', '..KRK....', '...K.....'].map((r) => r.slice(0, 7));
const HEART_HALF = HEART.map((r) => [...r].map((c, x) => (x > 3 && (c === 'R' || c === 'H') ? 'E' : c)).join(''));
const FOOD = ['...KKK.', '..KBBBK', '.KBbBBK', '.KBBBBK', 'KKBBBK.', 'KWKKK..', 'KWWK...', '.KK....'];
const ARMOR = ['KK.K.KK', 'KGKGKGK', 'KGGGGGK', 'KGgGGGK', '.KGGGK.', '.KGgGK.', '..KGK..', '...K...'];
const BUBBLE = ['..KKK..', '.KbbbK.', 'KbWbbbK', 'KbbbbbK', 'KbbbbbK', '.KbbbK.', '..KKK..'];

export class UI {
  constructor(game) {
    this.game = game;
    this.icons = new Icons();
    this.dirty = true;
    this.screen = null; // name of the open screen
    this.slots = [];
    this.cursor = null;
    this.craft = new Array(4).fill(null);
    this.craftW = 2;
    this.result = [null];
    this.be = null;
    this.hover = null;
    this.debug = false;
    this.hudHidden = false;
    this.chatLines = [];
    this.creativeScroll = 0;
    this.creativeList = CREATIVE;
    this.drag = null; // click-and-drag distribution in progress
    this.shiftDrag = null;
    this._lastClick = null;
    this.chatHistory = [];
    this.chatPos = 0;
    this.mouse = { x: 0, y: 0 };
    this.hud = document.getElementById('hud');
    this.screens = document.getElementById('screens');
    this.tooltip = document.getElementById('tooltip');
    this.cursorEl = document.getElementById('cursor-stack');
    this.tint = document.getElementById('overlay-tint');
    this._initTextures();
    this._buildHud();
    this._events();
    this.setScale();
    window.addEventListener('resize', () => this.setScale());
  }

  _initTextures() {
    const r = mulberry32(4711);
    const mk = (base, w = 16, h = 16) => {
      const im = new Img(w, h);
      im.each(() => mul(base, 0.9 + r() * 0.2));
      return im.toCanvas().toDataURL();
    };
    const root = document.documentElement.style;
    root.setProperty('--btn-tex', `url(${mk(0x707070)})`);
    root.setProperty('--btn-hover', `url(${mk(0x7884c8)})`);
    root.setProperty('--btn-off', `url(${mk(0x2c2c2c)})`);
    root.setProperty('--dirt-tex', `url(${getTex('dirt').toCanvas().toDataURL()})`);
    this.spr = {
      heart: sprite(HEART, { K: 0x000000, R: 0xe01818, H: 0xff9a9a }),
      heartHalf: sprite(HEART_HALF, { K: 0x000000, R: 0xe01818, H: 0xff9a9a, E: 0x3a3a3a }),
      heartEmpty: sprite(HEART, { K: 0x000000, R: 0x3a3a3a, H: 0x3a3a3a }),
      heartFlash: sprite(HEART, { K: 0xffffff, R: 0xe01818, H: 0xff9a9a }),
      food: sprite(FOOD, { K: 0x000000, B: 0xb5651d, b: 0xd8904a, W: 0xf0e8d8 }),
      foodHalf: sprite(FOOD.map((row) => [...row].map((c, x) => (x < 3 && (c === 'B' || c === 'b') ? 'E' : c)).join('')), { K: 0x000000, B: 0xb5651d, b: 0xd8904a, W: 0xf0e8d8, E: 0x3a2a1a }),
      foodEmpty: sprite(FOOD, { K: 0x000000, B: 0x3a2a1a, b: 0x3a2a1a, W: 0x4a4038 }),
      armor: sprite(ARMOR, { K: 0x000000, G: 0xc8c8c8, g: 0xffffff }),
      armorHalf: sprite(ARMOR.map((row) => [...row].map((c, x) => (x > 3 && (c === 'G' || c === 'g') ? 'E' : c)).join('')), { K: 0x000000, G: 0xc8c8c8, g: 0xffffff, E: 0x3a3a3a }),
      armorEmpty: sprite(ARMOR, { K: 0x000000, G: 0x3a3a3a, g: 0x3a3a3a }),
      bubble: sprite(BUBBLE, { K: 0x1a3a8a, b: 0x5a9af0, W: 0xffffff }),
    };
  }

  setScale() {
    const s = this.game.settings.guiScale;
    let gs = 1;
    while (gs < 6 && window.innerWidth / (gs + 1) >= 320 && window.innerHeight / (gs + 1) >= 240) gs++;
    if (s > 0) gs = Math.min(gs, s);
    this.gs = gs;
    document.documentElement.style.setProperty('--gs', gs);
  }

  // ---- HUD ---------------------------------------------------------------------------
  _buildHud() {
    const h = this.hud;
    el('div', 'crosshair', h);
    const wrap = (this.hotWrap = el('div', 'hotwrap', h));
    this.bars = el('canvas', 'bars px', wrap);
    this.bars.width = 182; this.bars.height = 32;
    const hb = (this.hotbar = el('div', 'hotbar', wrap));
    const bg = document.createElement('canvas');
    bg.width = 182; bg.height = 22;
    const g = bg.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(0, 0, 182, 22);
    for (let i = 0; i < 9; i++) {
      g.clearRect(1 + i * 20, 1, 20, 20);
      g.fillStyle = 'rgba(120,120,120,0.75)'; g.fillRect(1 + i * 20, 1, 20, 20);
      g.clearRect(2 + i * 20, 2, 18, 18);
      g.fillStyle = 'rgba(20,20,20,0.5)'; g.fillRect(2 + i * 20, 2, 18, 18);
    }
    hb.style.backgroundImage = `url(${bg.toDataURL()})`;
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = this._slotEl(hb, 'hslot');
      s.style.left = `calc(${2 + i * 20}px * var(--gs))`;
      this.hotSlots.push(s);
    }
    this.selector = el('div', 'selector', hb);
    this.itemName = el('div', 'itemname txt', h);
    this.chatLog = el('div', 'chatlog txt', h);
    this.debugEl = el('pre', 'debug txt', h);
    this.chatInput = el('input', 'chatinput txt', document.body);
    this.chatInput.type = 'text';
    this.chatInput.maxLength = 100;
    this.chatInput.spellcheck = false;
    this.chatInput.autocomplete = 'off';
  }
  _slotEl(parent, cls = 'slot') {
    const s = el('div', cls, parent);
    s._icon = el('div', 'icon', s);
    s._dur = el('div', 'dur', s);
    s._durIn = el('div', '', s._dur);
    s._count = el('div', 'count txt', s);
    return s;
  }
  _renderSlot(s, st) {
    if (s._id === (st ? st.id : 0) && s._n === (st ? st.count : 0) && s._d === (st ? st.dmg || 0 : 0)) return;
    s._id = st ? st.id : 0; s._n = st ? st.count : 0; s._d = st ? st.dmg || 0 : 0;
    if (!st) {
      s._icon.style.backgroundImage = '';
      s._count.textContent = '';
      s._dur.style.display = 'none';
      return;
    }
    s._icon.style.backgroundImage = `url(${this.icons.url(st.id)})`;
    s._icon.classList.toggle('flat', this.icons.isFlat(st.id));
    s._count.textContent = st.count > 1 ? st.count : '';
    const d = items[st.id];
    if (d && d.dur && st.dmg > 0) {
      const f = 1 - st.dmg / d.dur;
      s._dur.style.display = 'block';
      s._durIn.style.width = Math.round(f * 100) + '%';
      s._durIn.style.background = `hsl(${Math.round(f * 120)},100%,50%)`;
    } else s._dur.style.display = 'none';
  }
  onSelect() {
    this.dirty = true;
    const s = this.game.player.held();
    this.itemName.textContent = s ? itemName(s.id) : '';
    this.itemName.classList.remove('fadeout');
    void this.itemName.offsetWidth;
    this.itemName.classList.add('fadeout');
  }
  _drawBars() {
    const p = this.game.player, g = this.bars.getContext('2d'), S = this.spr;
    g.clearRect(0, 0, 182, 32);
    if (p.creative) return;
    const hp = Math.ceil(p.health), flash = p.hurtTime > 0 && ((p.hurtTime / 3) | 0) % 2 === 1;
    for (let i = 0; i < 10; i++) {
      let y = 12;
      if (hp <= 4) y += ((this.game.frame + i * 3) >> 2) % 2 ? 1 : 0;
      const x = i * 8;
      g.drawImage(hp >= i * 2 + 2 ? (flash ? S.heartFlash : S.heart) : hp === i * 2 + 1 ? S.heartHalf : S.heartEmpty, x, y + 1);
    }
    const fd = p.food;
    for (let i = 0; i < 10; i++) {
      const x = 182 - 8 - i * 8;
      let y = 12;
      if (p.saturation <= 0 && this.game.frame % (fd * 3 + 4) === i) y += 1;
      g.drawImage(fd >= i * 2 + 2 ? S.food : fd === i * 2 + 1 ? S.foodHalf : S.foodEmpty, x, y);
    }
    const ar = p.inv.armorPoints();
    if (ar > 0) for (let i = 0; i < 10; i++) g.drawImage(ar >= i * 2 + 2 ? S.armor : ar === i * 2 + 1 ? S.armorHalf : S.armorEmpty, i * 8, 2);
    if (p.air < 300) {
      const n = Math.ceil(((p.air - 2) * 10) / 300);
      for (let i = 0; i < n; i++) g.drawImage(S.bubble, 182 - 8 - i * 8, 3);
    }
    // xp bar
    g.fillStyle = '#000'; g.fillRect(0, 24, 182, 5);
    g.fillStyle = '#2c3a14'; g.fillRect(1, 25, 180, 3);
    g.fillStyle = '#80ff20'; g.fillRect(1, 25, Math.round(180 * p.xpProgress), 3);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 1; i < 18; i++) g.fillRect(i * 10 + 1, 25, 1, 3);
    if (p.xpLevel > 0) {
      const t = String(p.xpLevel), w = textWidth(t), x = Math.round(91 - w / 2);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawText(g, t, x + ox, 15 + oy, 1, '#000');
      drawText(g, t, x, 15, 1, '#80ff20');
    }
  }
  refresh() {
    const g = this.game, p = g.player;
    if (!p) return;
    this.dirty = false;
    for (let i = 0; i < 9; i++) this._renderSlot(this.hotSlots[i], p.inv.slots[i]);
    this.selector.style.left = `calc(${-1 + p.inv.selected * 20}px * var(--gs))`;
    this._drawBars();
    if (this.screen && this.slots.length) this._renderContainer();
  }
  // called every frame
  update() {
    const g = this.game, p = g.player;
    if (!p) return;
    if (this.dirty || p.hurtTime > 0 || p.health <= 4 || this.screen === 'furnace') this.refresh();
    if (this.debug) this._debugText();
    // chat fade
    const now = performance.now();
    for (const l of this.chatLines) {
      const age = now - l.t;
      l.el.style.opacity = this.screen === 'chat' ? 1 : age > 10000 ? 0 : age > 9000 ? (10000 - age) / 1000 : 1;
    }
    // screen tints
    let tint = '';
    if (p.hurtTime > 0 && p.alive) tint = `rgba(255,0,0,${(p.hurtTime / 10) * 0.28})`;
    else if (g.eyeFluid === 1) tint = 'rgba(20,60,200,0.22)';
    else if (g.eyeFluid === 2) tint = 'rgba(255,90,0,0.55)';
    else if (p.fire > 0) tint = 'rgba(255,120,0,0.18)';
    if (this._fade !== undefined) tint = `rgba(0,0,0,${this._fade})`;
    if (tint !== this._tint) { this._tint = tint; this.tint.style.background = tint || 'transparent'; }
    if (this._fadeDir) {
      this._fade = Math.max(0, Math.min(1, (this._fade || 0) + this._fadeDir * 0.03));
      if (this._fade === 0 && this._fadeDir < 0) { this._fade = undefined; this._fadeDir = 0; }
    }
  }
  fade(on) {
    this._fadeDir = on ? 1 : -1;
    if (on && this._fade === undefined) this._fade = 0;
  }
  showHud(v) {
    this.hud.classList.toggle('hidden', !v || this.hudHidden);
  }
  _debugText() {
    const g = this.game, p = g.player, w = g.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const raw = w.getLightRaw(bx, by, bz);
    const dirs = ['south (+Z)', 'west (-X)', 'north (-Z)', 'east (+X)'];
    const t = g.target;
    const lines = [
      `FableCraft 1.0 (${g.fps} fps, ${g.renderer.drawn} chunks drawn)`,
      `Chunks: ${w.chunks.size} loaded, ${w.pending.size} pending   Entities: ${g.entities.list.length}   Particles: ${g.particles.list.length}`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(3)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}   Chunk: ${bx >> 4} ${bz >> 4}`,
      `Facing: ${dirs[p.facing()]}  (${((((p.yaw * 180) / Math.PI) % 360) + 360) % 360 | 0} / ${((p.pitch * 180) / Math.PI) | 0})`,
      `Light: ${w.getLight(bx, by, bz)} (${raw >> 4} sky, ${raw & 15} block)`,
      `Biome: ${BIOME_NAMES[w.gen.biomeAt(bx, bz)]}`,
      `Time: day ${Math.floor(w.time / 24000) + 1}, ${String((Math.floor(w.dayTime / 1000) + 6) % 24).padStart(2, '0')}:${String(Math.floor(((w.dayTime % 1000) / 1000) * 60)).padStart(2, '0')}`,
      `Seed: ${w.seed}   Mode: ${p.mode}${p.flying ? ' (flying)' : ''}`,
      t ? (t.entity ? `Target: ${t.entity.type} (${t.entity.health}/${t.entity.maxHealth})` : `Target: ${blocks[t.id].name} [${t.id}:${t.meta}] at ${t.x} ${t.y} ${t.z}`) : '',
    ];
    this.debugEl.textContent = lines.join('\n');
  }

  // ---- chat ------------------------------------------------------------------------------
  chat(msg, color) {
    const line = el('div', 'chatline', this.chatLog, msg);
    if (color) line.style.color = color;
    this.chatLines.push({ el: line, t: performance.now() });
    while (this.chatLines.length > 40) this.chatLines.shift().el.remove();
    this.chatLog.scrollTop = 1e6;
  }
  openChat(prefix = '') {
    this.screen = 'chat';
    this.game.releasePointer();
    this.chatInput.style.display = 'block';
    this.chatInput.value = prefix;
    this.chatPos = this.chatHistory.length;
    setTimeout(() => this.chatInput.focus(), 0);
  }

  // ---- generic screen plumbing ---------------------------------------------------------
  _clear() {
    this.screens.innerHTML = '';
    this.screens.className = '';
    this.slots = [];
    this.hover = null;
    this.drag = null;
    this.shiftDrag = null;
    this.tooltip.style.display = 'none';
    this.chatInput.style.display = 'none';
    this.chatInput.blur();
  }
  _menu(cls = '') {
    this._clear();
    this.screens.className = 'active ' + cls;
    return el('div', 'menu', this.screens);
  }
  _button(parent, label, fn, cls = '') {
    const b = el('div', 'btn txt ' + cls, parent, label);
    b.addEventListener('click', () => {
      if (b.classList.contains('disabled')) return;
      this.game.audio.init();
      this.game.audio.ui('click');
      fn(b);
    });
    return b;
  }
  _slider(parent, label, min, max, step, get, set, fmt) {
    const s = el('div', 'btn slider txt', parent);
    const knob = el('div', 'knob', s);
    const txt = el('div', 'slabel', s);
    const show = () => {
      const v = get();
      knob.style.left = `calc(${((v - min) / (max - min)) * 100}% - ${((v - min) / (max - min)) * 8}px * var(--gs))`;
      txt.textContent = `${label}: ${fmt ? fmt(v) : v}`;
    };
    const at = (e) => {
      const r = s.getBoundingClientRect();
      let v = min + Math.max(0, Math.min(1, (e.clientX - r.left - 4 * this.gs) / (r.width - 8 * this.gs))) * (max - min);
      v = Math.round(v / step) * step;
      set(+v.toFixed(4));
      show();
    };
    s.addEventListener('pointerdown', (e) => {
      s.setPointerCapture(e.pointerId);
      at(e);
      const mv = (ev) => at(ev);
      const up = () => { s.removeEventListener('pointermove', mv); s.removeEventListener('pointerup', up); this.game.audio.ui('click'); this.game.saveSettings(); };
      s.addEventListener('pointermove', mv);
      s.addEventListener('pointerup', up);
    });
    show();
    return s;
  }

  // ---- menus -------------------------------------------------------------------------------
  showTitle() {
    this.screen = 'title';
    const m = this._menu('title');
    const logo = el('canvas', 'logo px', m);
    this._drawLogo(logo);
    const sp = el('div', 'splash txt', m, this._splash());
    sp.style.animationDelay = '0s';
    const col = el('div', 'col', m);
    this._button(col, 'Singleplayer', () => this.showWorlds());
    this._button(col, 'Options...', () => this.showOptions(() => this.showTitle()));
    this._button(col, 'Controls', () => this.showControls(() => this.showTitle()));
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) {
      el('div', 'label txt', m, 'Needs a keyboard and mouse');
    }
    el('div', 'foot left txt', m, 'FableCraft 1.0');
    el('div', 'foot right txt', m, 'Every pixel & sound generated in code');
  }
  _splash() {
    const s = ['Made with Fable!', 'No assets required!', '100% procedural!', 'Punch a tree!', 'Now in your browser!', 'Watch out for creepers!', 'Sheep go baa!', 'Dig straight down! (don\'t)', 'Blocks all the way down!', 'Hand-painted by math!', 'Also try real life!'];
    return s[(Math.random() * s.length) | 0];
  }
  _drawLogo(c) {
    const text = 'FABLECRAFT', px = 8, ex = 5;
    const cols = textWidth(text), rows = 7;
    const grid = [];
    for (let y = 0; y < rows; y++) grid.push(new Array(cols).fill(false));
    let cx = 0;
    for (const ch of text) {
      const gl = glyphs[ch];
      gl.rows.forEach((row, y) => row.forEach((on, x) => { if (on) grid[y][cx + x] = true; }));
      cx += gl.w + 1;
    }
    const on = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && grid[y][x];
    const w = cols * px + 4, h = rows * px + ex + 4;
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const r = mulberry32(77);
    // outline + extruded underside
    g.fillStyle = '#000';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (on(x, y)) g.fillRect(x * px, y * px, px + 4, px + ex + 4);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!on(x, y)) continue;
      for (let k = 0; k < ex; k++) { g.fillStyle = k < 2 ? '#3c3c3c' : '#2b2b2b'; g.fillRect(x * px + 2, y * px + 2 + px + k - 0, px, 1); }
    }
    // stone faces with bevels
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!on(x, y)) continue;
      for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
        let v = 128 + ((r() * 26) | 0) - (((i >> 1) + (j >> 1) + x) % 3 === 0 ? 12 : 0);
        if (j === 0 && !on(x, y - 1)) v += 58;
        else if (i === 0 && !on(x - 1, y)) v += 34;
        else if (j === px - 1 && !on(x, y + 1)) v -= 42;
        else if (i === px - 1 && !on(x + 1, y)) v -= 30;
        g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 3)})`;
        g.fillRect(x * px + 2 + i, y * px + 2 + j, 1, 1);
      }
    }
    c.style.width = `calc(${w}px * var(--gs) / 2)`;
    c.style.height = `calc(${h}px * var(--gs) / 2)`;
  }
  showControls(back) {
    this.screen = 'controls';
    const m = this._menu('dirt');
    el('div', 'heading txt', m, 'Controls');
    const box = el('div', 'controls txt', m);
    const rows = [
      ['W A S D', 'Move'], ['Space', 'Jump / swim up (double-tap: fly in creative)'], ['Left Shift', 'Sneak / descend'],
      ['Double-tap W / R / Ctrl', 'Sprint'], ['Mouse', 'Look around'], ['Left click', 'Mine / attack'],
      ['Right click', 'Place / use / eat'], ['Middle click', 'Pick block'], ['1-9 / Scroll', 'Select hotbar slot'],
      ['E', 'Inventory'], ['Q', 'Drop item'], ['Arrow keys', 'Turn the camera'], ['T  or  /', 'Chat / commands'], ['F1', 'Hide HUD'], ['F3', 'Debug info'],
      ['F5', 'Change camera'], ['F', 'Fullscreen'], ['Esc', 'Pause menu'],
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'crow', box);
      el('span', 'ckey', r, k);
      el('span', '', r, v);
    }
    this._button(el('div', 'col', m), 'Done', back);
  }
  showOptions(back) {
    this.screen = 'options';
    const g = this.game, s = g.settings;
    const m = this._menu(g.world && g.inWorld ? 'dim' : 'dirt');
    el('div', 'heading txt', m, 'Options');
    const grid = el('div', 'grid', m);
    const onoff = (v) => (v ? 'ON' : 'OFF');
    this._slider(grid, 'FOV', 30, 110, 1, () => s.fov, (v) => (s.fov = v), (v) => (v === 70 ? 'Normal' : v === 110 ? 'Quake Pro' : v));
    this._slider(grid, 'Render Distance', 2, 16, 1, () => s.renderDist, (v) => { s.renderDist = v; g.applySettings(); }, (v) => v + ' chunks');
    this._slider(grid, 'Sensitivity', 0.1, 2, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v), (v) => Math.round(v * 100) + '%');
    this._slider(grid, 'Brightness', 0, 1, 0.05, () => s.gamma, (v) => { s.gamma = v; g.applySettings(); }, (v) => (v === 0 ? 'Moody' : v === 1 ? 'Bright' : '+' + Math.round(v * 100) + '%'));
    this._slider(grid, 'Master Volume', 0, 1, 0.05, () => s.master, (v) => { s.master = v; g.applySettings(); }, (v) => (v === 0 ? 'OFF' : Math.round(v * 100) + '%'));
    this._slider(grid, 'Music', 0, 1, 0.05, () => s.music, (v) => { s.music = v; g.applySettings(); }, (v) => (v === 0 ? 'OFF' : Math.round(v * 100) + '%'));
    this._slider(grid, 'Sounds', 0, 1, 0.05, () => s.sfx, (v) => { s.sfx = v; g.applySettings(); }, (v) => (v === 0 ? 'OFF' : Math.round(v * 100) + '%'));
    const DIFF = ['Peaceful', 'Easy', 'Normal', 'Hard'];
    this._button(grid, 'Difficulty: ' + DIFF[s.difficulty], (b) => { s.difficulty = (s.difficulty + 1) % 4; b.textContent = 'Difficulty: ' + DIFF[s.difficulty]; g.applySettings(); g.saveSettings(); });
    this._button(grid, 'Clouds: ' + onoff(s.clouds), (b) => { s.clouds = !s.clouds; b.textContent = 'Clouds: ' + onoff(s.clouds); g.applySettings(); g.saveSettings(); });
    this._button(grid, 'View Bobbing: ' + onoff(s.bobbing), (b) => { s.bobbing = !s.bobbing; b.textContent = 'View Bobbing: ' + onoff(s.bobbing); g.saveSettings(); });
    const GS = ['Auto', 'Small', 'Normal', 'Large', 'Huge'];
    this._button(grid, 'GUI Scale: ' + GS[s.guiScale], (b) => { s.guiScale = (s.guiScale + 1) % 5; b.textContent = 'GUI Scale: ' + GS[s.guiScale]; this.setScale(); g.saveSettings(); });
    this._button(grid, 'Controls...', () => this.showControls(() => this.showOptions(back)));
    this._button(el('div', 'col', m), 'Done', back);
  }
  async showWorlds() {
    this.screen = 'worlds';
    const g = this.game;
    const m = this._menu('dirt');
    el('div', 'heading txt', m, 'Select World');
    const list = el('div', 'worldlist', m);
    const worlds = (await g.save.listWorlds()).sort((a, b) => b.lastPlayed - a.lastPlayed);
    if (this.screen !== 'worlds') return;
    let sel = null;
    const row = el('div', 'row', m), row2 = el('div', 'row', m);
    const play = this._button(row, 'Play Selected World', () => sel && g.startWorld(sel), 'half disabled');
    this._button(row, 'Create New World', () => this.showCreate(worlds.length), 'half');
    const del = this._button(row2, 'Delete', async () => {
      if (!sel) return;
      if (!del._sure) { del._sure = true; del.textContent = 'Really delete?'; return; }
      await g.save.deleteWorld(sel.id);
      this.showWorlds();
    }, 'half disabled');
    this._button(row2, 'Cancel', () => this.showTitle(), 'half');
    if (!worlds.length) el('div', 'empty txt', list, 'No worlds yet - create one!');
    for (const w of worlds) {
      const e = el('div', 'world txt', list);
      el('div', 'wname', e, w.name);
      el('div', 'wsub', e, `${new Date(w.lastPlayed).toLocaleString()}`);
      el('div', 'wsub', e, `${w.mode === 'creative' ? 'Creative' : 'Survival'} Mode, Seed: ${w.seed}`);
      e.addEventListener('click', () => {
        for (const c of list.children) c.classList.remove('sel');
        e.classList.add('sel');
        sel = w;
        play.classList.remove('disabled'); del.classList.remove('disabled');
        del._sure = false; del.textContent = 'Delete';
        g.audio.ui('click');
      });
      e.addEventListener('dblclick', () => g.startWorld(w));
    }
  }
  showCreate(n) {
    this.screen = 'create';
    const g = this.game;
    const m = this._menu('dirt');
    el('div', 'heading txt', m, 'Create New World');
    const col = el('div', 'col', m);
    el('div', 'label txt', col, 'World Name');
    const name = el('input', 'field txt', col);
    name.value = 'New World' + (n ? ' ' + (n + 1) : '');
    name.maxLength = 32;
    el('div', 'label txt', col, 'Seed for the World Generator');
    const seed = el('input', 'field txt', col);
    seed.placeholder = '';
    seed.maxLength = 32;
    el('div', 'hint txt', col, 'Leave blank for a random seed');
    let mode = 'survival';
    this._button(col, 'Game Mode: Survival', (b) => { mode = mode === 'survival' ? 'creative' : 'survival'; b.textContent = 'Game Mode: ' + (mode === 'survival' ? 'Survival' : 'Creative'); });
    const row = el('div', 'row', m);
    this._button(row, 'Create New World', () => {
      let sd = seed.value.trim();
      let sv;
      if (sd === '') sv = (Math.random() * 4294967296) | 0;
      else if (/^-?\d+$/.test(sd)) sv = parseInt(sd, 10) | 0;
      else { sv = 0; for (const ch of sd) sv = (Math.imul(sv, 31) + ch.charCodeAt(0)) | 0; }
      g.startWorld({ id: 'w' + Date.now().toString(36), name: name.value.trim() || 'New World', seed: sv, mode, created: Date.now(), lastPlayed: Date.now(), fresh: true });
    }, 'half');
    this._button(row, 'Cancel', () => this.showWorlds(), 'half');
    for (const f of [name, seed]) f.addEventListener('keydown', (e) => e.stopPropagation());
    setTimeout(() => name.select(), 0);
  }
  showLoading(text) {
    this.screen = 'loading';
    const m = this._menu('dirt');
    el('div', 'heading txt mid', m, text);
    this.loadSub = el('div', 'label txt', m, 'Building terrain');
    const bar = el('div', 'progress', m);
    this.loadBar = el('div', '', bar);
  }
  setProgress(f) {
    if (this.loadBar) this.loadBar.style.width = Math.round(f * 100) + '%';
  }
  showPause() {
    this.screen = 'pause';
    const g = this.game;
    const m = this._menu('dim');
    el('div', 'heading txt', m, 'Game Menu');
    const col = el('div', 'col', m);
    this._button(col, 'Back to Game', () => this.close());
    this._button(col, 'Options...', () => this.showOptions(() => this.showPause()));
    this._button(col, 'Save and Quit to Title', () => g.quitToTitle());
  }
  showDeath(msg) {
    this.screen = 'death';
    this.game.releasePointer();
    const m = this._menu('death');
    el('div', 'heading big txt', m, 'You died!');
    el('div', 'label txt', m, msg);
    el('div', 'label txt', m, `Score: ${this.game.player.xpTotal}`).style.color = '#ffff55';
    const col = el('div', 'col', m);
    this._button(col, 'Respawn', () => { this.game.player.respawn(); this.close(); });
    this._button(col, 'Title Screen', () => { this.game.player.respawn(); this.game.quitToTitle(); });
  }
  // close whatever is open and return to the game
  close() {
    if (!this.screen) return;
    const g = this.game;
    if (this.slots.length) this._closeContainer();
    this._clear();
    this.screen = null;
    this.cursorEl.style.display = 'none';
    if (g.inWorld) g.lockPointer();
    this.dirty = true;
  }

  // ---- containers ----------------------------------------------------------------------
  openContainer(kind, be = null) {
    const g = this.game, p = g.player, inv = p.inv;
    if (kind === 'inventory' && p.creative) kind = 'creative';
    this._clear();
    this.screen = kind;
    this.be = be;
    this.screens.className = 'active dim';
    g.releasePointer();
    const H = kind === 'creative' ? 208 : kind === 'chest' ? 168 : 166;
    const panel = (this.panel = el('div', 'panel', this.screens));
    panel.style.width = 'calc(176px * var(--gs))';
    panel.style.height = `calc(${H}px * var(--gs))`;
    const label = (t, x, y) => { const l = el('div', 'ptitle txt', panel, t); l.style.left = `calc(${x}px * var(--gs))`; l.style.top = `calc(${y}px * var(--gs))`; return l; };
    const add = (arr, idx, x, y, type) => {
      const e = this._slotEl(panel);
      e.style.left = `calc(${x - 1}px * var(--gs))`;
      e.style.top = `calc(${y - 1}px * var(--gs))`;
      const s = { arr, idx, type, el: e };
      e._slot = s;
      this.slots.push(s);
      return s;
    };
    const invY = H - 82;
    this.craftW = 0;
    if (kind === 'inventory') {
      this.craftW = 2; this.craft = new Array(4).fill(null);
      for (let i = 0; i < 4; i++) add(inv.armor, i, 8, 8 + i * 18, 'armor');
      const pv = el('canvas', 'preview px', panel);
      this._drawPreview(pv);
      label('Crafting', 88, 16);
      for (let i = 0; i < 4; i++) add(this.craft, i, 88 + (i % 2) * 18, 26 + ((i / 2) | 0) * 18, 'craft');
      el('div', 'arrow', panel).style.cssText = 'left:calc(125px * var(--gs));top:calc(37px * var(--gs))';
      add(this.result, 0, 144, 36, 'result');
    } else if (kind === 'crafting') {
      this.craftW = 3; this.craft = new Array(9).fill(null);
      label('Crafting', 28, 6);
      for (let i = 0; i < 9; i++) add(this.craft, i, 30 + (i % 3) * 18, 17 + ((i / 3) | 0) * 18, 'craft');
      el('div', 'arrow', panel).style.cssText = 'left:calc(90px * var(--gs));top:calc(35px * var(--gs))';
      add(this.result, 0, 124, 35, 'result');
    } else if (kind === 'furnace') {
      label('Furnace', 70, 6);
      add(be.items, 0, 56, 17, 'smelt');
      add(be.items, 1, 56, 53, 'fuel');
      add(be.items, 2, 116, 35, 'output');
      this.flame = el('div', 'flame', panel);
      this.flameIn = el('div', '', this.flame);
      this.prog = el('div', 'arrow', panel);
      this.prog.style.cssText = 'left:calc(79px * var(--gs));top:calc(35px * var(--gs))';
      this.progIn = el('div', 'arrowfill', this.prog);
    } else if (kind === 'chest') {
      label('Chest', 8, 6);
      for (let i = 0; i < 27; i++) add(be.items, i, 8 + (i % 9) * 18, 18 + ((i / 9) | 0) * 18, 'chest');
    } else if (kind === 'creative') {
      label('Creative Inventory', 8, 6);
      this.creativeScroll = 0;
      this.creativeList = CREATIVE;
      const search = el('input', 'csearch txt', panel);
      search.id = 'creative-search';
      search.type = 'text'; search.placeholder = 'Search...'; search.maxLength = 24; search.spellcheck = false; search.autocomplete = 'off';
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        this.creativeList = q ? CREATIVE.filter((id) => itemName(id).toLowerCase().includes(q)) : CREATIVE;
        this.creativeScroll = 0;
        this._renderContainer();
      });
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { search.blur(); this.close(); } else if (e.key === 'Enter') search.blur();
      });
      search.addEventListener('mousedown', (e) => e.stopPropagation());
      for (let i = 0; i < 45; i++) add(null, i, 8 + (i % 9) * 18, 18 + ((i / 9) | 0) * 18, 'creative');
      const tr = add([null], 0, 152, 110, 'trash');
      tr.el.classList.add('trash');
      label('Scroll for more', 8, 114).style.color = '#606060';
      panel.addEventListener('wheel', (e) => {
        const rows = Math.ceil(this.creativeList.length / 9);
        this.creativeScroll = Math.max(0, Math.min(Math.max(0, rows - 5), this.creativeScroll + Math.sign(e.deltaY)));
        this._renderContainer();
        e.preventDefault();
      }, { passive: false });
    }
    if (kind !== 'creative' && kind !== 'inventory') label('Inventory', 8, invY - 11);
    for (let i = 0; i < 27; i++) add(inv.slots, 9 + i, 8 + (i % 9) * 18, invY + ((i / 9) | 0) * 18, 'inv');
    for (let i = 0; i < 9; i++) add(inv.slots, i, 8 + i * 18, invY + 58, 'inv');
    this.result[0] = null;
    this._renderContainer();
  }
  _drawPreview(c) {
    c.width = 16; c.height = 32;
    const g = c.getContext('2d');
    const P = { skin: '#c8946c', hair: '#3d2a16', shirt: '#1fa8b8', pants: '#3c3ca8', shoes: '#555', eye: '#fff', iris: '#5a3ab0' };
    const r = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    r(P.skin, 4, 0, 8, 8); r(P.hair, 4, 0, 8, 2); r(P.hair, 4, 2, 1, 1); r(P.hair, 11, 2, 1, 1);
    r(P.eye, 5, 4, 1, 1); r(P.iris, 6, 4, 1, 1); r(P.iris, 9, 4, 1, 1); r(P.eye, 10, 4, 1, 1); r('#7a4a32', 6, 6, 4, 1);
    r(P.shirt, 4, 8, 8, 12); r(P.shirt, 0, 8, 4, 4); r(P.shirt, 12, 8, 4, 4); r(P.skin, 0, 12, 4, 8); r(P.skin, 12, 12, 4, 8);
    r(P.pants, 4, 20, 8, 10); r('#2c2c88', 7, 20, 2, 10); r(P.shoes, 4, 30, 8, 2);
  }
  _stackAt(s) {
    if (s.type === 'creative') {
      const id = this.creativeList[this.creativeScroll * 9 + s.idx];
      return id !== undefined ? { id, count: 1, dmg: 0 } : null;
    }
    return s.arr[s.idx];
  }
  _renderContainer() {
    for (const s of this.slots) this._renderSlot(s.el, this._stackAt(s));
    if (this.screen === 'furnace' && this.be) {
      const be = this.be;
      this.flameIn.style.height = be.burn > 0 ? Math.round((be.burn / Math.max(1, be.burnMax)) * 100) + '%' : '0%';
      this.progIn.style.width = Math.round((be.cook / 200) * 100) + '%';
    }
    this._renderCursor();
    this._tooltip();
  }
  _renderCursor() {
    const c = this.cursorEl;
    if (!this.cursor) { c.style.display = 'none'; return; }
    c.style.display = 'block';
    if (!c._icon) { c._icon = el('div', 'icon', c); c._dur = el('div', 'dur', c); c._durIn = el('div', '', c._dur); c._count = el('div', 'count txt', c); }
    c._id = -1;
    this._renderSlot(c, this.cursor);
    c.style.left = this.mouse.x + 'px';
    c.style.top = this.mouse.y + 'px';
  }
  _tooltip() {
    const t = this.tooltip, s = this.hover;
    const st = s && !this.cursor && !this.drag ? this._stackAt(s) : null;
    if (!st) { t.style.display = 'none'; return; }
    const d = items[st.id];
    let html = `<div>${itemName(st.id)}</div>`;
    if (d.tool && d.dmg) html += `<div class="sub">+${d.dmg} Attack Damage</div>`;
    if (d.armor) html += `<div class="sub">+${d.armor.pts} Armor</div>`;
    if (d.food) html += `<div class="sub">Restores ${d.food.hunger / 2} hunger</div>`;
    if (d.dur && st.dmg) html += `<div class="sub">Durability: ${d.dur - st.dmg} / ${d.dur}</div>`;
    t.innerHTML = html;
    t.style.display = 'block';
    t.style.left = this.mouse.x + 12 * this.gs / 2 + 'px';
    t.style.top = this.mouse.y - 12 * this.gs / 2 + 'px';
  }
  _updateResult() {
    if (!this.craftW) return;
    const r = matchRecipe(this.craft.map((s) => (s ? s.id : 0)), this.craftW);
    this.result[0] = r ? { id: r.id, count: r.count, dmg: 0 } : null;
  }
  _consumeCraft() {
    for (let i = 0; i < this.craft.length; i++) {
      const s = this.craft[i];
      if (s && --s.count <= 0) this.craft[i] = null;
    }
    this._updateResult();
  }
  _accepts(s, st) {
    switch (s.type) {
      case 'result': case 'output': case 'creative': return false;
      case 'armor': return !!(items[st.id].armor && items[st.id].armor.slot === s.idx);
      case 'fuel': return fuelTime(st.id) > 0;
      default: return true;
    }
  }
  // merge a stack into a list of slots; returns leftover count
  _merge(list, st) {
    let left = st.count;
    const max = maxStack(st.id);
    if (max > 1 && !st.dmg) {
      for (const s of list) {
        const t = s.arr[s.idx];
        if (left > 0 && t && t.id === st.id && !t.dmg && t.count < max && this._accepts(s, st)) {
          const n = Math.min(left, max - t.count);
          t.count += n; left -= n;
        }
      }
    }
    for (const s of list) {
      if (left > 0 && !s.arr[s.idx] && this._accepts(s, st)) {
        const n = Math.min(left, s.type === 'armor' ? 1 : max);
        s.arr[s.idx] = { id: st.id, count: n, dmg: st.dmg || 0 };
        left -= n;
      }
    }
    return left;
  }
  _click(s, button, shift) {
    const g = this.game, p = g.player;
    const cur = this.cursor;
    const st = this._stackAt(s);
    if (s.type === 'creative') {
      if (cur && (!st || button === 0) && !(st && cur.id === st.id)) this.cursor = null;
      else if (st) {
        const max = maxStack(st.id);
        if (shift) p.inv.add({ id: st.id, count: max });
        else if (cur && cur.id === st.id) cur.count = Math.min(max, cur.count + 1);
        else this.cursor = { id: st.id, count: button === 2 ? 1 : max, dmg: 0 };
      }
    } else if (s.type === 'trash') {
      this.cursor = null;
      if (shift) for (let i = 0; i < 36; i++) p.inv.slots[i] = null;
    } else if (s.type === 'result') {
      if (!st) return;
      if (shift) {
        const id = st.id;
        for (let n = 0; n < 64 && this.result[0] && this.result[0].id === id; n++) {
          if (p.inv.add(this.result[0]) > 0) break;
          this._consumeCraft();
        }
      } else if (!cur) { this.cursor = st; this.result[0] = null; this._consumeCraft(); }
      else if (cur.id === st.id && !cur.dmg && cur.count + st.count <= maxStack(st.id)) { cur.count += st.count; this._consumeCraft(); }
      g.audio.ui('pop');
    } else if (shift) {
      if (!st) return;
      const inInv = s.type === 'inv';
      let targets;
      if (!inInv) targets = [...this.slots.filter((t) => t.type === 'inv' && t.idx >= 9), ...this.slots.filter((t) => t.type === 'inv' && t.idx < 9)];
      else if (this.screen === 'chest') targets = this.slots.filter((t) => t.type === 'chest');
      else if (this.screen === 'furnace' && (SMELT.has(st.id) || fuelTime(st.id) > 0)) targets = this.slots.filter((t) => (t.type === 'smelt' && SMELT.has(st.id)) || (t.type === 'fuel' && fuelTime(st.id) > 0));
      else {
        targets = [];
        if (items[st.id].armor) targets.push(...this.slots.filter((t) => t.type === 'armor'));
        targets.push(...this.slots.filter((t) => t.type === 'inv' && (s.idx < 9 ? t.idx >= 9 : t.idx < 9)));
      }
      const left = this._merge(targets, st);
      if (left <= 0) s.arr[s.idx] = null;
      else st.count = left;
      if (s.type === 'output') this._takeXp();
    } else if (button === 0) {
      if (!cur) { if (st) { this.cursor = st; s.arr[s.idx] = null; if (s.type === 'output') this._takeXp(); } }
      else if (!this._accepts(s, cur)) {
        if (s.type === 'output' && st && st.id === cur.id && cur.count + st.count <= maxStack(cur.id)) { cur.count += st.count; s.arr[s.idx] = null; this._takeXp(); }
      } else if (!st) {
        if (s.type === 'armor' && cur.count > 1) { s.arr[s.idx] = { ...cur, count: 1 }; cur.count--; }
        else { s.arr[s.idx] = cur; this.cursor = null; }
      } else if (st.id === cur.id && !st.dmg && !cur.dmg && maxStack(st.id) > 1) {
        const n = Math.min(cur.count, maxStack(st.id) - st.count);
        st.count += n; cur.count -= n;
        if (cur.count <= 0) this.cursor = null;
      } else { s.arr[s.idx] = cur; this.cursor = st; }
    } else if (button === 2) {
      if (!cur) {
        if (st && s.type !== 'output') {
          const n = Math.ceil(st.count / 2);
          this.cursor = { id: st.id, count: n, dmg: st.dmg || 0 };
          st.count -= n;
          if (st.count <= 0) s.arr[s.idx] = null;
        } else if (st) { this.cursor = st; s.arr[s.idx] = null; this._takeXp(); }
      } else if (this._accepts(s, cur)) {
        if (!st) { s.arr[s.idx] = { id: cur.id, count: 1, dmg: cur.dmg || 0 }; if (--cur.count <= 0) this.cursor = null; }
        else if (st.id === cur.id && !st.dmg && st.count < maxStack(st.id)) { st.count++; if (--cur.count <= 0) this.cursor = null; }
        else if (st.id !== cur.id) { s.arr[s.idx] = cur; this.cursor = st; }
      }
    }
    this._updateResult();
    this.dirty = true;
    this.refresh();
  }
  _takeXp() {
    const be = this.be;
    if (be && be.xp >= 1) { this.game.player.addXp(Math.floor(be.xp)); be.xp -= Math.floor(be.xp); }
  }
  _hotkey(n) {
    const s = this.hover;
    if (!s || s.type === 'creative' || s.type === 'trash') return;
    const inv = this.game.player.inv, a = this._stackAt(s), b = inv.slots[n];
    if (s.type === 'result') {
      if (a && !b) { inv.slots[n] = a; this.result[0] = null; this._consumeCraft(); }
    } else if (s.type === 'output') {
      if (a && !b) { inv.slots[n] = a; s.arr[s.idx] = null; this._takeXp(); }
    } else if (!b || this._accepts(s, b)) {
      if (s.arr === inv.slots && s.idx === n) return;
      s.arr[s.idx] = b; inv.slots[n] = a;
    }
    this._updateResult();
    this.dirty = true;
    this.refresh();
  }
  _closeContainer() {
    const g = this.game, p = g.player;
    const give = (st) => {
      if (!st) return;
      const left = p.inv.add(st);
      if (left > 0) g.dropItem(p.x, p.y + 1.2, p.z, st.id, left, st.dmg);
    };
    if (this.craftW) { for (let i = 0; i < this.craft.length; i++) { give(this.craft[i]); this.craft[i] = null; } }
    give(this.cursor);
    this.cursor = null;
    this.result[0] = null;
    if (this.screen === 'chest' && this.be) g.audio.play('chest', this.be.x + 0.5, this.be.y + 0.5, this.be.z + 0.5, 0.6, 0.8);
    this.be = null;
  }

  // ---- mouse handling for item slots -------------------------------------------------------
  // Empty hand: the click acts immediately. Holding a stack: the action waits for the button
  // to be released, so dragging across several slots can spread the stack out instead
  // (left = split evenly, right = one each). Double-click gathers matching items.
  _press(s, button, shift) {
    const now = performance.now();
    const dbl = button === 0 && this._lastClick && this._lastClick.slot === s && now - this._lastClick.t < 300;
    this._lastClick = { slot: s, t: now };
    if (button === 1) {
      const st = this._stackAt(s);
      if (st && !this.cursor && this.game.player.creative) {
        this.cursor = { id: st.id, count: maxStack(st.id), dmg: 0 };
        this.refresh();
      }
      return;
    }
    if (button !== 0 && button !== 2) return;
    if (shift) {
      this._click(s, button, true);
      this.shiftDrag = { button, last: s };
      return;
    }
    const plain = s.type === 'inv' || s.type === 'craft' || s.type === 'chest' || s.type === 'armor' || s.type === 'smelt' || s.type === 'fuel';
    if (this.cursor && plain) {
      this.drag = { button, slots: [s], orig: new Map([[s, s.arr[s.idx] ? { ...s.arr[s.idx] } : null]]), cursor: { ...this.cursor }, dbl };
      return;
    }
    this._click(s, button, false);
  }
  _dragOver(s) {
    if (!s) return;
    const sd = this.shiftDrag;
    if (sd) {
      if (s !== sd.last && s.type !== 'creative' && s.type !== 'trash' && s.type !== 'result' && this._stackAt(s)) this._click(s, sd.button, true);
      sd.last = s;
      return;
    }
    const d = this.drag;
    if (!d || d.slots.includes(s)) return;
    if (!(s.type === 'inv' || s.type === 'craft' || s.type === 'chest' || s.type === 'armor' || s.type === 'smelt' || s.type === 'fuel')) return;
    const c = d.cursor, max = maxStack(c.id), st = s.arr[s.idx];
    if (c.count <= d.slots.length || !this._accepts(s, c)) return;
    if (st && (st.id !== c.id || st.dmg || c.dmg || st.count >= max)) return;
    d.slots.push(s);
    d.orig.set(s, st ? { ...st } : null);
    this._dragApply();
  }
  _dragApply() {
    const d = this.drag, c = d.cursor, max = maxStack(c.id), n = d.slots.length;
    for (const s of d.slots) {
      const o = d.orig.get(s);
      s.arr[s.idx] = o ? { ...o } : null;
      s.el.classList.toggle('dragging', n > 1);
    }
    let left = c.count;
    if (n > 1) {
      const per = d.button === 0 ? Math.floor(c.count / n) : 1;
      for (const s of d.slots) {
        const cur = s.arr[s.idx];
        const add = Math.min(per, (s.type === 'armor' ? 1 : max) - (cur ? cur.count : 0), left);
        if (add <= 0) continue;
        if (cur) cur.count += add;
        else s.arr[s.idx] = { id: c.id, count: add, dmg: c.dmg || 0 };
        left -= add;
      }
    }
    this.cursor = left > 0 ? { ...c, count: left } : null;
    this._updateResult();
    this.dirty = true;
    this.refresh();
  }
  _release(button) {
    this.shiftDrag = null;
    const d = this.drag;
    if (!d || d.button !== button) return;
    this.drag = null;
    for (const s of d.slots) s.el.classList.remove('dragging');
    if (d.slots.length > 1) return; // already distributed while dragging
    if (d.dbl && button === 0 && this._collect()) return;
    this._click(d.slots[0], button, false);
  }
  // double-click: pull matching items from every slot onto the held stack
  _collect() {
    const cur = this.cursor;
    if (!cur || cur.dmg) return false;
    const max = maxStack(cur.id);
    if (max <= 1) return false;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.slots) {
        if (cur.count >= max) break;
        if (s.type === 'creative' || s.type === 'trash' || s.type === 'result') continue;
        const st = s.arr[s.idx];
        if (!st || st.id !== cur.id || st.dmg || (pass === 0) !== (st.count < max)) continue;
        const n = Math.min(st.count, max - cur.count);
        cur.count += n;
        st.count -= n;
        if (st.count <= 0) s.arr[s.idx] = null;
      }
    }
    this._updateResult();
    this.dirty = true;
    this.refresh();
    return true;
  }
  // Q over a slot throws one item out (Ctrl+Q: the whole stack)
  _dropHover(all) {
    const s = this.hover, g = this.game, p = g.player;
    if (!s || s.type === 'creative' || s.type === 'trash' || s.type === 'result') return;
    const st = s.arr[s.idx];
    if (!st) return;
    const n = all ? st.count : 1;
    g.dropItem(p.x, p.y + 1.3, p.z, st.id, n, st.dmg, p.lookDir());
    st.count -= n;
    if (st.count <= 0) s.arr[s.idx] = null;
    if (s.type === 'output') this._takeXp();
    this._updateResult();
    this.dirty = true;
    this.refresh();
  }

  // ---- events ------------------------------------------------------------------------------
  _events() {
    const scr = this.screens;
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.cursor) { this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px'; }
      if (this.slots.length) {
        const t = e.target.closest ? e.target.closest('.slot') : null;
        const s = t && t._slot ? t._slot : null;
        if (s !== this.hover) {
          this.hover = s;
          if (e.buttons) this._dragOver(s);
        }
        this._tooltip();
      }
    });
    scr.addEventListener('mousedown', (e) => {
      if (!this.slots.length) return;
      e.preventDefault();
      if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
      const t = e.target.closest('.slot');
      if (t && t._slot) this._press(t._slot, e.button, e.shiftKey);
      else if (!e.target.closest('.panel') && this.cursor) {
        // dropped outside the window
        const g = this.game, p = g.player, c = this.cursor;
        const n = e.button === 2 ? 1 : c.count;
        g.dropItem(p.x, p.y + 1.3, p.z, c.id, n, c.dmg, p.lookDir());
        c.count -= n;
        if (c.count <= 0) this.cursor = null;
        this._renderCursor();
      }
    });
    window.addEventListener('mouseup', (e) => { if (this.slots.length) this._release(e.button); });
    scr.addEventListener('contextmenu', (e) => e.preventDefault());
    scr.addEventListener('auxclick', (e) => e.preventDefault());
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const h = this.chatHistory;
      if (e.key === 'Enter') {
        const v = this.chatInput.value.trim();
        this.close();
        if (v) {
          if (h[h.length - 1] !== v) h.push(v);
          this.game.command(v);
        }
      } else if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.chatPos = Math.max(0, Math.min(h.length, this.chatPos + (e.key === 'ArrowUp' ? -1 : 1)));
        this.chatInput.value = h[this.chatPos] ?? '';
      }
    });
  }
  // keyboard handling while a screen is open; returns true if the key was consumed
  key(e) {
    if (!this.screen || this.screen === 'chat' || e.metaKey) return false;
    const container = this.slots.length > 0;
    if (container && e.code === 'KeyQ') { this._dropHover(e.ctrlKey); return true; }
    if (e.ctrlKey) return false;
    if (e.code === 'Escape') {
      if (this.screen === 'pause' || container) this.close();
      else if (this.screen === 'options' || this.screen === 'controls') { const d = this.screens.querySelector('.col:last-child .btn'); if (d) d.click(); }
      else if (this.screen === 'worlds') this.showTitle();
      else if (this.screen === 'create') this.showWorlds();
      return true;
    }
    if (container) {
      if (e.code === 'KeyE') { this.close(); return true; }
      if (/^Digit[1-9]$/.test(e.code)) { this._hotkey(+e.code[5] - 1); return true; }
    }
    return false;
  }
}
