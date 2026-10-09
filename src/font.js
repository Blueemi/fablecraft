// An original 8px pixel font. Glyph bitmaps are defined here and compiled into a real
// TrueType font at runtime, so regular DOM text can use it.
const G = {
  ' ': '...',
  '!': '#|#|#|#|#|.|#',
  '"': '#.#|#.#',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
  '$': '..#..|.####|#....|.###.|....#|####.|..#..',
  '%': '#...#|#..#.|...#.|..#..|.#...|.#..#|#...#',
  '&': '.#...|#.#..|.#...|#.#.#|#..#.|#..#.|.##.#',
  "'": '#|#',
  '(': '..#|.#.|#..|#..|#..|.#.|..#',
  ')': '#..|.#.|..#|..#|..#|.#.|#..',
  '*': '....|....|#..#|.##.|#..#',
  '+': '.....|..#..|..#..|#####|..#..|..#..',
  ',': '.|.|.|.|.|#|#|#',
  '-': '.....|.....|.....|#####',
  '.': '.|.|.|.|.|#|#',
  '/': '....#|...#.|...#.|..#..|.#...|.#...|#....',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|#####',
  '2': '.###.|#...#|....#|..##.|.#...|#...#|#####',
  '3': '.###.|#...#|....#|..##.|....#|#...#|.###.',
  '4': '...##|..#.#|.#..#|#...#|#####|....#|....#',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|#...#|....#|...#.|..#..|..#..|..#..',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ':': '.|#|#|.|.|#|#',
  ';': '.|#|#|.|.|#|#|#',
  '<': '...#|..#.|.#..|#...|.#..|..#.|...#',
  '=': '.....|.....|#####|.....|#####',
  '>': '#...|.#..|..#.|...#|..#.|.#..|#...',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '@': '.####.|#....#|#.##.#|#.#.##|#.####|#.....|.####.',
  A: '.###.|#...#|#####|#...#|#...#|#...#|#...#',
  B: '####.|#...#|####.|#...#|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|###..|#....|#....|#....|#####',
  F: '#####|#....|###..|#....|#....|#....|#....',
  G: '.####|#....|#..##|#...#|#...#|#...#|.###.',
  H: '#...#|#...#|#####|#...#|#...#|#...#|#...#',
  I: '###|.#.|.#.|.#.|.#.|.#.|###',
  J: '....#|....#|....#|....#|....#|#...#|.###.',
  K: '#...#|#..#.|###..|#..#.|#...#|#...#|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|####.|#....|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#...#|#..#.|.##.#',
  R: '####.|#...#|####.|#...#|#...#|#...#|#...#',
  S: '.####|#....|.###.|....#|....#|#...#|.###.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..',
  W: '#...#|#...#|#...#|#...#|#.#.#|##.##|#...#',
  X: '#...#|.#.#.|..#..|.#.#.|#...#|#...#|#...#',
  Y: '#...#|.#.#.|..#..|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '[': '###|#..|#..|#..|#..|#..|###',
  '\\': '#....|.#...|.#...|..#..|...#.|...#.|....#',
  ']': '###|..#|..#|..#|..#|..#|###',
  '^': '..#..|.#.#.|#...#',
  _: '.....|.....|.....|.....|.....|.....|.....|#####',
  '`': '#.|.#',
  a: '.....|.....|.###.|....#|.####|#...#|.####',
  b: '#....|#....|#.##.|##..#|#...#|#...#|####.',
  c: '.....|.....|.###.|#...#|#....|#...#|.###.',
  d: '....#|....#|.##.#|#..##|#...#|#...#|.####',
  e: '.....|.....|.###.|#...#|#####|#....|.####',
  f: '..##|.#..|####|.#..|.#..|.#..|.#..',
  g: '.....|.....|.####|#...#|#...#|.####|....#|####.',
  h: '#....|#....|#.##.|##..#|#...#|#...#|#...#',
  i: '#|.|#|#|#|#|#',
  j: '....#|.....|....#|....#|....#|#...#|#...#|.###.',
  k: '#...|#...|#..#|#.#.|##..|#.#.|#..#',
  l: '#.|#.|#.|#.|#.|#.|.#',
  m: '.....|.....|##.#.|#.#.#|#.#.#|#...#|#...#',
  n: '.....|.....|####.|#...#|#...#|#...#|#...#',
  o: '.....|.....|.###.|#...#|#...#|#...#|.###.',
  p: '.....|.....|#.##.|##..#|#...#|####.|#....|#....',
  q: '.....|.....|.##.#|#..##|#...#|.####|....#|....#',
  r: '.....|.....|#.##.|##..#|#....|#....|#....',
  s: '.....|.....|.####|#....|.###.|....#|####.',
  t: '.#.|.#.|###|.#.|.#.|.#.|..#',
  u: '.....|.....|#...#|#...#|#...#|#...#|.####',
  v: '.....|.....|#...#|#...#|#...#|.#.#.|..#..',
  w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.####',
  x: '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#',
  y: '.....|.....|#...#|#...#|#...#|.####|....#|####.',
  z: '.....|.....|#####|...#.|..#..|.#...|#####',
  '{': '..#|.#.|.#.|#..|.#.|.#.|..#',
  '|': '#|#|#|#|#|#|#',
  '}': '#..|.#.|.#.|..#|.#.|.#.|#..',
  '~': '.....|.....|.##.#|#.##.',
};

export const glyphs = {};
for (const ch in G) {
  const rows = G[ch].split('|');
  const w = rows[0].length;
  glyphs[ch] = { w, rows: rows.map((r) => [...r.padEnd(w, '.')].map((c) => c === '#')) };
}
export function textWidth(s) {
  let w = 0;
  for (const ch of s) w += ((glyphs[ch] || glyphs['?']).w + 1);
  return Math.max(0, w - 1);
}
// draw text straight onto a 2D canvas (used for the logo and other canvas-painted UI)
export function drawText(g, s, x, y, scale, color) {
  g.fillStyle = color;
  for (const ch of s) {
    const gl = glyphs[ch] || glyphs['?'];
    gl.rows.forEach((row, r) => row.forEach((on, c) => on && g.fillRect(x + c * scale, y + r * scale, scale, scale)));
    x += (gl.w + 1) * scale;
  }
}

// ---- TrueType builder ---------------------------------------------------------------
class W {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); }
  u16(v) { this.b.push((v >> 8) & 255, v & 255); }
  i16(v) { this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { this.b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  tag(s) { for (let i = 0; i < 4; i++) this.b.push(s.charCodeAt(i)); }
  pad() { while (this.b.length & 3) this.b.push(0); }
  get length() { return this.b.length; }
}
const checksum = (bytes) => {
  let s = 0;
  for (let i = 0; i < bytes.length; i += 4) s = (s + (((bytes[i] << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0)) >>> 0)) >>> 0;
  return s;
};

export function buildFont() {
  const PX = 128, EM = 1024, ASC = 7 * PX, DESC = PX;
  const chars = [];
  for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
  // glyph 0 = .notdef (empty)
  const glyphData = [{ bytes: [], adv: 4 * PX, xMin: 0, yMin: 0, xMax: 0, yMax: 0, pts: 0, cont: 0 }];
  for (const ch of chars) {
    const gl = glyphs[ch];
    const rects = [];
    const H = gl.rows.length;
    const on = (r, c) => r >= 0 && r < H && c >= 0 && c < gl.w && gl.rows[r][c];
    for (let r = 0; r < H; r++) {
      let c = 0;
      while (c < gl.w) {
        if (!on(r, c)) { c++; continue; }
        let e = c;
        while (on(r, e + 1)) e++;
        rects.push([c, r, e + 1, r + 1]);
        c = e + 1;
      }
    }
    for (let c = 0; c < gl.w; c++) {
      let r = 0;
      while (r < H) {
        if (!on(r, c)) { r++; continue; }
        let e = r;
        while (on(e + 1, c)) e++;
        if (e > r) rects.push([c, r, c + 1, e + 1]);
        r = e + 1;
      }
    }
    const adv = (ch === ' ' ? 4 : gl.w + 1) * PX;
    if (!rects.length) { glyphData.push({ bytes: [], adv, xMin: 0, yMin: 0, xMax: 0, yMax: 0, pts: 0, cont: 0 }); continue; }
    const w = new W();
    const pts = [];
    let xMin = 1e9, yMin = 1e9, xMax = -1e9, yMax = -1e9;
    for (const [c0, r0, c1, r1] of rects) {
      const x0 = c0 * PX, x1 = c1 * PX, y1 = (7 - r0) * PX, y0 = (7 - r1) * PX;
      pts.push([x0, y0], [x0, y1], [x1, y1], [x1, y0]);
      xMin = Math.min(xMin, x0); xMax = Math.max(xMax, x1); yMin = Math.min(yMin, y0); yMax = Math.max(yMax, y1);
    }
    w.i16(rects.length);
    w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
    for (let i = 0; i < rects.length; i++) w.u16(i * 4 + 3);
    w.u16(0);
    for (let i = 0; i < pts.length; i++) w.u8(1);
    let px = 0, py = 0;
    for (const p of pts) { w.i16(p[0] - px); px = p[0]; }
    for (const p of pts) { w.i16(p[1] - py); py = p[1]; }
    w.pad();
    glyphData.push({ bytes: w.b, adv, xMin, yMin, xMax, yMax, pts: pts.length, cont: rects.length });
  }
  const n = glyphData.length;
  const tables = {};
  // glyf + loca
  {
    const glyf = new W(), loca = new W();
    for (const g of glyphData) { loca.u32(glyf.length); for (const b of g.bytes) glyf.u8(b); }
    loca.u32(glyf.length);
    tables.glyf = glyf.b; tables.loca = loca.b;
  }
  const gx0 = Math.min(...glyphData.map((g) => g.xMin)), gy0 = Math.min(...glyphData.map((g) => g.yMin));
  const gx1 = Math.max(...glyphData.map((g) => g.xMax)), gy1 = Math.max(...glyphData.map((g) => g.yMax));
  const advMax = Math.max(...glyphData.map((g) => g.adv));
  {
    const w = new W();
    w.u32(0x00010000); w.u32(0x00010000); w.u32(0); w.u32(0x5f0f3cf5);
    w.u16(0x000b); w.u16(EM);
    w.u32(0); w.u32(0xd9a5e000 >>> 0); w.u32(0); w.u32(0xd9a5e000 >>> 0);
    w.i16(gx0); w.i16(gy0); w.i16(gx1); w.i16(gy1);
    w.u16(0); w.u16(8); w.i16(2); w.i16(1); w.i16(0);
    tables.head = w.b;
  }
  {
    const w = new W();
    w.u32(0x00010000); w.i16(ASC); w.i16(-DESC); w.i16(0); w.u16(advMax);
    w.i16(0); w.i16(0); w.i16(gx1); w.i16(1); w.i16(0); w.i16(0);
    w.i16(0); w.i16(0); w.i16(0); w.i16(0); w.i16(0); w.u16(n);
    tables.hhea = w.b;
  }
  {
    const w = new W();
    w.u32(0x00010000); w.u16(n);
    w.u16(Math.max(...glyphData.map((g) => g.pts))); w.u16(Math.max(...glyphData.map((g) => g.cont)));
    w.u16(0); w.u16(0); w.u16(2); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u16(0);
    tables.maxp = w.b;
  }
  {
    const w = new W();
    for (const g of glyphData) { w.u16(g.adv); w.i16(g.xMin); }
    tables.hmtx = w.b;
  }
  {
    const w = new W();
    w.u16(0); w.u16(1); w.u16(3); w.u16(1); w.u32(12);
    const segs = 2;
    w.u16(4); w.u16(16 + segs * 8); w.u16(0); w.u16(segs * 2); w.u16(4); w.u16(1); w.u16(0);
    w.u16(126); w.u16(0xffff); w.u16(0);
    w.u16(32); w.u16(0xffff);
    w.i16(1 - 32); w.u16(1);
    w.u16(0); w.u16(0);
    tables.cmap = w.b;
  }
  {
    const names = { 1: 'FablePixel', 2: 'Regular', 3: 'FablePixel-1.0', 4: 'FablePixel', 5: 'Version 1.0', 6: 'FablePixel' };
    const w = new W(), strs = new W();
    const ids = Object.keys(names).map(Number);
    w.u16(0); w.u16(ids.length); w.u16(6 + ids.length * 12);
    for (const id of ids) {
      const s = names[id];
      w.u16(3); w.u16(1); w.u16(0x409); w.u16(id); w.u16(s.length * 2); w.u16(strs.length);
      for (const ch of s) strs.u16(ch.charCodeAt(0));
    }
    tables.name = w.b.concat(strs.b);
  }
  {
    const w = new W();
    w.u32(0x00030000); w.u32(0); w.i16(-PX); w.i16(PX); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
    tables.post = w.b;
  }
  {
    const w = new W();
    const avg = Math.round(glyphData.reduce((a, g) => a + g.adv, 0) / n);
    w.u16(4); w.i16(avg); w.u16(400); w.u16(5); w.u16(0);
    w.i16(EM / 2); w.i16(EM / 2); w.i16(0); w.i16(PX); w.i16(EM / 2); w.i16(EM / 2); w.i16(0); w.i16(4 * PX);
    w.i16(PX); w.i16(3 * PX); w.i16(0);
    for (let i = 0; i < 10; i++) w.u8(0);
    w.u32(1); w.u32(0); w.u32(0); w.u32(0);
    w.tag('FBLC'); w.u16(0x40); w.u16(32); w.u16(126);
    w.i16(ASC); w.i16(-DESC); w.i16(0); w.u16(ASC); w.u16(DESC);
    w.u32(1); w.u32(0);
    w.i16(5 * PX); w.i16(7 * PX); w.u16(0); w.u16(32); w.u16(0);
    tables['OS/2'] = w.b;
  }
  const tags = Object.keys(tables).sort();
  const nt = tags.length;
  const out = new W();
  out.u32(0x00010000); out.u16(nt);
  const es = Math.floor(Math.log2(nt));
  out.u16(16 * 2 ** es); out.u16(es); out.u16(nt * 16 - 16 * 2 ** es);
  let off = 12 + nt * 16;
  const recs = [];
  for (const t of tags) {
    const b = tables[t];
    recs.push({ t, off, len: b.length, sum: checksum(b) });
    off += (b.length + 3) & ~3;
  }
  for (const r of recs) { out.tag(r.t.padEnd(4, ' ')); out.u32(r.sum); out.u32(r.off); out.u32(r.len); }
  let headOff = 0;
  for (const r of recs) {
    if (r.t === 'head') headOff = out.length;
    for (const b of tables[r.t]) out.u8(b);
    out.pad();
  }
  const bytes = new Uint8Array(out.b);
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0;
  bytes[headOff + 8] = adj >>> 24; bytes[headOff + 9] = (adj >>> 16) & 255; bytes[headOff + 10] = (adj >>> 8) & 255; bytes[headOff + 11] = adj & 255;
  return bytes.buffer;
}

export async function installFont() {
  try {
    const face = new FontFace('FablePixel', buildFont());
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (e) {
    console.warn('pixel font failed to load, falling back to monospace', e);
    return false;
  }
}
