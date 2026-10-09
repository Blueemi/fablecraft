// The live world on the main thread: chunk streaming, block access, lighting updates,
// fluids, block ticks, explosions and ray casting.
import {
  B, blocks, CH, WH, OPAQUE, LOPAC, LEMIT, LTERM, SHAPE, SH, SOLID, FLUID, TICKS,
  getBoxes, FACING_DX, FACING_DZ, isLeaves, isLog, isSapling,
} from './blocks.js';
import { WorldGen, treeShape, TREE_LOG, TREE_LEAVES } from './worldgen.js';
import { meshChunk, PW, PH, PSIZE } from './mesher.js';
import { initLight } from './light.js';
import { getDrops, SMELT, fuelTime, maxStack, I } from './items.js';
import { clamp } from './math.js';

const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const bkey = (x, y, z) => ((x + 2097152) * 128 + y) * 4194304 + (z + 2097152);
const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];
const DOWN = 3;
const HAS_BE = (id) => id === B.CHEST || id === B.FURNACE || id === B.FURNACE_LIT;

// Background workers come from worker.js, or from an inlined source string in single-file builds.
let workerUrl = null;
function makeWorker() {
  const src = globalThis.FABLECRAFT_WORKER_SOURCE;
  if (src) {
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    return new Worker(workerUrl);
  }
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}
// Stand-in used when workers are unavailable: same interface, jobs run on the main thread.
class LocalWorker {
  constructor(world) {
    this.world = world;
  }
  postMessage(m) {
    if (m.type !== 'init') this.world._localJobs.push([this, m]);
  }
  terminate() {}
}

export class Chunk {
  constructor(cx, cz, blocks, meta, light) {
    this.cx = cx; this.cz = cz;
    this.blocks = blocks; this.meta = meta; this.light = light;
    this.dirty = 1; // 0 clean, 1 needs remesh, 2 needs remesh urgently
    this.meshing = false;
    this.ver = 0;
    this.modified = false;
    this.mesh = null;
    this.meshedVer = -1;
  }
}

