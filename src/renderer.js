// WebGL2 renderer: terrain, sky, clouds, entities, particles, overlays and the first-person hand.
import { m4, Frustum, clamp, lerp } from './math.js';
import { TEX, texId, ANIM_FRAMES, B, blocks, SHAPE, SH, WH, getBoxes } from './blocks.js';
import { buildArrayData, getTex, sunImage, moonImage } from './textures.js';
import { meshSingle, FACE_SHADE } from './mesher.js';
import { items } from './items.js';
import { mulberry32, Perlin } from './noise.js';

const CHUNK_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in float a_layer;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec2 a_light;
layout(location=4) in vec3 a_color;
layout(location=5) in float a_flags;
uniform mat4 u_vp;
uniform vec3 u_offset;
uniform vec3 u_frames;
uniform float u_sun;
uniform float u_gamma;
uniform vec2 u_lightOverride;
uniform float u_fogDist;
out vec3 v_uvl;
out vec3 v_color;
out float v_dist;
out float v_nomip;
vec3 lightColor(float sky, float blk) {
  float s = sky / (4.0 - 3.0 * sky);
  float b = blk / (4.0 - 3.0 * blk);
  float f1 = u_sun * 0.95 + 0.05;
  float f2 = s * f1;
  float f3 = b * 1.5;
  float k = u_sun * 0.65 + 0.35;
  vec3 c = vec3(f2 * k + f3, f2 * k + f3 * ((f3 * 0.6 + 0.4) * 0.6 + 0.4), f2 + f3 * (f3 * f3 * 0.6 + 0.4));
  c = clamp(c * 0.96 + 0.03, 0.0, 1.0);
  vec3 inv = 1.0 - c;
  c = mix(c, 1.0 - inv * inv * inv * inv, u_gamma);
  return clamp(c * 0.96 + 0.03, 0.0, 1.0);
}
void main() {
  vec3 p = a_pos / 256.0 - 1.0 + u_offset;
  gl_Position = u_vp * vec4(p, 1.0);
  float anim = mod(a_flags, 4.0);
  float layer = a_layer + (anim > 2.5 ? u_frames.z : anim > 1.5 ? u_frames.y : anim > 0.5 ? u_frames.x : 0.0);
  v_nomip = a_flags >= 4.0 ? 1.0 : 0.0;
  v_uvl = vec3(a_uv / 128.0, layer);
  vec2 l = u_lightOverride.x >= 0.0 ? u_lightOverride : a_light;
  v_color = a_color * lightColor(l.x, l.y);
  v_dist = u_fogDist >= 0.0 ? u_fogDist : length(p);
}`;
const CHUNK_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
uniform float u_alphaTest;
uniform vec4 u_overlay;
uniform float u_alpha;
in vec3 v_uvl;
in vec3 v_color;
in float v_dist;
in float v_nomip;
out vec4 o;
void main() {
  vec4 t = v_nomip > 0.5 ? textureLod(u_tex, v_uvl, 0.0) : texture(u_tex, v_uvl);
  if (t.a < u_alphaTest) discard;
  vec3 c = mix(t.rgb * v_color, u_overlay.rgb, u_overlay.a);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(c, u_fogColor, f), t.a * u_alpha);
}`;
const MODEL_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in float a_shade;
uniform mat4 u_vp;
uniform mat4 u_model;
out vec2 v_uv;
out float v_shade;
out float v_dist;
void main() {
  vec4 p = u_model * vec4(a_pos, 1.0);
  gl_Position = u_vp * p;
  v_uv = a_uv;
  v_shade = a_shade;
  v_dist = length(p.xyz);
}`;
const MODEL_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec4 u_color;
uniform vec3 u_light;
uniform vec4 u_overlay;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
uniform float u_alphaTest;
in vec2 v_uv;
in float v_shade;
in float v_dist;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, v_uv);
  if (t.a < u_alphaTest) discard;
  vec3 c = t.rgb * u_color.rgb * u_light * v_shade;
  c = mix(c, u_overlay.rgb, u_overlay.a);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(c, u_fogColor, f), t.a * u_color.a);
}`;
const SKY_VS = `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_ndc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;
const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 u_inv;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_sunDir;
uniform vec4 u_sunset;
in vec2 v_ndc;
out vec4 o;
void main() {
  vec4 p = u_inv * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  float h = dir.y;
  vec3 col = mix(u_horizon, u_zenith, smoothstep(0.0, 0.42, h));
  vec2 a = normalize(dir.xz + vec2(1e-5)), b = normalize(u_sunDir.xz + vec2(1e-5));
  float sd = max(dot(a, b), 0.0);
  float glow = u_sunset.a * sd * sd * sd * (1.0 - smoothstep(0.0, 0.5, abs(h)));
  col = mix(col, u_sunset.rgb, glow);
  o = vec4(col, 1.0);
}`;
const PART_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_uvl;
layout(location=2) in vec4 a_color;
uniform mat4 u_vp;
out vec3 v_uvl;
out vec4 v_color;
out float v_dist;
void main() {
  gl_Position = u_vp * vec4(a_pos, 1.0);
  v_uvl = a_uvl;
  v_color = a_color;
  v_dist = length(a_pos);
}`;
const PART_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
in vec3 v_uvl;
in vec4 v_color;
in float v_dist;
out vec4 o;
void main() {
  vec4 t = textureLod(u_tex, v_uvl, 0.0);
  if (t.a * v_color.a < 0.1) discard;
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(t.rgb * v_color.rgb, u_fogColor, f), t.a * v_color.a);
}`;

