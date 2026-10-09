// World persistence in IndexedDB: world metadata + run-length-encoded modified chunks.
const DB_NAME = 'fablecraft', DB_VER = 1;

function rle(a) {
  const out = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (n < 255 && i + n < a.length && a[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
  return new Uint8Array(out);
}
function unrle(a, size) {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < a.length; i += 2) {
    out.fill(a[i + 1], o, o + a[i]);
    o += a[i];
  }
  return out;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class Save {
  constructor() {
    this.db = null;
    this.pending = new Map();
    this.ok = true;
  }
  async open() {
    if (this.db || !this.ok) return this.db;
    try {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      this.db = await req(r);
    } catch (e) {
      console.warn('IndexedDB unavailable - worlds will not be saved', e);
      this.ok = false;
    }
    return this.db;
  }
  async listWorlds() {
    const db = await this.open();
    if (!db) return [];
    return req(db.transaction('worlds').objectStore('worlds').getAll());
  }
  async putWorld(meta) {
    const db = await this.open();
    if (!db) return;
    return req(db.transaction('worlds', 'readwrite').objectStore('worlds').put(meta));
  }
  async deleteWorld(id) {
    const db = await this.open();
    if (!db) return;
    const tx = db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound(id + ':', id + ':￿'));
    return new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  }
  async chunkKeys(id) {
    const db = await this.open();
    const set = new Set();
    if (!db) return set;
    const keys = await req(db.transaction('chunks').objectStore('chunks').getAllKeys(IDBKeyRange.bound(id + ':', id + ':￿')));
    for (const k of keys) set.add(k.slice(id.length + 1));
    return set;
  }
  async getChunk(id, cx, cz, size) {
    const k = `${id}:${cx},${cz}`;
    let rec = this.pending.get(k);
    if (!rec) {
      const db = await this.open();
      if (!db) return null;
      rec = await req(db.transaction('chunks').objectStore('chunks').get(k));
    }
    if (!rec) return null;
    return { blocks: unrle(rec.b, size), meta: unrle(rec.m, size) };
  }
  putChunk(id, cx, cz, blocks, meta) {
    const k = `${id}:${cx},${cz}`;
    const rec = { b: rle(blocks), m: rle(meta) };
    this.pending.set(k, rec);
    this.open().then((db) => {
      if (!db) return;
      const tx = db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').put(rec, k);
      tx.oncomplete = () => { if (this.pending.get(k) === rec) this.pending.delete(k); };
    });
  }
}
