// Background worker: terrain generation, initial lighting and chunk meshing.
import { WorldGen } from './worldgen.js';
import { initLight } from './light.js';
import { meshChunk } from './mesher.js';

let gen = null;

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      gen = new WorldGen(m.seed);
      break;
    case 'gen': {
      const { blocks, meta } = gen.generate(m.cx, m.cz);
      const light = new Uint8Array(blocks.length);
      initLight(blocks, light);
      self.postMessage({ type: 'gen', cx: m.cx, cz: m.cz, gen: m.gen, blocks, meta, light }, [blocks.buffer, meta.buffer, light.buffer]);
      break;
    }
    case 'light': {
      const light = new Uint8Array(m.blocks.length);
      initLight(m.blocks, light);
      self.postMessage({ type: 'gen', cx: m.cx, cz: m.cz, gen: m.gen, blocks: m.blocks, meta: m.meta, light, saved: true }, [m.blocks.buffer, m.meta.buffer, light.buffer]);
      break;
    }
    case 'mesh': {
      const r = meshChunk(m.pb, m.pm, m.pl, m.cx, m.cz, gen.climate);
      self.postMessage({ type: 'mesh', cx: m.cx, cz: m.cz, gen: m.gen, ver: m.ver, opaque: r.opaque, trans: r.trans }, [r.opaque, r.trans]);
      break;
    }
  }
};