export class World {
  constructor(seed, host, opts = {}) {
    this.seed = seed | 0;
    this.host = host;
    this.gen = new WorldGen(this.seed);
    this.chunks = new Map();
    this.pending = new Set();
    this.renderDist = opts.renderDist ?? 8;
    this.time = opts.time ?? 0;
    this.dayTime = opts.dayTime ?? 1000;
    this.blockEntities = new Map();
    this.sched = new Map();
    this.savedChunks = opts.savedChunks ?? new Set();
    this.loadSaved = opts.loadSaved ?? null;
    this.storeChunk = opts.storeChunk ?? null;
    this._lc = null;
    this._lq = [];
    this._rq = [];
    this._lightDirty = 1;
    this.genId = (World._gen = (World._gen || 0) + 1);
    this.workers = [];
    this.idle = [];
    this.offsets = [];
    this.pcx = 1e9; this.pcz = 1e9;
    this.rand = Math.random;
    this._pb = new Uint8Array(PSIZE); this._pm = new Uint8Array(PSIZE); this._pl = new Uint8Array(PSIZE);
    this.stats = { meshed: 0, generated: 0 };
    this.frozen = false;
    this._local = false;
    this._localJobs = [];
    this._workerOk = false;
    this._firstJob = 0;
    const n = clamp((navigator.hardwareConcurrency || 4) - 2, 2, 6);
    try {
      for (let i = 0; i < n; i++) {
        const w = makeWorker();
        w.postMessage({ type: 'init', seed: this.seed });
        w.onmessage = (e) => { if (this._local) return; this._workerOk = true; this._onWorker(w, e.data); };
        w.onerror = (e) => {
          console.warn('worker error', e.message || '', e.filename || '', e.lineno || '');
          if (!this._workerOk) this._useLocal();
        };
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch (e) {
      console.warn('workers unavailable, generating on the main thread', e);
      this._useLocal();
    }
    this.setRenderDist(this.renderDist);
  }

  // switch to main-thread generation and meshing (slower, but works everywhere)
  _useLocal() {
    if (this._local) return;
    this._local = true;
    for (const w of this.workers) { try { w.terminate(); } catch (e) { /* ignore */ } }
    this.workers = [];
    this.idle = [];
    this._localJobs = [];
    for (let i = 0; i < 2; i++) {
      const w = new LocalWorker(this);
      this.workers.push(w);
      this.idle.push(w);
    }
    this.pending.clear();
    for (const c of this.chunks.values()) c.meshing = false;
  }
  _runLocal(budget) {
    const t0 = performance.now(), jobs = this._localJobs;
    while (jobs.length && performance.now() - t0 < budget) {
      const [w, m] = jobs.shift();
      if (m.type === 'gen') {
        const { blocks, meta } = this.gen.generate(m.cx, m.cz);
        const light = new Uint8Array(blocks.length);
        initLight(blocks, light);
        this._onWorker(w, { type: 'gen', cx: m.cx, cz: m.cz, gen: m.gen, blocks, meta, light });
      } else if (m.type === 'light') {
        const light = new Uint8Array(m.blocks.length);
        initLight(m.blocks, light);
        this._onWorker(w, { type: 'gen', cx: m.cx, cz: m.cz, gen: m.gen, blocks: m.blocks, meta: m.meta, light, saved: true });
      } else if (m.type === 'mesh') {
        const r = meshChunk(m.pb, m.pm, m.pl, m.cx, m.cz, this.gen.climate);
        this._onWorker(w, { type: 'mesh', cx: m.cx, cz: m.cz, gen: m.gen, ver: m.ver, opaque: r.opaque, trans: r.trans });
      }
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    for (const c of this.chunks.values()) this.host.freeMesh(c);
    this.chunks.clear();
  }

  setRenderDist(r) {
    this.renderDist = r;
    const R = r + 1, o = [];
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      const d = x * x + z * z;
      if (d <= (R + 0.5) * (R + 0.5)) o.push([x, z, d]);
    }
    o.sort((a, b) => a[2] - b[2]);
    this.offsets = o;
  }

  // ---- chunk access -----------------------------------------------------------
  chunkAt(cx, cz) {
    const lc = this._lc;
    if (lc && lc.cx === cx && lc.cz === cz) return lc;
    const c = this.chunks.get(ckey(cx, cz));
    if (c) this._lc = c;
    return c;
  }
  isLoaded(x, z) {
    return !!this.chunkAt(x >> 4, z >> 4);
  }
  getBlock(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    const c = this.chunkAt(x >> 4, z >> 4);
    return c ? c.blocks[((x & 15) << 11) | ((z & 15) << 7) | y] : 0;
  }
  getMeta(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    const c = this.chunkAt(x >> 4, z >> 4);
    return c ? c.meta[((x & 15) << 11) | ((z & 15) << 7) | y] : 0;
  }
  // raw light byte (sky<<4 | block)
  getLightRaw(x, y, z) {
    if (y >= WH) return 0xf0;
    if (y < 0) return 0;
    const c = this.chunkAt(x >> 4, z >> 4);
    return c ? c.light[((x & 15) << 11) | ((z & 15) << 7) | y] : 0xf0;
  }
  skyDarken() {
    const a = this.celestialAngle();
    return Math.round((1 - clamp(Math.cos(a * Math.PI * 2) * 2 + 0.5, 0, 1)) * 11);
  }
  // effective light level 0..15 taking time of day into account
  getLight(x, y, z) {
    const l = this.getLightRaw(x, y, z);
    return Math.max(l & 15, (l >> 4) - this.skyDarken());
  }
  celestialAngle() {
    let f = this.dayTime / 24000 - 0.25;
    f -= Math.floor(f);
    const f1 = 1 - (Math.cos(f * Math.PI) + 1) / 2;
    return f + (f1 - f) / 3;
  }
  isDay() {
    return this.skyDarken() < 4;
  }
  topSolidY(x, z) {
    for (let y = WH - 1; y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (SOLID[id] || FLUID[id]) return y;
    }
    return 0;
  }
  canSeeSky(x, y, z) {
    return this.getLightRaw(x, y, z) >> 4 === 15;
  }

  _markDirty(c, lx, lz, level) {
    if (c.dirty < level) c.dirty = level;
    c.ver++;
    const x0 = lx === 0 ? -1 : lx === 15 ? 1 : 0, z0 = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (x0) this._dirtyN(c.cx + x0, c.cz, level);
    if (z0) this._dirtyN(c.cx, c.cz + z0, level);
    if (x0 && z0) this._dirtyN(c.cx + x0, c.cz + z0, level);
  }
  _dirtyN(cx, cz, level) {
    const n = this.chunks.get(ckey(cx, cz));
    if (n) {
      if (n.dirty < level) n.dirty = level;
      n.ver++;
    }
  }

  // flags: 1 = notify neighbours, 2 = no light update (internal)
  setBlock(x, y, z, id, meta = 0, flags = 1) {
    if (y < 0 || y >= WH) return false;
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return false;
    const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
    const old = c.blocks[i];
    if (old === id && c.meta[i] === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    c.modified = true;
    this._markDirty(c, x & 15, z & 15, 2);
    if (old !== id) {
      if (HAS_BE(old) && !HAS_BE(id)) this.blockEntities.delete(bkey(x, y, z));
      this._relight(x, y, z, old, id);
      if ((isLog(old) || isLeaves(old)) && !isLog(id)) this._flagLeaves(x, y, z);
    }
    if (flags & 1) this.notifyNeighbors(x, y, z);
    return true;
  }
  // change only metadata without neighbour notification (growth stages etc.)
  setMeta(x, y, z, meta, remesh = true) {
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c || y < 0 || y >= WH) return;
    const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
    if (c.meta[i] === meta) return;
    c.meta[i] = meta;
    c.modified = true;
    if (remesh) this._markDirty(c, x & 15, z & 15, 2);
  }

  // ---- lighting ---------------------------------------------------------------
  _spread(sky) {
    const q = this._lq, lvl = this._lightDirty;
    let h = 0;
    while (h < q.length) {
      const x = q[h], y = q[h + 1], z = q[h + 2];
      h += 3;
      const c = this.chunkAt(x >> 4, z >> 4);
      if (!c) continue;
      const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
      const L = sky ? c.light[i] >> 4 : c.light[i] & 15;
      if (L <= 1 || LTERM[c.blocks[i]]) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= WH) continue;
        const nc = nx >> 4 === c.cx && nz >> 4 === c.cz ? c : this.chunkAt(nx >> 4, nz >> 4);
        if (!nc) continue;
        const ni = ((nx & 15) << 11) | ((nz & 15) << 7) | ny;
        const op = LOPAC[nc.blocks[ni]];
        if (op >= 15) continue;
        const nl = sky && d === DOWN && L === 15 && op === 0 ? 15 : L - (op > 1 ? op : 1);
        const cur = sky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
        if (nl > cur) {
          nc.light[ni] = sky ? (nc.light[ni] & 15) | (nl << 4) : (nc.light[ni] & 0xf0) | nl;
          this._markDirty(nc, nx & 15, nz & 15, lvl);
          q.push(nx, ny, nz);
        }
      }
    }
    q.length = 0;
  }
  _unlight(x, y, z, sky) {
    const rq = this._rq, lq = this._lq, lvl = this._lightDirty;
    const c0 = this.chunkAt(x >> 4, z >> 4);
    if (!c0) return;
    const i0 = ((x & 15) << 11) | ((z & 15) << 7) | y;
    const v0 = sky ? c0.light[i0] >> 4 : c0.light[i0] & 15;
    c0.light[i0] = sky ? c0.light[i0] & 15 : c0.light[i0] & 0xf0;
    rq.push(x, y, z, v0);
    let h = 0;
    while (h < rq.length) {
      const cx = rq[h], cy = rq[h + 1], cz = rq[h + 2], v = rq[h + 3];
      h += 4;
      for (let d = 0; d < 6; d++) {
        const nx = cx + DX[d], ny = cy + DY[d], nz = cz + DZ[d];
        if (ny < 0 || ny >= WH) continue;
        const nc = this.chunkAt(nx >> 4, nz >> 4);
        if (!nc) continue;
        const ni = ((nx & 15) << 11) | ((nz & 15) << 7) | ny;
        const nl = sky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
        if (nl === 0) continue;
        if (nl < v || (sky && d === DOWN && v === 15)) {
          if (!sky && LEMIT[nc.blocks[ni]] >= nl) { lq.push(nx, ny, nz); continue; }
          nc.light[ni] = sky ? nc.light[ni] & 15 : nc.light[ni] & 0xf0;
          this._markDirty(nc, nx & 15, nz & 15, lvl);
          rq.push(nx, ny, nz, nl);
        } else lq.push(nx, ny, nz);
      }
    }
    rq.length = 0;
    this._spread(sky);
  }
  _relight(x, y, z, old, id) {
    this._lightDirty = 2;
    const c = this.chunkAt(x >> 4, z >> 4);
    const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
    const opChanged = LOPAC[old] !== LOPAC[id] || LTERM[old] !== LTERM[id];
    if (opChanged || LEMIT[old] !== LEMIT[id]) {
      const bl = c.light[i] & 15;
      if (bl > 0) this._unlight(x, y, z, 0);
      if (LEMIT[id] > 0) {
        c.light[i] = (c.light[i] & 0xf0) | LEMIT[id];
        this._lq.push(x, y, z);
        this._spread(0);
      } else if (bl === 0 && LOPAC[id] < 15) {
        for (let d = 0; d < 6; d++) this._lq.push(x + DX[d], y + DY[d], z + DZ[d]);
        this._spread(0);
      }
    }
    if (opChanged) {
      const sl = c.light[i] >> 4;
      if (sl > 0) this._unlight(x, y, z, 1);
      if (LOPAC[id] < 15) {
        if (y === WH - 1) {
          const op = LOPAC[id];
          c.light[i] = (c.light[i] & 15) | ((op === 0 ? 15 : 15 - op) << 4);
          this._lq.push(x, y, z);
        }
        for (let d = 0; d < 6; d++) this._lq.push(x + DX[d], y + DY[d], z + DZ[d]);
        this._spread(1);
      }
    }
    this._lightDirty = 1;
  }
  // connect a freshly inserted chunk's light with its neighbours
  _stitch(c) {
    const qs = [], qb = [];
    const x0 = c.cx * 16, z0 = c.cz * 16;
    for (let d = 0; d < 4; d++) {
      const n = this.chunks.get(ckey(c.cx + (d === 0 ? 1 : d === 1 ? -1 : 0), c.cz + (d === 2 ? 1 : d === 3 ? -1 : 0)));
      if (!n) continue;
      for (let k = 0; k < 16; k++) {
        let ax, az, bx, bz;
        if (d === 0) { ax = 15; az = k; bx = 0; bz = k; }
        else if (d === 1) { ax = 0; az = k; bx = 15; bz = k; }
        else if (d === 2) { ax = k; az = 15; bx = k; bz = 0; }
        else { ax = k; az = 0; bx = k; bz = 15; }
        const ai = (ax << 11) | (az << 7), bi = (bx << 11) | (bz << 7);
        const wax = x0 + ax, waz = z0 + az, wbx = n.cx * 16 + bx, wbz = n.cz * 16 + bz;
        for (let y = 0; y < WH; y++) {
          const la = c.light[ai + y], lb = n.light[bi + y];
          if (la === lb) continue;
          const sa = la >> 4, sb = lb >> 4, ba = la & 15, bb = lb & 15;
          if (sa > sb + 1) qs.push(wax, y, waz); else if (sb > sa + 1) qs.push(wbx, y, wbz);
          if (ba > bb + 1) qb.push(wax, y, waz); else if (bb > ba + 1) qb.push(wbx, y, wbz);
        }
      }
    }
    this._lightDirty = 1;
    if (qb.length) { this._lq = qb; this._spread(0); }
    if (qs.length) { this._lq = qs; this._spread(1); }
    this._lq = [];
  }