// JS mirror of the shader's light curve (for entities, particles, hand)
export function lightRGB(raw, sun, gamma, out) {
  const sky = (raw >> 4) / 15, blk = (raw & 15) / 15;
  const s = sky / (4 - 3 * sky), b = blk / (4 - 3 * blk);
  const f2 = s * (sun * 0.95 + 0.05), f3 = b * 1.5, k = sun * 0.65 + 0.35;
  const c = [f2 * k + f3, f2 * k + f3 * ((f3 * 0.6 + 0.4) * 0.6 + 0.4), f2 + f3 * (f3 * f3 * 0.6 + 0.4)];
  for (let i = 0; i < 3; i++) {
    let v = clamp(c[i] * 0.96 + 0.03, 0, 1);
    const inv = 1 - v;
    v = v * (1 - gamma) + (1 - inv * inv * inv * inv) * gamma;
    out[i] = clamp(v * 0.96 + 0.03, 0, 1);
  }
  return out;
}

// Push a box (6 quads, 36 verts of [x,y,z,u,v,shade]) into a flat array.
// uv(face) -> [u0,v0,u1,v1]; faces: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
const BOX_SHADE = [0.68, 0.68, 1.0, 0.5, 0.85, 0.85];
export function pushBox(out, x0, y0, z0, x1, y1, z1, uv, shadeMul = 1) {
  const quads = [
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
  ];
  for (let f = 0; f < 6; f++) {
    const r = uv ? uv(f) : [0, 0, 1, 1];
    if (!r) continue;
    const [u0, v0, u1, v1] = r;
    const q = quads[f], s = BOX_SHADE[f] * shadeMul;
    const uvs = f === 3 ? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] : [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(q[i][0], q[i][1], q[i][2], uvs[i][0], uvs[i][1], s);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not supported by this browser');
    this.gl = gl;
    this.chunkProg = this._program(CHUNK_VS, CHUNK_FS);
    this.modelProg = this._program(MODEL_VS, MODEL_FS);
    this.skyProg = this._program(SKY_VS, SKY_FS);
    this.partProg = this._program(PART_VS, PART_FS);
    this.proj = m4.create(); this.view = m4.create(); this.vp = m4.create(); this.inv = m4.create();
    this.tmp = m4.create(); this.tmp2 = m4.create();
    this.frustum = new Frustum();
    this.cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.settings = { fov: 70, gamma: 0.35, clouds: true, bobbing: true, renderScale: 1 };
    this.fogColor = [0.7, 0.8, 1];
    this.fog = [100, 160];
    this.sun = 1;
    this.frames = [0, 0, 0];
    this.drawn = 0;
    this._initTextures();
    this._initBuffers();
    this._buildSky();
    this._buildClouds();
    this.blockMeshes = new Map();
    this.flatMeshes = new Map();
    this._light = [1, 1, 1];
    this.resize();
  }

  _program(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  _initTextures() {
    const gl = this.gl;
    const data = buildArrayData();
    this.blockTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 16, 16, TEX.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 4);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.whiteTex = this.texture2D(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const sun = sunImage(), moon = moonImage();
    this.sunTex = this.texture2D(sun.d, 32, 32);
    this.moonTex = this.texture2D(moon.d, 32, 32);
    // flat item sprite atlas (16x16 cells in a 512-wide sheet)
    const flat = [];
    for (const it of items) if (it && it.icon) flat.push(it);
    const cols = 32, rows = Math.ceil(flat.length / cols);
    const aw = cols * 16, ah = rows * 16;
    const atlas = new Uint8Array(aw * ah * 4);
    this.flatUV = new Map();
    this.flatImg = new Map();
    flat.forEach((it, i) => {
      const im = getTex(it.icon);
      const cx = (i % cols) * 16, cy = ((i / cols) | 0) * 16;
      for (let y = 0; y < 16; y++) atlas.set(im.d.subarray(y * 64, y * 64 + 64), ((cy + y) * aw + cx) * 4);
      this.flatUV.set(it.id, [cx / aw, cy / ah, 16 / aw, 16 / ah]);
      this.flatImg.set(it.id, im);
    });
    this.itemTex = this.texture2D(atlas, aw, ah);
  }
  texture2D(data, w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (data instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _initBuffers() {
    const gl = this.gl;
    this.quadIndex = gl.createBuffer();
    this.quadCap = 0;
    this._growIndex(32768);
    this.dynVbo = gl.createBuffer();
    this.dynVao = this._modelVao(this.dynVbo);
    // particles
    this.partVbo = gl.createBuffer();
    this.partVao = gl.createVertexArray();
    gl.bindVertexArray(this.partVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.bindVertexArray(null);
    this.partData = new Float32Array(6 * 10 * 1024);
    // crack / dynamic chunk-format buffer
    this.crackVbo = gl.createBuffer();
    this.crackVao = this._chunkVao(this.crackVbo);
    this.emptyVao = gl.createVertexArray();
  }
  _growIndex(quads) {
    const gl = this.gl;
    if (quads <= this.quadCap) return;
    let cap = Math.max(this.quadCap, 32768);
    while (cap < quads) cap *= 2;
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.quadCap = cap;
  }
  _chunkVao(vbo) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, 16, 6);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.UNSIGNED_BYTE, false, 16, 8);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, true, 16, 10);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.UNSIGNED_BYTE, true, 16, 12);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.UNSIGNED_BYTE, false, 16, 15);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bindVertexArray(null);
    return vao;
  }
  _modelVao(vbo) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
    return vao;
  }
  // static model mesh from a flat [x,y,z,u,v,shade] array
  createMesh(arr) {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    const vao = this._modelVao(vbo);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, arr instanceof Float32Array ? arr : new Float32Array(arr), gl.STATIC_DRAW);
    return { vao, vbo, count: arr.length / 6 };
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.settings.renderScale;
    const w = Math.max(1, Math.floor(c.clientWidth * dpr)), h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  // ---- chunk meshes ---------------------------------------------------------------
  _upload(part, ab) {
    const gl = this.gl;
    const quads = ab.byteLength / 64;
    if (!quads) {
      if (part.vbo) { gl.deleteBuffer(part.vbo); gl.deleteVertexArray(part.vao); part.vbo = null; part.vao = null; }
      part.quads = 0;
      return;
    }
    this._growIndex(quads);
    if (!part.vbo) {
      part.vbo = gl.createBuffer();
      part.vao = this._chunkVao(part.vbo);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, part.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, ab, gl.STATIC_DRAW);
    part.quads = quads;
  }
  uploadMesh(chunk, opaque, trans) {
    if (!chunk.mesh) chunk.mesh = { opaque: { vbo: null, vao: null, quads: 0 }, trans: { vbo: null, vao: null, quads: 0 } };
    this._upload(chunk.mesh.opaque, opaque);
    this._upload(chunk.mesh.trans, trans);
  }
  freeMesh(chunk) {
    const gl = this.gl;
    if (!chunk.mesh) return;
    for (const p of [chunk.mesh.opaque, chunk.mesh.trans]) {
      if (p.vbo) { gl.deleteBuffer(p.vbo); gl.deleteVertexArray(p.vao); }
    }
    chunk.mesh = null;
  }

  // ---- item meshes ------------------------------------------------------------------
  blockMesh(id, meta = 0) {
    const k = id * 16 + meta;
    let m = this.blockMeshes.get(k);
    if (!m) {
      const r = meshSingle(id, meta);
      const ab = new Uint8Array(r.opaque.byteLength + r.trans.byteLength);
      ab.set(new Uint8Array(r.opaque), 0);
      ab.set(new Uint8Array(r.trans), r.opaque.byteLength);
      m = { vbo: null, vao: null, quads: 0 };
      this._upload(m, ab.buffer);
      this.blockMeshes.set(k, m);
    }
    return m;
  }
  // extruded sprite mesh for flat items
  flatMesh(id) {
    let m = this.flatMeshes.get(id);
    if (m) return m;
    const im = this.flatImg.get(id), uv = this.flatUV.get(id);
    if (!im) return null;
    const out = [];
    const [u0, v0, us, vs] = uv;
    const t = 1 / 32;
    const q = (pts, uvs, s) => { for (const i of [0, 1, 2, 0, 2, 3]) out.push(pts[i][0], pts[i][1], pts[i][2], uvs[i][0], uvs[i][1], s); };
    q([[-0.5, -0.5, t], [0.5, -0.5, t], [0.5, 0.5, t], [-0.5, 0.5, t]], [[u0, v0 + vs], [u0 + us, v0 + vs], [u0 + us, v0], [u0, v0]], 1);
    q([[0.5, -0.5, -t], [-0.5, -0.5, -t], [-0.5, 0.5, -t], [0.5, 0.5, -t]], [[u0 + us, v0 + vs], [u0, v0 + vs], [u0, v0], [u0 + us, v0]], 0.85);
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
      if (im.alpha(px, py) < 128) continue;
      const x0 = px / 16 - 0.5, x1 = x0 + 1 / 16, y1 = 0.5 - py / 16, y0 = y1 - 1 / 16;
      const cu = u0 + ((px + 0.5) / 16) * us, cv = v0 + ((py + 0.5) / 16) * vs;
      const uvs = [[cu, cv], [cu, cv], [cu, cv], [cu, cv]];
      if (im.alpha(px - 1, py) < 128) q([[x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t]], uvs, 0.7);
      if (im.alpha(px + 1, py) < 128) q([[x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t]], uvs, 0.7);
      if (im.alpha(px, py - 1) < 128) q([[x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t]], uvs, 0.95);
      if (im.alpha(px, py + 1) < 128) q([[x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t]], uvs, 0.55);
    }
    m = this.createMesh(out);
    this.flatMeshes.set(id, m);
    return m;
  }
  isFlatItem(id) {
    return this.flatUV.has(id);
  }

  // ---- sky / clouds ---------------------------------------------------------------------
  _buildSky() {
    const r = mulberry32(10842);
    const stars = [];
    for (let i = 0; i < 1400; i++) {
      let x = r() * 2 - 1, y = r() * 2 - 1, z = r() * 2 - 1;
      const l = Math.hypot(x, y, z);
      if (l > 1 || l < 0.01) continue;
      x /= l; y /= l; z /= l;
      const s = 0.0016 + r() * 0.0026;
      // tangent basis
      let ax = -z, ay = 0, az = x;
      const al = Math.hypot(ax, az) || 1;
      ax /= al; az /= al;
      const bx = y * az - z * ay, by = z * ax - x * az, bz = x * ay - y * ax;
      const rot = r() * Math.PI, c = Math.cos(rot), sn = Math.sin(rot);
      const px = (ax * c + bx * sn) * s, py = (ay * c + by * sn) * s, pz = (az * c + bz * sn) * s;
      const qx = (bx * c - ax * sn) * s, qy = (by * c - ay * sn) * s, qz = (bz * c - az * sn) * s;
      const P = [[x - px - qx, y - py - qy, z - pz - qz], [x + px - qx, y + py - qy, z + pz - qz], [x + px + qx, y + py + qy, z + pz + qz], [x - px + qx, y - py + qy, z - pz + qz]];
      const b = 0.55 + r() * 0.45;
      for (const k of [0, 1, 2, 0, 2, 3]) stars.push(P[k][0], P[k][1], P[k][2], 0.5, 0.5, b);
    }
    this.starMesh = this.createMesh(stars);
    const quad = [];
    const s = 0.3;
    const P = [[-s, 1, -s], [s, 1, -s], [s, 1, s], [-s, 1, s]], U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) quad.push(P[k][0], P[k][1], P[k][2], U[k][0], U[k][1], 1);
    this.celestialMesh = this.createMesh(quad);
  }
  _buildClouds() {
    const N = 64, CELL = 12, TH = 4;
    const n = new Perlin(90210);
    const on = new Uint8Array(N * N);
    const wrapNoise = (x, z) => {
      // tileable noise via blending four shifted samples
      const fx = x / N, fz = z / N;
      const s = (ox, oz) => n.fbm2((x + ox) / 9, (z + oz) / 9, 3);
      return (s(0, 0) * (1 - fx) + s(-N, 0) * fx) * (1 - fz) + (s(0, -N) * (1 - fx) + s(-N, -N) * fx) * fz;
    };
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) on[x * N + z] = wrapNoise(x, z) > 0.08 ? 1 : 0;
    const at = (x, z) => on[((x + N) % N) * N + ((z + N) % N)];
    const out = [];
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
      if (!at(x, z)) continue;
      const x0 = x * CELL, z0 = z * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      pushBox(out, x0, 0, z0, x1, TH, z1, (f) => {
        if (f === 0) return at(x + 1, z) ? null : [0, 0, 1, 1];
        if (f === 1) return at(x - 1, z) ? null : [0, 0, 1, 1];
        if (f === 4) return at(x, z + 1) ? null : [0, 0, 1, 1];
        if (f === 5) return at(x, z - 1) ? null : [0, 0, 1, 1];
        return [0, 0, 1, 1];
      });
    }
    // brighten shading: clouds are only subtly shaded
    for (let i = 5; i < out.length; i += 6) out[i] = 0.7 + out[i] * 0.3;
    this.cloudMesh = this.createMesh(out);
    this.cloudSize = N * CELL;
  }

  // ---- frame ----------------------------------------------------------------------------
  // env: { world, cam:{x,y,z,yaw,pitch,fov,roll,bob:[tx,ty,rz,rx]}, underwater:0|1|2, time }
  begin(env) {
    const gl = this.gl, c = this.canvas, world = env.world;
    this.resize();
    gl.viewport(0, 0, c.width, c.height);
    const cam = env.cam;
    this.cam = cam;
    const ang = world.celestialAngle();
    const cosA = Math.cos(ang * Math.PI * 2);
    const dayF = clamp(cosA * 2 + 0.5, 0, 1);
    this.sun = clamp(cosA * 2 + 0.2, 0, 1) * 0.8 + 0.2;
    this.zenith = [0.47 * dayF, 0.655 * dayF, 1.0 * dayF];
    let fog = [0.753 * (dayF * 0.94 + 0.06), 0.847 * (dayF * 0.94 + 0.06), 1.0 * (dayF * 0.91 + 0.09)];
    const far = Math.max(48, world.renderDist * 16 - 6);
    this.fog = [far * 0.68, far];
    this.far = far;
    if (env.underwater === 1) {
      const wc = world.gen.climate.water(Math.floor(cam.x), Math.floor(cam.z));
      const k = 0.14 + 0.6 * dayF * env.eyeLight;
      fog = [((wc >> 16) & 255) / 255 * k, ((wc >> 8) & 255) / 255 * k, (wc & 255) / 255 * k];
      this.fog = [-4, 34 + 26 * env.eyeLight];
    } else if (env.underwater === 2) {
      fog = [0.6, 0.1, 0.0];
      this.fog = [0, 2.2];
    }
    this.fogColor = fog;
    this.sunset = [0, 0, 0, 0];
    if (Math.abs(cosA) <= 0.4) {
      const f3 = (cosA / 0.4) * 0.5 + 0.5;
      let f4 = 1 - (1 - Math.sin(f3 * Math.PI)) * 0.99;
      f4 *= f4;
      this.sunset = [f3 * 0.3 + 0.7, f3 * f3 * 0.7 + 0.2, 0.2, f4];
    }
    const sinA = Math.sin(ang * Math.PI * 2);
    this.sunDir = [-sinA, cosA, 0];
    this.starB = (() => { const f = clamp(1 - (cosA * 2 + 0.25), 0, 1); return f * f * 0.5; })();
    this.celAngle = ang;

    // camera matrices (camera-relative: translation is handled per draw)
    const aspect = c.width / c.height;
    m4.perspective(this.proj, (cam.fov * Math.PI) / 180, aspect, 0.05, Math.max(far, 400) * 2);
    const v = m4.identity(this.view);
    if (cam.roll) m4.rotZ(v, v, cam.roll);
    if (cam.bob) {
      m4.translate(v, v, cam.bob[0], cam.bob[1], 0);
      m4.rotZ(v, v, cam.bob[2]);
      m4.rotX(v, v, cam.bob[3]);
    }
    m4.rotX(v, v, cam.pitch);
    m4.rotY(v, v, cam.yaw + Math.PI);
    m4.mul(this.vp, this.proj, v);
    m4.invert(this.inv, this.vp);
    this.frustum.set(this.vp);

    const t = env.time;
    this.frames = [Math.floor(t / 2.5) % ANIM_FRAMES, Math.floor(t / 6) % ANIM_FRAMES, Math.floor(t / 1.2) % ANIM_FRAMES];
    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.activeTexture(gl.TEXTURE0);
    this.env = env;
    this.drawn = 0;
    this._boundModel = false;
  }

  drawSky() {
    const gl = this.gl, env = this.env;
    if (env.underwater) return;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    const s = this.skyProg;
    gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.u_inv, false, this.inv);
    gl.uniform3fv(s.u.u_zenith, this.zenith);
    gl.uniform3fv(s.u.u_horizon, this.fogColor);
    gl.uniform3fv(s.u.u_sunDir, this.sunDir);
    gl.uniform4fv(s.u.u_sunset, this.sunset);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // celestial bodies
    this.useModel();
    const p = this.modelProg;
    gl.uniform2f(p.u.u_fog, 1e9, 2e9);
    gl.uniform1f(p.u.u_alphaTest, 0.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const m = m4.identity(this.tmp);
    m4.rotZ(m, m, this.celAngle * Math.PI * 2);
    if (this.starB > 0.01) {
      gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
      this._drawModel(this.starMesh, m, [1, 1, 1, this.starB * 2], [1, 1, 1]);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.sunTex);
    this._drawModel(this.celestialMesh, m, [1, 1, 1, 1], [1, 1, 1]);
    m4.rotZ(m, m, Math.PI);
    gl.bindTexture(gl.TEXTURE_2D, this.moonTex);
    this._drawModel(this.celestialMesh, m, [1, 1, 1, 1], [1, 1, 1]);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  _chunkUniforms() {
    const gl = this.gl, p = this.chunkProg;
    gl.useProgram(p.p);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    gl.uniformMatrix4fv(p.u.u_vp, false, this.vp);
    gl.uniform3fv(p.u.u_frames, this.frames);
    gl.uniform1f(p.u.u_sun, this.sun);
    gl.uniform1f(p.u.u_gamma, this.settings.gamma);
    gl.uniform3fv(p.u.u_fogColor, this.fogColor);
    gl.uniform2fv(p.u.u_fog, this.fog);
    gl.uniform2f(p.u.u_lightOverride, -1, -1);
    gl.uniform1f(p.u.u_fogDist, -1);
    gl.uniform4f(p.u.u_overlay, 0, 0, 0, 0);
    gl.uniform1f(p.u.u_alpha, 1);
    this._boundModel = false;
    return p;
  }

  drawTerrain(pass) {
    const gl = this.gl, world = this.env.world, cam = this.cam;
    const p = this._chunkUniforms();
    if (pass === 0) {
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      gl.uniform1f(p.u.u_alphaTest, 0.5);
      this.visible = [];
      const maxD = (world.renderDist + 1) * 16;
      for (const c of world.chunks.values()) {
        if (!c.mesh) continue;
        const ox = c.cx * 16 - cam.x, oz = c.cz * 16 - cam.z;
        if (Math.abs(ox + 8) > maxD + 8 || Math.abs(oz + 8) > maxD + 8) continue;
        if (!this.frustum.box(ox, -cam.y, oz, ox + 16, WH - cam.y, oz + 16)) continue;
        this.visible.push(c);
        c._d = (ox + 8) * (ox + 8) + (oz + 8) * (oz + 8);
      }
      this.visible.sort((a, b) => a._d - b._d);
      for (const c of this.visible) {
        const m = c.mesh.opaque;
        if (!m.quads) continue;
        gl.uniform3f(p.u.u_offset, c.cx * 16 - cam.x, -cam.y, c.cz * 16 - cam.z);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
        this.drawn++;
      }
    } else {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.uniform1f(p.u.u_alphaTest, 0.02);
      for (let i = this.visible.length - 1; i >= 0; i--) {
        const c = this.visible[i], m = c.mesh && c.mesh.trans;
        if (!m || !m.quads) continue;
        gl.uniform3f(p.u.u_offset, c.cx * 16 - cam.x, -cam.y, c.cz * 16 - cam.z);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
  }

  // ---- models -----------------------------------------------------------------------------
  useModel() {
    const gl = this.gl, p = this.modelProg;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.u_vp, false, this.vp);
    gl.uniform3fv(p.u.u_fogColor, this.fogColor);
    gl.uniform2fv(p.u.u_fog, this.fog);
    gl.uniform1f(p.u.u_alphaTest, 0.1);
    gl.uniform4f(p.u.u_overlay, 0, 0, 0, 0);
    this._boundModel = true;
    return p;
  }
  _drawModel(mesh, model, color, light, overlay) {
    const gl = this.gl, p = this.modelProg;
    gl.uniformMatrix4fv(p.u.u_model, false, model);
    gl.uniform4fv(p.u.u_color, color);
    gl.uniform3fv(p.u.u_light, light);
    if (overlay) gl.uniform4fv(p.u.u_overlay, overlay);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (overlay) gl.uniform4f(p.u.u_overlay, 0, 0, 0, 0);
  }
  // draw a model-format mesh with a 2D texture. model matrix is camera-relative.
  drawMesh(mesh, model, tex, light, color = [1, 1, 1, 1], overlay = null) {
    const gl = this.gl;
    if (!this._boundModel) this.useModel();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this._drawModel(mesh, model, color, light, overlay);
  }
  // draw a block (chunk-format mesh) with a camera-relative model matrix; block centred at origin
  drawBlock(id, meta, model, lightRaw, flash = 0, vp = this.vp, fogDist = null) {
    const gl = this.gl;
    const m = this.blockMesh(id, meta);
    if (!m.quads) return;
    const p = this._chunkUniforms();
    m4.mul(this.tmp2, vp, model);
    gl.uniformMatrix4fv(p.u.u_vp, false, this.tmp2);
    gl.uniform3f(p.u.u_offset, -0.5, -0.5, -0.5);
    gl.uniform2f(p.u.u_lightOverride, (lightRaw >> 4) / 15, (lightRaw & 15) / 15);
    gl.uniform1f(p.u.u_fogDist, fogDist ?? Math.hypot(model[12], model[13], model[14]));
    gl.uniform1f(p.u.u_alphaTest, 0.1);
    if (flash > 0) gl.uniform4f(p.u.u_overlay, 1, 1, 1, flash);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
  // draw any item (block or flat sprite) centred at the model origin, 1 unit in size
  drawItem(id, model, lightRaw, vp = this.vp) {
    if (this.isFlatItem(id)) {
      const mesh = this.flatMesh(id);
      const gl = this.gl;
      if (!this._boundModel) this.useModel();
      if (vp !== this.vp) gl.uniformMatrix4fv(this.modelProg.u.u_vp, false, vp);
      gl.bindTexture(gl.TEXTURE_2D, this.itemTex);
      gl.disable(gl.CULL_FACE);
      this._drawModel(mesh, model, [1, 1, 1, 1], lightRGB(lightRaw, this.sun, this.settings.gamma, this._light));
      gl.enable(gl.CULL_FACE);
      if (vp !== this.vp) gl.uniformMatrix4fv(this.modelProg.u.u_vp, false, this.vp);
    } else if (id < 256 && blocks[id]) {
      this.drawBlock(id, 0, model, lightRaw, 0, vp, vp !== this.vp ? 0 : null);
    }
  }

  // ---- overlays -----------------------------------------------------------------------------
  drawSelection(target, progress) {
    if (!target) return;
    const gl = this.gl, cam = this.cam, world = this.env.world;
    const boxes = getBoxes(target.id, target.meta, true, target.id === B.FENCE ? (dx, dz) => world.getBlock(target.x + dx, target.y, target.z + dz) : null);
    if (!boxes.length) return;
    // crack overlay
    if (progress > 0) {
      const layer = texId('crack_0') + Math.min(9, Math.floor(progress * 10));
      const buf = new ArrayBuffer(boxes.length * 6 * 4 * 16), u16 = new Uint16Array(buf), u8 = new Uint8Array(buf);
      let n = 0;
      const e = 0.003;
      for (const b of boxes) {
        const x0 = b[0] - e, y0 = b[1] - e, z0 = b[2] - e, x1 = b[3] + e, y1 = b[4] + e, z1 = b[5] + e;
        const quads = [
          [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
          [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
          [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
        ];
        quads.forEach((q, f) => {
          for (const v of q) {
            const o = n * 16, h = o >> 1;
            u16[h] = Math.round((v[0] + 1) * 256); u16[h + 1] = Math.round((v[1] + 1) * 256); u16[h + 2] = Math.round((v[2] + 1) * 256); u16[h + 3] = layer;
            const uu = f < 2 ? v[2] : v[0], vv = f === 2 || f === 3 ? v[2] : 1 - v[1];
            u8[o + 8] = clamp(Math.round(uu * 128), 0, 128); u8[o + 9] = clamp(Math.round(vv * 128), 0, 128);
            u8[o + 10] = 255; u8[o + 11] = 255; u8[o + 12] = 255; u8[o + 13] = 255; u8[o + 14] = 255; u8[o + 15] = 4;
            n++;
          }
        });
      }
      this._growIndex(n / 4);
      const p = this._chunkUniforms();
      gl.uniform3f(p.u.u_offset, target.x - cam.x, target.y - cam.y, target.z - cam.z);
      gl.uniform1f(p.u.u_alphaTest, 0.05);
      gl.uniform2f(p.u.u_lightOverride, 1, 1);
      gl.uniform1f(p.u.u_alpha, 0.75);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -2);
      gl.depthMask(false);
      gl.bindVertexArray(this.crackVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.crackVbo);
      gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, (n / 4) * 6, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    // outline
    const out = [];
    const d = Math.hypot(target.x + 0.5 - cam.x, target.y + 0.5 - cam.y, target.z + 0.5 - cam.z);
    const w = 0.0018 * Math.max(1.5, d), e = 0.004;
    for (const b of boxes) {
      const x0 = b[0] - e, y0 = b[1] - e, z0 = b[2] - e, x1 = b[3] + e, y1 = b[4] + e, z1 = b[5] + e;
      for (const y of [y0, y1]) for (const z of [z0, z1]) pushBox(out, x0 - w, y - w, z - w, x1 + w, y + w, z + w, null);
      for (const x of [x0, x1]) for (const z of [z0, z1]) pushBox(out, x - w, y0 - w, z - w, x + w, y1 + w, z + w, null);
      for (const x of [x0, x1]) for (const y of [y0, y1]) pushBox(out, x - w, y - w, z0 - w, x + w, y + w, z1 + w, null);
    }
    const p = this.useModel();
    gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
    gl.bindVertexArray(this.dynVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.DYNAMIC_DRAW);
    const m = m4.identity(this.tmp);
    m4.translate(m, m, target.x - cam.x, target.y - cam.y, target.z - cam.z);
    gl.uniformMatrix4fv(p.u.u_model, false, m);
    gl.uniform4f(p.u.u_color, 0, 0, 0, 0.55);
    gl.uniform3f(p.u.u_light, 1, 1, 1);
    gl.uniform2f(p.u.u_fog, 1e9, 2e9);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, out.length / 6);
    gl.disable(gl.BLEND);
    gl.uniform2fv(p.u.u_fog, this.fog);
    gl.bindVertexArray(null);
  }

  drawParticles(list, alpha) {
    if (!list.length) return;
    const gl = this.gl, cam = this.cam;
    const need = list.length * 60;
    if (this.partData.length < need) this.partData = new Float32Array(need * 2);
    const d = this.partData;
    // camera right/up vectors from the view matrix
    const v = this.view;
    const rx = v[0], ry = v[4], rz = v[8], ux = v[1], uy = v[5], uz = v[9];
    let o = 0;
    const C = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, -1, 0, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
    for (const p of list) {
      const x = lerp(p.px, p.x, alpha) - cam.x, y = lerp(p.py, p.y, alpha) - cam.y, z = lerp(p.pz, p.z, alpha) - cam.z;
      const s = p.size * (p.shrink ? 1 - p.age / p.life : 1);
      for (let i = 0; i < 6; i++) {
        const c = C[i];
        d[o++] = x + (rx * c[0] + ux * c[1]) * s; d[o++] = y + (ry * c[0] + uy * c[1]) * s; d[o++] = z + (rz * c[0] + uz * c[1]) * s;
        d[o++] = p.u + c[2] * p.us; d[o++] = p.v + c[3] * p.us; d[o++] = p.layer;
        d[o++] = p.r; d[o++] = p.g; d[o++] = p.b; d[o++] = p.a;
      }
    }
    const pr = this.partProg;
    gl.useProgram(pr.p);
    this._boundModel = false;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    gl.uniformMatrix4fv(pr.u.u_vp, false, this.vp);
    gl.uniform3fv(pr.u.u_fogColor, this.fogColor);
    gl.uniform2fv(pr.u.u_fog, this.fog);
    gl.bindVertexArray(this.partVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partVbo);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, o / 10);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  drawClouds() {
    const env = this.env;
    if (!this.settings.clouds || env.underwater) return;
    const gl = this.gl, cam = this.cam;
    const p = this.useModel();
    gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
    const dayF = clamp(Math.cos(this.celAngle * Math.PI * 2) * 2 + 0.5, 0, 1);
    const col = [dayF * 0.9 + 0.1, dayF * 0.9 + 0.1, dayF * 0.85 + 0.15, 0.82];
    gl.uniform2f(p.u.u_fog, 180, 420);
    gl.uniform1f(p.u.u_alphaTest, 0.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const S = this.cloudSize;
    const scroll = env.time * 0.03;
    const baseX = cam.x + scroll, baseZ = cam.z;
    const tx = Math.floor(baseX / S), tz = Math.floor(baseZ / S);
    const fx = baseX - tx * S, fz = baseZ - tz * S;
    const y = 128.33 - cam.y;
    gl.disable(gl.CULL_FACE);
    for (const ix of fx < S / 2 ? [-1, 0] : [0, 1]) for (const iz of fz < S / 2 ? [-1, 0] : [0, 1]) {
      const m = m4.identity(this.tmp);
      m4.translate(m, m, ix * S - fx, y, iz * S - fz);
      this._drawModel(this.cloudMesh, m, col, [1, 1, 1]);
    }
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.uniform2fv(p.u.u_fog, this.fog);
    gl.uniform1f(p.u.u_alphaTest, 0.1);
  }

  // first-person projection used for the hand (fixed 70 degree fov, fresh depth)
  beginHand() {
    const gl = this.gl, c = this.canvas;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.handProj = this.handProj || m4.create();
    m4.perspective(this.handProj, (70 * Math.PI) / 180, c.width / c.height, 0.05, 10);
    return this.handProj;
  }
  // full-screen tint (damage flash, underwater, etc.) is done in DOM; nothing here.
}
