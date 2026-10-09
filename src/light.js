// Initial (chunk-local) lighting. Cross-chunk stitching happens on the main thread.
// light byte = sky << 4 | block
import { LOPAC, LEMIT, LTERM, WH } from './blocks.js';

const q = new Int32Array(1 << 18);
const QM = q.length - 1;

function spread(blocks, light, head, tail, sky) {
  while (head !== tail) {
    const i = q[head];
    head = (head + 1) & QM;
    const L = sky ? light[i] >> 4 : light[i] & 15;
    if (L <= 1 || LTERM[blocks[i]]) continue;
    const x = i >> 11, z = (i >> 7) & 15, y = i & 127;
    for (let d = 0; d < 6; d++) {
      let n;
      if (d === 0) { if (x === 15) continue; n = i + 2048; }
      else if (d === 1) { if (x === 0) continue; n = i - 2048; }
      else if (d === 2) { if (z === 15) continue; n = i + 128; }
      else if (d === 3) { if (z === 0) continue; n = i - 128; }
      else if (d === 4) { if (y === WH - 1) continue; n = i + 1; }
      else { if (y === 0) continue; n = i - 1; }
      const op = LOPAC[blocks[n]];
      if (op >= 15) continue;
      const nl = sky && d === 5 && L === 15 && op === 0 ? 15 : L - (op > 1 ? op : 1);
      const cur = sky ? light[n] >> 4 : light[n] & 15;
      if (nl > cur) {
        light[n] = sky ? (light[n] & 15) | (nl << 4) : (light[n] & 0xf0) | nl;
        q[tail] = n;
        tail = (tail + 1) & QM;
      }
    }
  }
}

export function initLight(blocks, light) {
  light.fill(0);
  let maxTop = 0;
  // sky columns
  for (let c = 0; c < 256; c++) {
    const base = c << 7;
    let lvl = 15;
    for (let y = WH - 1; y >= 0; y--) {
      const b = blocks[base + y];
      const op = LOPAC[b];
      if (lvl === 15 && op === 0) light[base + y] = 0xf0;
      else {
        lvl -= op > 1 ? op : 1;
        if (lvl <= 0) { if (y > maxTop) maxTop = y; break; }
        light[base + y] = lvl << 4;
      }
      if (LTERM[b]) { if (y > maxTop) maxTop = y; break; }
      if (y === 0) maxTop = Math.max(maxTop, 1);
    }
  }
  // seed horizontal spread: lit cells next to darker, non-opaque cells
  let tail = 0;
  const top = Math.min(WH - 1, maxTop + 1);
  for (let c = 0; c < 256; c++) {
    const base = c << 7, x = c >> 4, z = c & 15;
    for (let y = 0; y <= top; y++) {
      const i = base + y, L = light[i] >> 4;
      if (L <= 1) continue;
      if (
        (x < 15 && light[i + 2048] >> 4 < L - 1 && LOPAC[blocks[i + 2048]] < 15) ||
        (x > 0 && light[i - 2048] >> 4 < L - 1 && LOPAC[blocks[i - 2048]] < 15) ||
        (z < 15 && light[i + 128] >> 4 < L - 1 && LOPAC[blocks[i + 128]] < 15) ||
        (z > 0 && light[i - 128] >> 4 < L - 1 && LOPAC[blocks[i - 128]] < 15) ||
        (y > 0 && light[i - 1] >> 4 < L - 1 && LOPAC[blocks[i - 1]] < 15)
      ) {
        q[tail] = i;
        tail = (tail + 1) & QM;
      }
    }
  }
  spread(blocks, light, 0, tail, true);
  // block light emitters
  tail = 0;
  for (let i = 0; i < blocks.length; i++) {
    const e = LEMIT[blocks[i]];
    if (e) {
      light[i] = (light[i] & 0xf0) | e;
      q[tail] = i;
      tail = (tail + 1) & QM;
    }
  }
  if (tail) spread(blocks, light, 0, tail, false);
}