  // ---- chunk streaming ----------------------------------------------------------
  _onWorker(w, m) {
    this.idle.push(w);
    if (m.gen !== this.genId) return;
    if (m.type === 'gen') {
      const k = ckey(m.cx, m.cz);
      this.pending.delete(k);
      if (this.chunks.has(k)) return;
      const c = new Chunk(m.cx, m.cz, m.blocks, m.meta, m.light);
      this.chunks.set(k, c);
      this._stitch(c);
      this.stats.generated++;
      // neighbours may have been waiting for this chunk before they can mesh
    } else if (m.type === 'mesh') {
      const c = this.chunks.get(ckey(m.cx, m.cz));
      if (!c) return;
      c.meshing = false;
      if (m.ver < c.meshedVer) return; // a newer synchronous mesh is already in place
      c.meshedVer = m.ver;
      if (c.ver === m.ver) c.dirty = 0;
      this.host.uploadMesh(c, m.opaque, m.trans);
      this.stats.meshed++;
    }
  }
  _neighborsLoaded(cx, cz) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if ((dx || dz) && !this.chunks.has(ckey(cx + dx, cz + dz))) return false;
    }
    return true;
  }
  _buildPadded(c, pb, pm, pl) {
    for (let px = 0; px < PW; px++) for (let pz = 0; pz < PW; pz++) {
      const x = px - 1, z = pz - 1;
      const ch = x >= 0 && x < 16 && z >= 0 && z < 16 ? c : this.chunks.get(ckey(c.cx + (x >> 4), c.cz + (z >> 4)));
      const dst = (px * PW + pz) * PH + 1;
      pb[dst - 1] = B.BEDROCK;
      pl[dst + WH] = 0xf0;
      pb[dst + WH] = 0;
      if (!ch) {
        pb.fill(0, dst, dst + WH);
        pl.fill(0xf0, dst, dst + WH);
        continue;
      }
      const src = ((x & 15) << 11) | ((z & 15) << 7);
      pb.set(ch.blocks.subarray(src, src + WH), dst);
      pm.set(ch.meta.subarray(src, src + WH), dst);
      pl.set(ch.light.subarray(src, src + WH), dst);
    }
  }
  _meshSync(c) {
    this._buildPadded(c, this._pb, this._pm, this._pl);
    const r = meshChunk(this._pb, this._pm, this._pl, c.cx, c.cz, this.gen.climate);
    c.dirty = 0;
    c.meshedVer = c.ver;
    this.host.uploadMesh(c, r.opaque, r.trans);
  }

  // called every frame with the player position (budget: ms allowed for main-thread fallback work)
  update(px, pz, budget = 7) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    this.pcx = pcx; this.pcz = pcz;
    const R = this.renderDist;
    if (this._local) this._runLocal(budget);
    else if (!this._workerOk && this._firstJob && performance.now() - this._firstJob > 6000) {
      console.warn('workers never answered, generating on the main thread');
      this._useLocal();
    }
    // urgent (player-visible) remeshes run synchronously, nearest first
    let sync = 0;
    for (const [ox, oz, d] of this.offsets) {
      if (d > 9) break;
      const c = this.chunks.get(ckey(pcx + ox, pcz + oz));
      if (c && c.dirty === 2 && c.mesh && this._neighborsLoaded(c.cx, c.cz)) {
        this._meshSync(c);
        if (++sync >= 3) break;
      }
    }
    if (this.idle.length) {
      for (const [ox, oz, d] of this.offsets) {
        if (!this.idle.length) break;
        const cx = pcx + ox, cz = pcz + oz, k = ckey(cx, cz);
        const c = this.chunks.get(k);
        if (!c) {
          if (this.pending.has(k)) continue;
          this.pending.add(k);
          if (!this._firstJob) this._firstJob = performance.now();
          const w = this.idle.pop();
          const sk = cx + ',' + cz;
          if (this.savedChunks.has(sk) && this.loadSaved) {
            const gen = this.genId;
            this.loadSaved(cx, cz).then((data) => {
              if (data) w.postMessage({ type: 'light', cx, cz, gen, blocks: data.blocks, meta: data.meta }, [data.blocks.buffer, data.meta.buffer]);
              else w.postMessage({ type: 'gen', cx, cz, gen });
            });
          } else w.postMessage({ type: 'gen', cx, cz, gen: this.genId });
        } else if (c.dirty && !c.meshing && d <= (R + 0.5) * (R + 0.5) && this._neighborsLoaded(cx, cz)) {
          const pb = new Uint8Array(PSIZE), pm = new Uint8Array(PSIZE), pl = new Uint8Array(PSIZE);
          this._buildPadded(c, pb, pm, pl);
          c.meshing = true;
          if (c.dirty === 2) c.dirty = 1;
          const w = this.idle.pop();
          w.postMessage({ type: 'mesh', cx, cz, gen: this.genId, ver: c.ver, pb, pm, pl }, [pb.buffer, pm.buffer, pl.buffer]);
        }
      }
    }
    // unload far chunks (a few per frame)
    if ((this._unloadTick = (this._unloadTick || 0) + 1) % 30 === 0) {
      const lim = (R + 3.5) * (R + 3.5);
      for (const c of this.chunks.values()) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > lim) this.unloadChunk(c);
      }
    }
  }
  unloadChunk(c) {
    if (c.modified && this.storeChunk) {
      this.storeChunk(c);
      c.modified = false;
    }
    this.host.freeMesh(c);
    this.chunks.delete(ckey(c.cx, c.cz));
    if (this._lc === c) this._lc = null;
  }
  saveAll() {
    if (!this.storeChunk) return;
    for (const c of this.chunks.values()) {
      if (c.modified) {
        this.storeChunk(c);
        c.modified = false;
      }
    }
  }
  // fraction of chunks ready (meshed) within r chunks of the given position
  readiness(px, pz, r) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    let n = 0, ok = 0;
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      n++;
      const c = this.chunks.get(ckey(pcx + x, pcz + z));
      if (c && c.mesh) ok++;
    }
    return ok / n;
  }

  // ---- block updates ------------------------------------------------------------
  schedule(x, y, z, delay) {
    const k = bkey(x, y, z);
    if (!this.sched.has(k)) this.sched.set(k, { x, y, z, t: this.time + delay });
  }
  notifyNeighbors(x, y, z) {
    this.neighborChanged(x, y, z);
    for (let d = 0; d < 6; d++) this.neighborChanged(x + DX[d], y + DY[d], z + DZ[d]);
  }
  neighborChanged(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!id) return;
    const d = blocks[id];
    if (d.fluid) {
      if (id === B.LAVA && this._lavaMix(x, y, z)) return;
      this.schedule(x, y, z, id === B.WATER ? 5 : 30);
      return;
    }
    if (d.gravity) { this.schedule(x, y, z, 2); return; }
    const meta = this.getMeta(x, y, z);
    switch (d.shape) {
      case SH.CROSS: case SH.CROP:
        if (!this.canPlantStay(id, x, y, z)) this.breakNaturally(x, y, z);
        break;
      case SH.TORCH:
        if (!this.torchSupported(x, y, z, meta)) this.breakNaturally(x, y, z);
        break;
      case SH.LADDER: {
        const f = meta & 3;
        if (!OPAQUE[this.getBlock(x - FACING_DX[f], y, z - FACING_DZ[f])]) this.breakNaturally(x, y, z);
        break;
      }
      case SH.DOOR:
        if (meta & 8) {
          if (this.getBlock(x, y - 1, z) !== id) this.setBlock(x, y, z, 0);
        } else if (this.getBlock(x, y + 1, z) !== id || !SOLID[this.getBlock(x, y - 1, z)]) this.breakNaturally(x, y, z);
        break;
      case SH.BED: {
        const f = meta & 3, s = meta & 4 ? -1 : 1;
        if (this.getBlock(x + FACING_DX[f] * s, y, z + FACING_DZ[f] * s) !== id) this.breakNaturally(x, y, z);
        break;
      }
      case SH.SNOW: {
        const b = this.getBlock(x, y - 1, z);
        if (!OPAQUE[b] && !isLeaves(b)) this.setBlock(x, y, z, 0);
        break;
      }
      case SH.CACTUS:
        if (!this.canCactusStay(x, y, z)) this.breakNaturally(x, y, z);
        break;
      case SH.FARMLAND:
        if (SOLID[this.getBlock(x, y + 1, z)]) this.setBlock(x, y, z, B.DIRT);
        break;
      case SH.FIRE:
        if (!this.fireCanStay(x, y, z)) this.setBlock(x, y, z, 0);
        break;
    }
  }
  canPlantStay(id, x, y, z) {
    const b = this.getBlock(x, y - 1, z);
    switch (id) {
      case B.WHEAT: return b === B.FARMLAND;
      case B.SUGAR_CANE: return b === B.SUGAR_CANE || b === B.GRASS || b === B.DIRT || b === B.SAND;
      case B.DEAD_BUSH: return b === B.SAND || b === B.DIRT || b === B.GRASS;
      case B.BROWN_MUSHROOM: case B.RED_MUSHROOM: return OPAQUE[b] === 1;
      default: return b === B.GRASS || b === B.DIRT || b === B.FARMLAND;
    }
  }
  canCactusStay(x, y, z) {
    const b = this.getBlock(x, y - 1, z);
    if (b !== B.CACTUS && b !== B.SAND) return false;
    for (let d = 0; d < 4; d++) if (SOLID[this.getBlock(x + FACING_DX[d], y, z + FACING_DZ[d])]) return false;
    return true;
  }
  torchSupported(x, y, z, meta) {
    if (meta >= 1 && meta <= 4) {
      const f = meta - 1;
      return OPAQUE[this.getBlock(x - FACING_DX[f], y, z - FACING_DZ[f])] === 1;
    }
    const b = this.getBlock(x, y - 1, z);
    return OPAQUE[b] === 1 || b === B.FENCE || b === B.GLASS || (SHAPE[b] === SH.SLAB && (this.getMeta(x, y - 1, z) & 1)) || (SHAPE[b] === SH.STAIRS && (this.getMeta(x, y - 1, z) & 4));
  }
  fireCanStay(x, y, z) {
    if (SOLID[this.getBlock(x, y - 1, z)]) return true;
    for (let d = 0; d < 6; d++) if (blocks[this.getBlock(x + DX[d], y + DY[d], z + DZ[d])].flammable) return true;
    return false;
  }
  // break a block as the environment would (drops items)
  breakNaturally(x, y, z, tool = null) {
    const id = this.getBlock(x, y, z);
    if (!id) return;
    const meta = this.getMeta(x, y, z);
    this.dropBlockEntity(x, y, z);
    this.setBlock(x, y, z, 0);
    for (const s of getDrops(id, meta, tool, this.rand)) this.host.dropItem(x + 0.5, y + 0.3, z + 0.5, s.id, s.count);
  }
  dropBlockEntity(x, y, z) {
    const be = this.blockEntities.get(bkey(x, y, z));
    if (!be) return;
    for (const s of be.items) if (s) this.host.dropItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dmg);
    this.blockEntities.delete(bkey(x, y, z));
  }
  getBlockEntity(x, y, z, create) {
    const k = bkey(x, y, z);
    let be = this.blockEntities.get(k);
    if (!be && create) {
      const id = this.getBlock(x, y, z);
      if (id === B.CHEST) be = { type: 'chest', x, y, z, items: new Array(27).fill(null) };
      else if (id === B.FURNACE || id === B.FURNACE_LIT) be = { type: 'furnace', x, y, z, items: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
      if (be) this.blockEntities.set(k, be);
    }
    return be;
  }
  _flagLeaves(x, y, z) {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const c = this.chunkAt((x + dx) >> 4, (z + dz) >> 4);
      if (!c) continue;
      const base = (((x + dx) & 15) << 11) | (((z + dz) & 15) << 7);
      for (let dy = -4; dy <= 4; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= WH) continue;
        if (isLeaves(c.blocks[base + yy])) c.meta[base + yy] |= 2;
      }
    }
  }
  _leafConnected(x, y, z) {
    // flood through leaves up to 4 steps looking for a log
    const seen = new Set([0]);
    let frontier = [[0, 0, 0]];
    for (let step = 0; step < 4; step++) {
      const next = [];
      for (const [ax, ay, az] of frontier) {
        for (let d = 0; d < 6; d++) {
          const bx = ax + DX[d], by = ay + DY[d], bz = az + DZ[d];
          const k = (bx + 8) * 289 + (by + 8) * 17 + bz + 8;
          if (seen.has(k)) continue;
          seen.add(k);
          const id = this.getBlock(x + bx, y + by, z + bz);
          if (isLog(id)) return true;
          if (isLeaves(id)) next.push([bx, by, bz]);
        }
      }
      frontier = next;
    }
    return false;
  }

  // ---- fluids ---------------------------------------------------------------------
  _blocksFluid(id) {
    return SOLID[id] === 1 || SHAPE[id] === SH.LADDER || id === B.SUGAR_CANE;
  }
  _lavaMix(x, y, z) {
    for (let d = 0; d < 6; d++) {
      if (d === DOWN) continue;
      if (this.getBlock(x + DX[d], y + DY[d], z + DZ[d]) === B.WATER) {
        const m = this.getMeta(x, y, z);
        this.setBlock(x, y, z, m === 0 ? B.OBSIDIAN : B.COBBLESTONE);
        this.host.sound('fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.2);
        this.host.smoke(x + 0.5, y + 1, z + 0.5, 6);
        return true;
      }
    }
    return false;
  }
  _canFlowInto(x, y, z, id) {
    if (y < 0) return false;
    if (!this.isLoaded(x, z)) return false;
    const b = this.getBlock(x, y, z);
    return b !== id && b !== B.LAVA && !this._blocksFluid(b);
  }
  _flowInto(x, y, z, id, lvl) {
    const b = this.getBlock(x, y, z);
    if (id === B.LAVA && b === B.WATER) {
      this.setBlock(x, y, z, B.STONE);
      this.host.sound('fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.2);
      return;
    }
    if (b !== 0 && b !== B.WATER && b !== B.FIRE) {
      for (const s of getDrops(b, this.getMeta(x, y, z), null, this.rand)) this.host.dropItem(x + 0.5, y + 0.3, z + 0.5, s.id, s.count);
    }
    this.setBlock(x, y, z, id, lvl);
    this.schedule(x, y, z, id === B.WATER ? 5 : 30);
  }
  _flowCost(x, y, z, id, depth, from, maxDepth) {
    let best = 1000;
    for (let d = 0; d < 4; d++) {
      if (d === (from ^ 2)) continue;
      const nx = x + FACING_DX[d], nz = z + FACING_DZ[d];
      const b = this.getBlock(nx, y, nz);
      if (this._blocksFluid(b) || (b === id && this.getMeta(nx, y, nz) === 0)) continue;
      if (!this._blocksFluid(this.getBlock(nx, y - 1, nz))) return depth;
      if (depth < maxDepth) {
        const c = this._flowCost(nx, y, nz, id, depth + 1, d, maxDepth);
        if (c < best) best = c;
      }
    }
    return best;
  }
  _fluidTick(x, y, z, id) {
    const water = id === B.WATER, step = water ? 1 : 2;
    let lvl = this.getMeta(x, y, z);
    if (lvl !== 0) {
      let nl;
      if (this.getBlock(x, y + 1, z) === id) nl = 8;
      else {
        let min = 100, sources = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + FACING_DX[d], nz = z + FACING_DZ[d];
          if (this.getBlock(nx, y, nz) !== id) continue;
          let m = this.getMeta(nx, y, nz);
          if (m === 0) sources++;
          if (m >= 8) m = 0;
          if (m < min) min = m;
        }
        nl = min + step;
        if (nl >= 8 || min === 100) nl = -1;
        if (water && sources >= 2) {
          const below = this.getBlock(x, y - 1, z);
          if (SOLID[below] || (below === id && this.getMeta(x, y - 1, z) === 0)) nl = 0;
        }
      }
      if (nl !== lvl) {
        if (nl < 0) { this.setBlock(x, y, z, 0); return; }
        lvl = nl;
        this.setBlock(x, y, z, id, lvl);
      }
    }
    const below = this.getBlock(x, y - 1, z);
    if (this._canFlowInto(x, y - 1, z, id)) {
      this._flowInto(x, y - 1, z, id, lvl >= 8 ? lvl : lvl + 8);
    } else if (lvl === 0 || this._blocksFluid(below)) {
      const nl = lvl >= 8 ? 1 : lvl + step;
      if (nl >= 8) return;
      const costs = [1000, 1000, 1000, 1000];
      let best = 1000;
      const maxDepth = water ? 4 : 2;
      for (let d = 0; d < 4; d++) {
        const nx = x + FACING_DX[d], nz = z + FACING_DZ[d];
        const b = this.getBlock(nx, y, nz);
        if (this._blocksFluid(b) || (b === id && this.getMeta(nx, y, nz) === 0)) continue;
        costs[d] = this._blocksFluid(this.getBlock(nx, y - 1, nz)) ? this._flowCost(nx, y, nz, id, 1, d, maxDepth) : 0;
        if (costs[d] < best) best = costs[d];
      }
      for (let d = 0; d < 4; d++) {
        if (costs[d] !== best) continue;
        const nx = x + FACING_DX[d], nz = z + FACING_DZ[d];
        if (this._canFlowInto(nx, y, nz, id)) this._flowInto(nx, y, nz, id, nl);
      }
    }
  }
  // horizontal push direction of flowing fluid at a block (for entity drift)
  flowVector(x, y, z, out) {
    const id = this.getBlock(x, y, z);
    out[0] = out[1] = 0;
    if (!FLUID[id]) return out;
    let m = this.getMeta(x, y, z);
    if (m >= 8) m = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + FACING_DX[d], nz = z + FACING_DZ[d];
      const b = this.getBlock(nx, y, nz);
      let nm = -1;
      if (b === id) { nm = this.getMeta(nx, y, nz); if (nm >= 8) nm = 0; }
      else if (!this._blocksFluid(b) && this.getBlock(nx, y - 1, nz) === id) { nm = this.getMeta(nx, y - 1, nz); if (nm >= 8) nm = 0; nm += 8; }
      if (nm >= 0) { out[0] += FACING_DX[d] * (nm - m); out[1] += FACING_DZ[d] * (nm - m); }
    }
    const l = Math.hypot(out[0], out[1]);
    if (l > 0) { out[0] /= l; out[1] /= l; }
    return out;
  }

  // ---- ticking ----------------------------------------------------------------------
  tick() {
    this.time++;
    this.dayTime = (this.dayTime + 1) % 24000;
    // scheduled ticks
    if (this.sched.size) {
      const due = [];
      for (const [k, s] of this.sched) {
        if (s.t <= this.time) { due.push(s); this.sched.delete(k); }
      }
      for (const s of due) this._scheduledTick(s.x, s.y, s.z);
    }
    // random ticks around the player
    const R = Math.min(this.renderDist, 5);
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const c = this.chunks.get(ckey(this.pcx + dx, this.pcz + dz));
      if (!c) continue;
      for (let n = 0; n < 24; n++) {
        const i = (Math.random() * 32768) | 0;
        const id = c.blocks[i];
        if (TICKS[id]) this._randomTick(c.cx * 16 + (i >> 11), i & 127, c.cz * 16 + ((i >> 7) & 15), id, c.meta[i]);
      }
    }
    // furnaces
    for (const be of this.blockEntities.values()) if (be.type === 'furnace') this._tickFurnace(be);
  }
  _scheduledTick(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!id) return;
    const d = blocks[id];
    if (d.fluid) this._fluidTick(x, y, z, id);
    else if (d.gravity) {
      const b = this.getBlock(x, y - 1, z);
      if (y > 0 && (b === 0 || FLUID[b] || (!SOLID[b] && blocks[b].replaceable) || b === B.FIRE) && this.isLoaded(x, z)) {
        const meta = this.getMeta(x, y, z);
        this.setBlock(x, y, z, 0);
        this.host.spawnFalling(x, y, z, id, meta);
      }
    } else if (id === B.FIRE) this._fireTick(x, y, z);
  }
  _randomTick(x, y, z, id, meta) {
    switch (id) {
      case B.GRASS: {
        const above = this.getBlock(x, y + 1, z);
        if (LOPAC[above] > 2 || FLUID[above]) { this.setBlock(x, y, z, B.DIRT); break; }
        if (this.getLight(x, y + 1, z) >= 9) {
          for (let i = 0; i < 4; i++) {
            const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 5) | 0) - 3, nz = z + ((Math.random() * 3) | 0) - 1;
            if (this.getBlock(nx, ny, nz) === B.DIRT) {
              const a = this.getBlock(nx, ny + 1, nz);
              if (LOPAC[a] <= 2 && !FLUID[a] && this.getLight(nx, ny + 1, nz) >= 4) this.setBlock(nx, ny, nz, B.GRASS);
            }
          }
        }
        break;
      }
      case B.LEAVES: case B.BIRCH_LEAVES: case B.SPRUCE_LEAVES:
        if ((meta & 2) && !(meta & 1)) {
          if (this._leafConnected(x, y, z)) this.setMeta(x, y, z, meta & ~2, false);
          else this.breakNaturally(x, y, z);
        }
        break;
      case B.SAPLING: case B.BIRCH_SAPLING: case B.SPRUCE_SAPLING:
        if (this.getLight(x, y + 1, z) >= 9 && Math.random() < 0.15) {
          if (!(meta & 8)) this.setMeta(x, y, z, meta | 8, false);
          else this.growTree(x, y, z);
        }
        break;
      case B.WHEAT:
        if ((meta & 7) < 7 && this.getLight(x, y + 1, z) >= 9) {
          const wet = this.getMeta(x, y - 1, z) > 0;
          if (Math.random() < (wet ? 0.33 : 0.12)) this.setMeta(x, y, z, meta + 1);
        }
        break;
      case B.FARMLAND: {
        let water = false;
        for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4 && !water; dz++) for (let dy = 0; dy <= 1; dy++) {
          if (this.getBlock(x + dx, y + dy, z + dz) === B.WATER) { water = true; break; }
        }
        if (water) this.setMeta(x, y, z, 7);
        else if (meta > 0) this.setMeta(x, y, z, meta - 1);
        else if (this.getBlock(x, y + 1, z) !== B.WHEAT) this.setBlock(x, y, z, B.DIRT);
        break;
      }
      case B.SUGAR_CANE: case B.CACTUS:
        if (this.getBlock(x, y + 1, z) === 0) {
          let h = 1;
          while (this.getBlock(x, y - h, z) === id) h++;
          if (h < 3) {
            if (meta >= 15) { this.setBlock(x, y + 1, z, id); this.setMeta(x, y, z, 0, false); }
            else this.setMeta(x, y, z, meta + 1, false);
          }
        }
        break;
      case B.FIRE:
        this._fireTick(x, y, z);
        break;
      case B.DIRT:
        break;
    }
  }
  _fireTick(x, y, z) {
    if (this.getBlock(x, y, z) !== B.FIRE) return;
    const meta = this.getMeta(x, y, z);
    if (!this.fireCanStay(x, y, z)) { this.setBlock(x, y, z, 0); return; }
    let nearFuel = false;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      const b = this.getBlock(nx, ny, nz);
      if (!blocks[b].flammable) continue;
      nearFuel = true;
      if (Math.random() < 0.3) {
        if (b === B.TNT) { this.setBlock(nx, ny, nz, 0); this.host.spawnTNT(nx, ny, nz, 80); }
        else this.setBlock(nx, ny, nz, Math.random() < 0.6 ? B.FIRE : 0);
      }
    }
    if (meta >= 5 || (!nearFuel && meta >= 2 && Math.random() < 0.6)) { this.setBlock(x, y, z, 0); return; }
    this.setMeta(x, y, z, meta + 1, false);
    // jump to nearby air next to fuel
    for (let i = 0; i < 3; i++) {
      const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 4) | 0) - 1, nz = z + ((Math.random() * 3) | 0) - 1;
      if (this.getBlock(nx, ny, nz) !== 0) continue;
      let fuel = false;
      for (let d = 0; d < 6; d++) if (blocks[this.getBlock(nx + DX[d], ny + DY[d], nz + DZ[d])].flammable) { fuel = true; break; }
      if (fuel && Math.random() < 0.35) { this.setBlock(nx, ny, nz, B.FIRE); this.schedule(nx, ny, nz, 30 + ((Math.random() * 20) | 0)); }
    }
    this.schedule(x, y, z, 30 + ((Math.random() * 20) | 0));
  }
  growTree(x, y, z) {
    const id = this.getBlock(x, y, z);
    const type = id === B.BIRCH_SAPLING ? 1 : id === B.SPRUCE_SAPLING ? 2 : 0;
    const shape = treeShape(type, Math.random);
    for (const [dx, dy, dz, k] of shape) {
      if (k !== 0 || dy === 0) continue;
      const b = this.getBlock(x + dx, y + dy, z + dz);
      if (b !== 0 && !isLeaves(b)) return false;
    }
    for (const [dx, dy, dz, k] of shape) {
      const b = this.getBlock(x + dx, y + dy, z + dz);
      if (k === 0) this.setBlock(x + dx, y + dy, z + dz, TREE_LOG[type]);
      else if (b === 0) this.setBlock(x + dx, y + dy, z + dz, TREE_LEAVES[type]);
    }
    return true;
  }
  _tickFurnace(be) {
    const [inp, fuel, out] = be.items;
    const wasLit = be.burn > 0;
    if (be.burn > 0) be.burn--;
    const res = inp ? SMELT.get(inp.id) : undefined;
    const can = res !== undefined && (!out || (out.id === res && out.count < maxStack(res)));
    if (be.burn === 0 && can && fuel && fuelTime(fuel.id) > 0) {
      be.burn = be.burnMax = fuelTime(fuel.id);
      if (fuel.id === I.LAVA_BUCKET) be.items[1] = { id: I.BUCKET, count: 1 };
      else if (--fuel.count <= 0) be.items[1] = null;
    }
    if (be.burn > 0 && can) {
      if (++be.cook >= 200) {
        be.cook = 0;
        if (out) out.count++;
        else be.items[2] = { id: res, count: 1 };
        if (--inp.count <= 0) be.items[0] = null;
        be.xp = (be.xp || 0) + 0.35;
      }
    } else if (be.cook > 0) be.cook = can ? Math.max(0, be.cook - 2) : 0;
    const lit = be.burn > 0;
    if (lit !== wasLit) {
      const id = this.getBlock(be.x, be.y, be.z);
      if (id === B.FURNACE || id === B.FURNACE_LIT) this.setBlock(be.x, be.y, be.z, lit ? B.FURNACE_LIT : B.FURNACE, this.getMeta(be.x, be.y, be.z), 0);
    }
  }

  // ---- explosions ---------------------------------------------------------------------
  explode(x, y, z, power, source = null) {
    const hit = new Map();
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
      if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
      let dx = (i / 15) * 2 - 1, dy = (j / 15) * 2 - 1, dz = (k / 15) * 2 - 1;
      const l = Math.hypot(dx, dy, dz);
      dx /= l; dy /= l; dz /= l;
      let s = power * (0.7 + Math.random() * 0.6);
      let px = x, py = y, pz = z;
      for (; s > 0; s -= 0.225) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
        const id = this.getBlock(bx, by, bz);
        if (id) s -= (blocks[id].resist / 5 + 0.3) * 0.3;
        if (s > 0 && id) hit.set(bkey(bx, by, bz), [bx, by, bz]);
        px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
      }
    }
    this.host.explosionEffects(x, y, z, power, source);
    for (const [bx, by, bz] of hit.values()) {
      const id = this.getBlock(bx, by, bz);
      if (!id || FLUID[id]) continue;
      if (id === B.TNT) {
        this.setBlock(bx, by, bz, 0);
        this.host.spawnTNT(bx, by, bz, 10 + ((Math.random() * 20) | 0));
        continue;
      }
      const meta = this.getMeta(bx, by, bz);
      this.dropBlockEntity(bx, by, bz);
      this.setBlock(bx, by, bz, 0);
      if (Math.random() < 1 / power) for (const s of getDrops(id, meta, { tool: blocks[id].tool, tier: 3 }, this.rand)) this.host.dropItem(bx + 0.5, by + 0.5, bz + 0.5, s.id, s.count);
    }
  }

  // ---- collision & ray casting ----------------------------------------------------------
  // Appends world-space collision boxes overlapping the given AABB to out (flat array of 6).
  collectBoxes(x0, y0, z0, x1, y1, z1, out) {
    const bx0 = Math.floor(x0), bx1 = Math.floor(x1), by0 = Math.max(0, Math.floor(y0) - 1), by1 = Math.min(WH - 1, Math.floor(y1));
    const bz0 = Math.floor(z0), bz1 = Math.floor(z1);
    for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) {
      const c = this.chunkAt(x >> 4, z >> 4);
      if (!c) continue;
      const base = ((x & 15) << 11) | ((z & 15) << 7);
      for (let y = by0; y <= by1; y++) {
        const id = c.blocks[base + y];
        if (!SOLID[id]) continue;
        if (SHAPE[id] === SH.CUBE) { if (y + 1 > y0) out.push(x, y, z, x + 1, y + 1, z + 1); continue; }
        const boxes = getBoxes(id, c.meta[base + y], false, id === B.FENCE ? (dx, dz) => this.getBlock(x + dx, y, z + dz) : null);
        for (const b of boxes) {
          if (y + b[4] <= y0 || y + b[1] >= y1) continue;
          out.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        }
      }
    }
    return out;
  }
  // true if any block of the given fluid type intersects the AABB
  fluidIn(x0, y0, z0, x1, y1, z1, type) {
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
      const id = this.getBlock(x, y, z);
      if (FLUID[id] !== type) continue;
      let m = this.getMeta(x, y, z);
      if (m >= 8) m = 0;
      const top = y + 1 - (m + 1) / 9 + (this.getBlock(x, y + 1, z) === id ? 0.2 : 0);
      if (y0 < top) return true;
    }
    return false;
  }
  blockIn(x0, y0, z0, x1, y1, z1, pred) {
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
      if (pred(this.getBlock(x, y, z), x, y, z)) return true;
    }
    return false;
  }

  // Voxel ray cast. Returns {x,y,z,nx,ny,nz,id,meta,dist,hx,hy,hz} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hitFluid = false) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e30, tdy = dy !== 0 ? Math.abs(1 / dy) : 1e30, tdz = dz !== 0 ? Math.abs(1 / dz) : 1e30;
    let tmx = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : 1e30;
    let tmy = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : 1e30;
    let tmz = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : 1e30;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const id = this.getBlock(x, y, z);
      if (id) {
        const meta = this.getMeta(x, y, z);
        if (FLUID[id]) {
          if (hitFluid && meta === 0) return { x, y, z, nx, ny, nz, id, meta, dist: t, hx: ox + dx * t, hy: oy + dy * t, hz: oz + dz * t };
        } else if (SHAPE[id] === SH.CUBE) {
          return { x, y, z, nx, ny, nz, id, meta, dist: t, hx: ox + dx * t, hy: oy + dy * t, hz: oz + dz * t };
        } else {
          const boxes = getBoxes(id, meta, true, id === B.FENCE ? (ax, az) => this.getBlock(x + ax, y, z + az) : null);
          let best = null;
          for (const b of boxes) {
            const h = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, b);
            if (h && h.t <= maxDist && (!best || h.t < best.t)) best = h;
          }
          if (best) return { x, y, z, nx: best.nx, ny: best.ny, nz: best.nz, id, meta, dist: best.t, hx: ox + dx * best.t, hy: oy + dy * best.t, hz: oz + dz * best.t };
        }
      }
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }
}

// ray vs AABB (b = [x0,y0,z0,x1,y1,z1]); returns {t,nx,ny,nz} or null
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = -1e30, tmax = 1e30, nx = 0, ny = 0, nz = 0;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz;
    const lo = b[a], hi = b[a + 3];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; nx = a === 0 ? s : 0; ny = a === 1 ? s : 0; nz = a === 2 ? s : 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, nx: 0, ny: 0, nz: 0 };
  return { t: tmin, nx, ny, nz };
}
