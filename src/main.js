// FableCraft - game bootstrap, main loop, input, camera and glue between the systems.
import { m4, clamp, lerp } from './math.js';
import { B, blocks, SEA, WH, FLUID, SOLID } from './blocks.js';
import { items, itemByKey, I } from './items.js';
import { Renderer, lightRGB } from './renderer.js';
import { World } from './world.js';
import { BIOME } from './worldgen.js';
import { Player } from './player.js';
import { EntityManager, ItemEntity, FallingBlock, PrimedTNT, MOBS } from './mobs.js';
import { Living } from './entity.js';
import { Models } from './models.js';
import { Particles } from './particles.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { Save } from './save.js';
import { installFont } from './font.js';

const PI = Math.PI;
const DEFAULTS = { fov: 70, renderDist: 8, sensitivity: 1, gamma: 0.4, master: 1, music: 0.5, sfx: 1, clouds: true, bobbing: true, guiScale: 0, difficulty: 2 };
const TEST = new URLSearchParams(location.search).has('test');

class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.fresh = new Set();
    this.mouse = [false, false, false];
    this.clicks = [0, 0, 0];
    this.wheel = 0;
    this.locked = false;
    // free look: play without pointer lock when the browser refuses it
    this.freeLook = false;
    this.lockFails = 0;
    this.lockRetryAt = 0;
    this.onLockFail = null;
    this.mx = 0; this.my = 0; this.mouseIn = false;
    const c = game.canvas;
    window.addEventListener('keydown', (e) => this._keydown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    c.addEventListener('mousedown', (e) => {
      game.audio.init();
      if (!game.inWorld || game.ui.screen) return;
      if (!this.locked && !TEST) {
        if (performance.now() >= this.lockRetryAt) game.lockPointer(true);
        if (!this.freeLook) return;
      }
      this.mouse[e.button] = true;
      this.clicks[e.button]++;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { this.mouse[e.button] = false; });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.mx = e.clientX; this.my = e.clientY; this.mouseIn = true;
      if (!(this.locked || this.freeLook) || !this.active) return;
      const p = game.player, s = game.settings.sensitivity * 0.5 * 0.6 + 0.2, f = s * s * s * 8 * 0.15 * (PI / 180);
      p.yaw += e.movementX * f;
      p.pitch = clamp(p.pitch + e.movementY * f, -PI / 2 + 0.001, PI / 2 - 0.001);
    });
    window.addEventListener('wheel', (e) => { if (this.active) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('mouseleave', () => { this.mouseIn = false; });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === c;
      if (this.locked) {
        this.lockFails = 0;
        this.onLockFail = null;
      } else if (was) {
        this.reset();
        if (game.inWorld && !game.ui.screen) game.ui.showPause();
      }
    });
    document.addEventListener('pointerlockerror', () => { if (this.onLockFail) this.onLockFail(); });
  }
  get active() {
    const g = this.game;
    return g.inWorld && !g.ui.screen && (this.locked || this.freeLook || TEST);
  }
  reset() {
    this.keys.clear(); this.fresh.clear();
    this.mouse = [false, false, false];
    this.clicks = [0, 0, 0];
  }
  down(code) {
    return this.keys.has(code);
  }
  pressed(code) {
    return this.fresh.delete(code);
  }
  takeClick(b) {
    if (this.clicks[b] > 0) { this.clicks[b]--; return true; }
    return false;
  }
  clearClicks() {
    this.clicks = [0, 0, 0];
    this.fresh.clear();
    this.wheel = 0;
  }
  _keydown(e) {
    const g = this.game, ui = g.ui;
    if (e.target && (e.target.tagName === 'INPUT')) return;
    g.audio.init();
    if (e.code === 'KeyF' && !ui.screen) { g.toggleFullscreen(); return; }
    if (ui.screen) {
      if (ui.key(e)) e.preventDefault();
      return;
    }
    if (!g.inWorld) return;
    if (e.code !== 'F11' && e.code !== 'F12' && !(e.metaKey || (e.ctrlKey && e.code !== 'KeyW' && e.code !== 'ControlLeft'))) e.preventDefault();
    if (!e.repeat) {
      switch (e.code) {
        case 'KeyE': ui.openContainer('inventory'); return;
        case 'KeyT': ui.openChat(''); return;
        case 'Slash': ui.openChat('/'); return;
        case 'Escape': if (this.locked) document.exitPointerLock(); else ui.showPause(); return;
        case 'F1': ui.hudHidden = !ui.hudHidden; ui.showHud(true); return;
        case 'F3': ui.debug = !ui.debug; ui.debugEl.textContent = ''; return;
        case 'F5': g.view = (g.view + 1) % 3; return;
      }
      this.fresh.add(e.code);
    }
    this.keys.add(e.code);
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('fablecraft.settings') || '{}') || {}; } catch (e) { /* storage unavailable */ }
    this.settings = { ...DEFAULTS, ...stored };
    this.renderer = new Renderer(this.canvas);
    this.models = new Models(this.renderer);
    this.audio = new AudioSys();
    this.save = new Save();
    this.particles = new Particles(this);
    this.entities = new EntityManager(this);
    this.world = null; this.player = null; this.meta = null;
    this.inWorld = false; this.loading = false;
    this.view = 0;
    this.target = null;
    this.eyeFluid = 0;
    this.frame = 0; this.fps = 0; this._fpsN = 0; this._fpsT = 0;
    this.acc = 0; this.last = performance.now();
    this.peaceful = false; this.difficultyScale = 1;
    this.hm = m4.create(); this.hm2 = m4.create();
    this.light = [1, 1, 1];
    this.autosave = 0;
    this.ui = new UI(this);
    this.input = new Input(this);
    this.applySettings();
    this._menuWorld();
    this.ui.showTitle();
    window.addEventListener('beforeunload', (e) => {
      if (this.inWorld) {
        this.saveWorld();
        if (this.input.locked) { e.preventDefault(); e.returnValue = ''; }
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.inWorld) this.saveWorld(); });
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---- settings --------------------------------------------------------------------------
  saveSettings() {
    try { localStorage.setItem('fablecraft.settings', JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ }
  }
  applySettings() {
    const s = this.settings, r = this.renderer;
    r.settings.gamma = s.gamma;
    r.settings.clouds = s.clouds;
    this.audio.vol = { master: s.master, sfx: s.sfx, music: s.music };
    this.audio.applyVolume();
    this.peaceful = s.difficulty === 0;
    this.difficultyScale = [0, 0.6, 1, 1.5][s.difficulty];
    if (this.world && this.world.renderDist !== s.renderDist && this.inWorld) this.world.setRenderDist(s.renderDist);
  }
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().then(() => navigator.keyboard && navigator.keyboard.lock && navigator.keyboard.lock().catch(() => {})).catch(() => {});
  }
  // Ask the browser to capture the mouse. If it refuses (no click yet, or the page is embedded
  // somewhere that forbids it) the game carries on in free-look mode instead of stalling.
  lockPointer(gesture = false) {
    if (TEST) return;
    const inp = this.input;
    let done = false;
    const fail = () => {
      if (done || inp.locked) return;
      done = true;
      inp.onLockFail = null;
      if (gesture && ++inp.lockFails >= 2) { inp.lockFails = 0; inp.lockRetryAt = performance.now() + 5000; }
      if (!inp.freeLook) {
        inp.freeLook = true;
        document.body.classList.add('freelook');
        if (this.inWorld) {
          this.chat('Click the game to capture the mouse.', '#ffff55');
          this.chat('Without capture: move the mouse to the screen edges or use the arrow keys to turn.', '#aaaaaa');
        }
      }
    };
    inp.onLockFail = fail;
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(fail);
    } catch (e) { fail(); }
    setTimeout(fail, 800); // no answer at all counts as a refusal
  }
  releasePointer() {
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- world host callbacks ---------------------------------------------------------------
  uploadMesh(c, o, t) { this.renderer.uploadMesh(c, o, t); }
  freeMesh(c) { this.renderer.freeMesh(c); }
  dropItem(x, y, z, id, count, dmg = 0, dir = null) {
    const e = this.entities.add(new ItemEntity(this.world, x, y, z, { id, count, dmg: dmg || 0 }));
    if (dir) { e.vx = dir[0] * 0.3; e.vy = dir[1] * 0.3 + 0.1; e.vz = dir[2] * 0.3; e.pickupDelay = 40; }
    return e;
  }
  spawnFalling(x, y, z, id, meta) { this.entities.add(new FallingBlock(this.world, x, y, z, id, meta)); }
  spawnTNT(x, y, z, fuse) {
    this.entities.add(new PrimedTNT(this.world, x, y, z, fuse));
    this.audio.play('fuse', x + 0.5, y + 0.5, z + 0.5, 1);
  }
  sound(name, x, y, z, vol, pitch) { this.audio.play(name, x, y, z, vol, pitch); }
  smoke(x, y, z, n) { this.particles.smoke(x, y, z, n); }
  explosionEffects(x, y, z, power, source) {
    this.audio.play('explode', x, y, z, 4, 0.8 + Math.random() * 0.3);
    this.particles.explosion(x, y, z, power);
    const r = power * 2;
    const hit = (e) => {
      const dx = e.x - x, dy = e.y + e.h / 2 - y, dz = e.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > r) return;
      const imp = 1 - d / r;
      const l = d || 1;
      if (e instanceof Living) e.hurt(Math.floor(((imp * imp + imp) / 2) * 8 * r + 1), e.kind === 'player' ? { type: 'explosion', def: source && source.def, x, z } : source || { x, z });
      e.vx += (dx / l) * imp; e.vy += (dy / l) * imp * 0.8 + 0.1; e.vz += (dz / l) * imp;
    };
    for (const e of this.entities.list) if (e !== source) hit(e);
    if (this.player && this.player.alive) hit(this.player);
  }
  chat(msg, color) { this.ui.chat(msg, color); }

  // ---- world lifecycle -----------------------------------------------------------------------
  _disposeWorld() {
    if (this.world) this.world.dispose();
    this.world = null;
    this.entities.clear();
    this.particles.clear();
  }
  _menuWorld() {
    this._disposeWorld();
    this.inWorld = false;
    this.player = null;
    this.world = new World(20240229, this, { renderDist: Math.min(8, this.settings.renderDist), dayTime: 3000 });
    const s = this._findSpawn(this.world);
    this.menuCam = { x: s.x, y: Math.max(s.y + 14, 82), z: s.z };
    this.ui.showHud(false);
  }
  _findSpawn(world) {
    const gen = world.gen;
    let best = null;
    for (let r = 0; r < 60 && !best; r++) {
      for (let i = 0; i < Math.max(1, r * 6); i++) {
        const a = (i / Math.max(1, r * 6)) * PI * 2;
        const x = Math.round(Math.cos(a) * r * 24), z = Math.round(Math.sin(a) * r * 24);
        const h = gen.column(x, z), b = gen.oBiome;
        if (h >= SEA + 1 && h < 90 && b !== BIOME.OCEAN && b !== BIOME.RIVER && b !== BIOME.BEACH && b !== BIOME.DESERT && gen.treeAt(x, z, b, h) === 0) { best = { x: x + 0.5, y: h + 1, z: z + 0.5 }; break; }
      }
    }
    return best || { x: 0.5, y: gen.column(0, 0) + 1, z: 0.5 };
  }
  async startWorld(meta) {
    this.ui.showLoading(meta.fresh ? 'Generating world' : 'Loading world');
    this._disposeWorld();
    this.meta = meta;
    const saved = await this.save.chunkKeys(meta.id);
    const size = 16 * 16 * WH;
    this.world = new World(meta.seed, this, {
      renderDist: this.settings.renderDist, time: meta.time || 0, dayTime: meta.dayTime ?? 1000, savedChunks: saved,
      loadSaved: (cx, cz) => this.save.getChunk(meta.id, cx, cz, size),
      storeChunk: (c) => { this.save.putChunk(meta.id, c.cx, c.cz, c.blocks, c.meta); saved.add(c.cx + ',' + c.cz); },
    });
    if (meta.blockEntities) for (const [k, be] of meta.blockEntities) this.world.blockEntities.set(k, be);
    const p = (this.player = new Player(this, this.world));
    p.mode = meta.mode || 'survival';
    this.worldSpawn = meta.worldSpawn || this._findSpawn(this.world);
    if (meta.player) {
      const s = meta.player;
      p.setPos(s.x, s.y, s.z);
      p.yaw = s.yaw; p.pitch = s.pitch;
      p.health = s.health; p.food = s.food; p.saturation = s.saturation;
      p.xpLevel = s.xpLevel; p.xpProgress = s.xpProgress; p.xpTotal = s.xpTotal;
      p.inv.slots = s.slots; p.inv.armor = s.armor; p.inv.selected = s.selected;
      p.spawn = s.spawn || null;
      p.flying = !!s.flying;
      p.mode = s.mode || p.mode;
    } else p.setPos(this.worldSpawn.x, this.worldSpawn.y, this.worldSpawn.z);
    this.loading = true;
    this.inWorld = false;
    this.view = 0;
    this.acc = 0;
  }
  _finishLoading() {
    const p = this.player, w = this.world, meta = this.meta;
    this.loading = false;
    if (!meta.player) {
      // settle the spawn point onto the real terrain
      let x = Math.floor(this.worldSpawn.x), z = Math.floor(this.worldSpawn.z);
      // prefer open ground over tree tops
      const ground = (id) => id === B.GRASS || id === B.DIRT || id === B.SAND || id === B.STONE || id === B.SNOW_BLOCK || id === B.GRAVEL;
      search: for (let r = 0; r <= 12; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ty = w.topSolidY(x + dx, z + dz);
        if (ground(w.getBlock(x + dx, ty, z + dz)) && w.getLightRaw(x + dx, ty + 1, z + dz) >> 4 === 15) { x += dx; z += dz; break search; }
      }
      let y = w.topSolidY(x, z) + 1;
      while (y < WH - 2 && (SOLID[w.getBlock(x, y, z)] || FLUID[w.getBlock(x, y, z)])) y++;
      this.worldSpawn = { x: x + 0.5, y, z: z + 0.5 };
      p.setPos(x + 0.5, y, z + 0.5);
      if (p.mode === 'creative') {
        const give = [B.STONE, B.COBBLESTONE, B.PLANKS, B.LOG, B.GLASS, B.TORCH, B.BRICKS, B.OAK_STAIRS, B.TNT];
        give.forEach((id, i) => (p.inv.slots[i] = { id, count: 1, dmg: 0 }));
      }
      meta.worldSpawn = this.worldSpawn;
      delete meta.fresh;
    }
    this.inWorld = true;
    this.ui._clear();
    this.ui.screen = null;
    this.ui.showHud(true);
    this.ui.dirty = true;
    this.ui.onSelect();
    this.audio.init();
    this.lockPointer();
  }
  saveWorld() {
    if (!this.inWorld || !this.meta) return;
    const p = this.player, w = this.world, m = this.meta;
    w.saveAll();
    m.lastPlayed = Date.now();
    m.time = w.time; m.dayTime = w.dayTime;
    m.mode = p.mode;
    m.worldSpawn = this.worldSpawn;
    m.blockEntities = [...w.blockEntities.entries()];
    if (p.alive) {
      m.player = {
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, saturation: p.saturation,
        xpLevel: p.xpLevel, xpProgress: p.xpProgress, xpTotal: p.xpTotal, slots: p.inv.slots, armor: p.inv.armor, selected: p.inv.selected,
        spawn: p.spawn, flying: p.flying, mode: p.mode,
      };
    }
    this.save.putWorld(JSON.parse(JSON.stringify(m)));
  }
  quitToTitle() {
    this.saveWorld();
    this.releasePointer();
    this.inWorld = false;
    this._menuWorld();
    this.ui.showTitle();
  }

  // ---- commands ---------------------------------------------------------------------------------
  command(text) {
    const p = this.player, w = this.world;
    if (!text.startsWith('/')) { this.chat(`<Player> ${text}`); return; }
    const a = text.slice(1).trim().split(/\s+/), cmd = a[0].toLowerCase();
    const err = (m) => this.chat(m, '#ff5555');
    switch (cmd) {
      case 'help':
        this.chat('Commands: /gamemode <survival|creative>, /time set <day|noon|night|midnight|ticks>,', '#ffff55');
        this.chat('/tp <x> <y> <z>, /give <item> [count], /summon <mob> [count], /seed, /kill, /clear,', '#ffff55');
        this.chat('/difficulty <peaceful|easy|normal|hard>, /spawnpoint, /xp <amount>', '#ffff55');
        break;
      case 'gamemode': case 'gm': {
        const m = (a[1] || '').toLowerCase();
        if (['creative', 'c', '1'].includes(m)) p.mode = 'creative';
        else if (['survival', 's', '0'].includes(m)) { p.mode = 'survival'; p.flying = false; }
        else return err('Usage: /gamemode <survival|creative>');
        this.chat(`Set own game mode to ${p.mode[0].toUpperCase() + p.mode.slice(1)} Mode`);
        this.ui.dirty = true;
        break;
      }
      case 'time': {
        const v = (a[2] || a[1] || '').toLowerCase();
        const t = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 }[v] ?? parseInt(v, 10);
        if (Number.isNaN(t)) return err('Usage: /time set <day|noon|night|midnight|ticks>');
        w.dayTime = ((t % 24000) + 24000) % 24000;
        this.chat(`Set the time to ${w.dayTime}`);
        break;
      }
      case 'tp': {
        const c = a.slice(1, 4).map((v, i) => (v && v.startsWith('~') ? [p.x, p.y, p.z][i] + (parseFloat(v.slice(1)) || 0) : parseFloat(v)));
        if (c.length < 3 || c.some(Number.isNaN)) return err('Usage: /tp <x> <y> <z>');
        p.setPos(c[0], c[1], c[2]);
        p.vx = p.vy = p.vz = 0; p.fallDist = 0;
        this.chat(`Teleported to ${c[0].toFixed(1)}, ${c[1].toFixed(1)}, ${c[2].toFixed(1)}`);
        break;
      }
      case 'give': {
        const key = (a[1] || '').toLowerCase().replace(/^minecraft:/, '');
        const id = itemByKey.get(key);
        if (id === undefined || items[id].hidden) return err(`Unknown item '${a[1] || ''}'`);
        const n = clamp(parseInt(a[2], 10) || 1, 1, 2304);
        const left = p.inv.add({ id, count: n });
        if (left > 0) this.dropItem(p.x, p.y + 1, p.z, id, left);
        this.chat(`Gave ${n} [${items[id].name}] to Player`);
        this.ui.dirty = true;
        break;
      }
      case 'summon': case 'spawn': {
        const t = (a[1] || '').toLowerCase();
        if (!MOBS[t]) return err(`Unknown mob. Try: ${Object.keys(MOBS).join(', ')}`);
        const n = clamp(parseInt(a[2], 10) || 1, 1, 50), d = p.lookDir();
        for (let i = 0; i < n; i++) this.entities.spawnMob(t, p.x + d[0] * 3 + (Math.random() - 0.5) * 2, p.y + 0.5, p.z + d[2] * 3 + (Math.random() - 0.5) * 2);
        this.chat(`Summoned ${n} ${t}`);
        break;
      }
      case 'seed': this.chat(`Seed: [${w.seed}]`, '#55ff55'); break;
      case 'kill': p.health = 0; p.onDeath({ type: 'generic' }); break;
      case 'clear': p.inv.clear(); this.ui.dirty = true; this.chat('Cleared the inventory'); break;
      case 'spawnpoint': p.spawn = { x: p.x, y: p.y, z: p.z }; this.chat('Spawn point set'); break;
      case 'xp': p.addXp(clamp(parseInt(a[1], 10) || 0, 0, 100000)); this.ui.dirty = true; break;
      case 'difficulty': {
        const i = ['peaceful', 'easy', 'normal', 'hard'].indexOf((a[1] || '').toLowerCase());
        if (i < 0) return err('Usage: /difficulty <peaceful|easy|normal|hard>');
        this.settings.difficulty = i; this.applySettings(); this.saveSettings();
        this.chat(`Set difficulty to ${a[1]}`);
        break;
      }
      default: err(`Unknown command: ${cmd}. Type /help for a list of commands`);
    }
  }

  // ---- main loop -----------------------------------------------------------------------------------
  loop(t) {
    requestAnimationFrame((n) => this.loop(n));
    const dt = Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    this.frame++;
    this._fpsN++;
    if (t - this._fpsT >= 500) { this.fps = Math.round((this._fpsN * 1000) / (t - this._fpsT)); this._fpsN = 0; this._fpsT = t; }
    try {
      this.step(dt, t);
    } catch (e) {
      console.error(e);
      if (!this._fatal) {
        this._fatal = true;
        const f = document.getElementById('fatal');
        f.style.display = 'flex';
        f.textContent = 'FableCraft hit an error:\n\n' + (e && e.stack ? e.stack : e);
      }
    }
  }
  step(dt, t) {
    const w = this.world;
    if (!w) return;
    if (this.loading) {
      const p = this.player;
      w.update(p.x, p.z, 28);
      const f = w.readiness(p.x, p.z, Math.min(3, w.renderDist - 1));
      this.ui.setProgress(f);
      if (f >= 1) this._finishLoading();
      return;
    }
    if (!this.inWorld) {
      // title screen panorama
      const c = this.menuCam, a = t / 1000 * 0.035;
      w.update(c.x, c.z);
      const r = this.renderer;
      r.begin({ world: w, cam: { x: c.x, y: c.y, z: c.z, yaw: a, pitch: 0.16, fov: 75 }, underwater: 0, time: t / 50, eyeLight: 1 });
      r.drawSky();
      r.drawTerrain(0);
      r.drawTerrain(1);
      r.drawClouds();
      this.ui.update();
      return;
    }
    const paused = this.ui.screen === 'pause' || this.ui.screen === 'options' || this.ui.screen === 'controls';
    if (!paused) {
      this.acc += dt * 20;
      let n = 0;
      while (this.acc >= 1 && n < 10) { this.tick(); this.acc -= 1; n++; }
      if (this.acc > 1) this.acc = 0;
    }
    const p = this.player;
    const inp = this.input;
    if (inp.active && p.alive) {
      let tx = (inp.down('ArrowRight') ? 1 : 0) - (inp.down('ArrowLeft') ? 1 : 0), ty = (inp.down('ArrowDown') ? 1 : 0) - (inp.down('ArrowUp') ? 1 : 0);
      if (!inp.locked && inp.freeLook && inp.mouseIn) {
        const W = window.innerWidth, H = window.innerHeight, m = Math.min(W, H) * 0.14;
        const edge = (v, size) => (v < m ? -(((m - v) / m) ** 2) : v > size - m ? ((v - (size - m)) / m) ** 2 : 0);
        tx += edge(inp.mx, W) * 1.2;
        ty += edge(inp.my, H) * 0.9;
      }
      if (tx || ty) {
        p.yaw += tx * 2.2 * dt;
        p.pitch = clamp(p.pitch + ty * 1.6 * dt, -PI / 2 + 0.001, PI / 2 - 0.001);
      }
    }
    w.update(p.x, p.z);
    this.render(paused ? 1 : this.acc);
    this.ui.update();
  }

  tick() {
    const p = this.player, w = this.world;
    if (!w.isLoaded(Math.floor(p.x), Math.floor(p.z))) return;
    p.headYaw = p.yaw;
    p.tick(this.input);
    w.tick();
    this.entities.tick();
    this.particles.tick();
    this._ambient();
    if (++this.autosave >= 20 * 45) { this.autosave = 0; this.saveWorld(); }
    if (w.time % 20 === 0) this.audio.updateMusic(true);
  }
  // random display ticks: torch flames, lava pops, fire smoke
  _ambient() {
    const p = this.player, w = this.world, pr = this.particles;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    for (let i = 0; i < 90; i++) {
      const x = px + ((Math.random() * 28) | 0) - 14, y = py + ((Math.random() * 20) | 0) - 10, z = pz + ((Math.random() * 28) | 0) - 14;
      const id = w.getBlock(x, y, z);
      if (id === B.TORCH) {
        const m = w.getMeta(x, y, z);
        let fx = x + 0.5, fy = y + 0.7, fz = z + 0.5;
        if (m >= 1 && m <= 4) { const d = m - 1; fx -= [0, -1, 0, 1][d] * 0.27; fz -= [1, 0, -1, 0][d] * 0.27; fy += 0.22; }
        pr.flame(fx, fy, fz);
        pr.smoke(fx, fy + 0.05, fz, 1, 0.02);
      } else if (id === B.LAVA && w.getBlock(x, y + 1, z) === 0) {
        if (Math.random() < 0.25) pr.spawn('p_lava', x + Math.random(), y + 1, z + Math.random(), (Math.random() - 0.5) * 0.1, 0.15 + Math.random() * 0.1, (Math.random() - 0.5) * 0.1, 20, 0.07, { grav: 0.8, bright: true });
      } else if (id === B.FIRE) {
        pr.smoke(x + Math.random(), y + 0.8, z + Math.random(), 1, 0.1);
      } else if (id === B.FURNACE_LIT) {
        const f = w.getMeta(x, y, z) & 3;
        const ox = [0, -1, 0, 1][f] * 0.52, oz = [1, 0, -1, 0][f] * 0.52, k = Math.random() * 0.6 - 0.3;
        pr.flame(x + 0.5 + ox + (oz ? k : 0), y + 0.3 + Math.random() * 0.2, z + 0.5 + oz + (ox ? k : 0));
        pr.smoke(x + 0.5 + ox, y + 0.5, z + 0.5 + oz, 1, 0.1);
      }
    }
  }

  render(alpha) {
    const r = this.renderer, p = this.player, w = this.world, s = this.settings;
    const ex = lerp(p.px, p.x, alpha), ey = lerp(p.py, p.y, alpha) + lerp(p.peyeH, p.eyeH, alpha), ez = lerp(p.pz, p.z, alpha);
    const dir = p.lookDir();
    // target under the crosshair
    this.target = null;
    if (p.alive && !this.ui.screen || this.ui.screen === 'chat') {
      const reach = p.creative ? 5 : 4.5;
      const hit = w.raycast(ex, ey, ez, dir[0], dir[1], dir[2], reach);
      const ent = this.entities.pick(ex, ey, ez, dir[0], dir[1], dir[2], p.creative ? 5 : 3);
      if (ent && (!hit || ent.dist < hit.dist)) this.target = { entity: ent.entity };
      else if (hit) this.target = hit;
    }
    // camera
    const cam = { x: ex, y: ey, z: ez, yaw: p.yaw, pitch: p.pitch, fov: s.fov * lerp(p.pfovMod, p.fovMod, alpha), roll: 0, bob: null };
    if (this.view !== 0) {
      const sgn = this.view === 1 ? -1 : 1;
      let d = 4;
      const h = w.raycast(ex, ey, ez, dir[0] * sgn, dir[1] * sgn, dir[2] * sgn, d + 0.3);
      if (h) d = Math.max(0.3, h.dist - 0.3);
      cam.x += dir[0] * sgn * d; cam.y += dir[1] * sgn * d; cam.z += dir[2] * sgn * d;
      if (this.view === 2) { cam.yaw += PI; cam.pitch = -cam.pitch; }
    } else {
      if (s.bobbing) {
        const f1 = -(p.pwalkDist + (p.walkDist - p.pwalkDist) * alpha), f2 = lerp(p.pbob, p.bob, alpha);
        cam.bob = [Math.sin(f1 * PI) * f2 * 0.5, -Math.abs(Math.cos(f1 * PI) * f2), Math.sin(f1 * PI) * f2 * 3 * (PI / 180), Math.abs(Math.cos(f1 * PI - 0.2) * f2) * 5 * (PI / 180)];
      }
      if (!p.alive) cam.roll = (40 - 8000 / (p.deathTime + alpha + 200)) * (PI / 180);
      else if (p.hurtTime > 0) { const f = Math.sin(Math.pow((p.hurtTime - alpha) / 10, 4) * PI); cam.roll = -f * 14 * (PI / 180); }
    }
    // what is the camera inside of?
    const cb = w.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
    this.eyeFluid = this.view === 0 ? (p.eyeInFluid(1, ey) ? 1 : p.eyeInFluid(2, ey) ? 2 : 0) : FLUID[cb];
    if (this.eyeFluid === 1) cam.fov *= 60 / 70;
    const raw = w.getLightRaw(Math.floor(ex), Math.floor(ey), Math.floor(ez));
    this.audio.setListener(ex, ey, ez, p.yaw);
    this.audio.setUnderwater(this.eyeFluid === 1);

    r.begin({ world: w, cam, underwater: this.eyeFluid, time: w.time + alpha, eyeLight: Math.max(raw >> 4, raw & 15) / 15 });
    r.drawSky();
    r.drawTerrain(0);
    this.entities.render(r, this.models, alpha);
    if (this.view !== 0) this._drawPlayer(alpha);
    if (!this.ui.hudHidden && this.target && !this.target.entity) r.drawSelection(this.target, p.breakProgress);
    r.drawParticles(this.particles.list, alpha);
    r.drawTerrain(1);
    r.drawClouds();
    if (this.view === 0 && !this.ui.hudHidden && p.alive) this._drawHand(alpha, cam, raw);
  }

  _drawPlayer(alpha) {
    const r = this.renderer, p = this.player, cam = r.cam, m = this.hm;
    m4.identity(m);
    m4.translate(m, m, lerp(p.px, p.x, alpha) - cam.x, lerp(p.py, p.y, alpha) - cam.y, lerp(p.pz, p.z, alpha) - cam.z);
    m4.rotY(m, m, -p.yaw);
    if (!p.alive) m4.rotZ(m, m, Math.min(1, (p.deathTime + alpha) / 20) * PI / 2);
    const raw = this.world.getLightRaw(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
    const pose = this.models.poseFor('player', p, alpha);
    this.models.draw('player', m, pose, lightRGB(raw, r.sun, r.settings.gamma, this.light), p.hurtTime > 0 ? [1, 0, 0, 0.4] : null);
  }

  _drawHand(alpha, cam, raw) {
    const r = this.renderer, p = this.player, gl = r.gl;
    const proj = r.beginHand();
    const m = m4.identity(this.hm);
    if (cam.bob) {
      m4.translate(m, m, cam.bob[0], cam.bob[1], 0);
      m4.rotZ(m, m, cam.bob[2]);
      m4.rotX(m, m, cam.bob[3]);
    }
    const sw = p.swingAnim(alpha), sq = Math.sqrt(sw);
    const eq = 1 - lerp(p.pequip, p.equip, alpha);
    const st = p.inv.slots[p.inv.selected] && p.equipId === p.inv.slots[p.inv.selected].id ? p.inv.slots[p.inv.selected] : p.equipId ? { id: p.equipId } : null;
    const D = PI / 180;
    const light = lightRGB(raw, r.sun, r.settings.gamma, this.light);
    gl.enable(gl.CULL_FACE);
    if (!st || !items[st.id]) {
      // bare arm
      m4.translate(m, m, -0.3 * Math.sin(sq * PI), 0.4 * Math.sin(sq * PI * 2), -0.4 * Math.sin(sw * PI));
      m4.translate(m, m, 0.64, -0.6 - eq * 0.6, -0.72);
      m4.rotY(m, m, 45 * D);
      m4.rotY(m, m, Math.sin(sq * PI) * 70 * D);
      m4.rotZ(m, m, Math.sin(sw * sw * PI) * -20 * D);
      m4.translate(m, m, -1, 3.6, 3.5);
      m4.rotZ(m, m, 120 * D);
      m4.rotX(m, m, 200 * D);
      m4.rotY(m, m, -135 * D);
      m4.translate(m, m, 5.6, 0, 0);
      r.useModel();
      gl.uniformMatrix4fv(r.modelProg.u.u_vp, false, proj);
      gl.uniform2f(r.modelProg.u.u_fog, 1e9, 2e9);
      this.models.draw('arm1p', m, {}, light);
      return;
    }
    const using = p.usingItem > 0 ? p.usingItem + alpha : 0;
    m4.translate(m, m, -0.4 * Math.sin(sq * PI), 0.2 * Math.sin(sq * PI * 2), -0.2 * Math.sin(sw * PI));
    if (using && p.useKind === 'eat') {
      const t = Math.min(1, using / 6);
      m4.translate(m, m, -0.5 * t, (-0.1 + Math.abs(Math.sin(using * 0.9)) * 0.06) * t, 0.05 * t);
    } else if (using && p.useKind === 'bow') {
      const t = Math.min(1, using / 20);
      m4.translate(m, m, -0.22 * t, 0.08 * t, 0.12 * t + (t >= 1 ? Math.sin(using * 1.3) * 0.004 : 0));
    }
    m4.translate(m, m, 0.56, -0.52 - eq * 0.6, -0.72);
    m4.rotY(m, m, 45 * D);
    m4.rotY(m, m, Math.sin(sw * sw * PI) * -20 * D);
    m4.rotZ(m, m, Math.sin(sq * PI) * -20 * D);
    m4.rotX(m, m, Math.sin(sq * PI) * -80 * D);
    if (r.isFlatItem(st.id)) {
      m4.scale(m, m, 0.4, 0.4, 0.4);
      m4.translate(m, m, 0, 0.25, 0.125);
      m4.rotY(m, m, -135 * D);
      m4.rotZ(m, m, 25 * D);
      m4.scale(m, m, 1.7, 1.7, 1.7);
      r.useModel();
      gl.uniform2f(r.modelProg.u.u_fog, 1e9, 2e9);
      r.drawItem(st.id, m, raw, proj);
    } else {
      m4.scale(m, m, 0.4, 0.4, 0.4);
      r.drawItem(st.id, m, raw, proj);
    }
  }
}

let started = false;
async function start(data) {
  if (started) return;
  started = true;
  await installFont();
  try {
    const game = (window.game = new Game());
    if (data && data.worldId) {
      const worlds = await game.save.listWorlds();
      const meta = worlds.find((w) => w.id === data.worldId);
      if (meta) game.startWorld(meta);
    }
  } catch (e) {
    console.error(e);
    const f = document.getElementById('fatal');
    f.style.display = 'flex';
    f.textContent = 'FableCraft could not start:\n\n' + (e && e.stack ? e.stack : e);
  }
}
const hot = window.claude && window.claude.hot;
try {
  if (hot && hot.snapshot) {
    hot.snapshot(() => {
      const g = window.game;
      if (!g || !g.inWorld) return {};
      g.saveWorld();
      return { worldId: g.meta.id };
    });
  }
} catch (e) { /* not running inside a viewer */ }
try {
  if (hot && hot.ready) {
    hot.ready(start);
    setTimeout(() => start({}), 1500);
  } else start((hot && hot.data) || {});
} catch (e) {
  start({});
}
