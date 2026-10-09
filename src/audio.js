// Fully synthesised audio: every sound effect and the ambient music is generated with WebAudio.
const rnd = Math.random;
const rr = (a, b) => a + rnd() * (b - a);

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.vol = { master: 1, sfx: 1, music: 0.6 };
    this.lx = 0; this.ly = 0; this.lz = 0; this.lyaw = 0;
    this.underwater = false;
    this.musicOn = false;
    this.nextMusic = 0;
    this.musicNotesUntil = 0;
    this.last = new Map();
  }
  // must be called from a user gesture
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.filter);
    this.filter.connect(this.master);
    this.music.connect(this.master);
    this.master.connect(ctx.destination);
    // 2 seconds of white noise shared by all noise voices
    const nb = (this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate));
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    // reverb impulse for the music
    const len = ctx.sampleRate * 3.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.music);
    this.applyVolume();
  }
  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.music.gain.value = this.vol.music * 0.5;
  }
  setListener(x, y, z, yaw) {
    this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw;
  }
  setUnderwater(u) {
    if (!this.ctx || u === this.underwater) return;
    this.underwater = u;
    this.filter.frequency.setTargetAtTime(u ? 700 : 20000, this.ctx.currentTime, 0.08);
  }

  // ---- voices -------------------------------------------------------------------
  _env(g, t, a, dur, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  noise(out, t, dur, o) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    this._env(g, t, o.a ?? 0.004, dur, o.gain ?? 0.5);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, rnd() * 1.5);
    src.stop(t + dur + 0.02);
  }
  tone(out, t, dur, o) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    this._env(g, t, o.a ?? 0.005, dur, o.gain ?? 0.3);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = o.lpType || 'lowpass';
      f.frequency.value = o.lp;
      f.Q.value = o.q ?? 1;
      osc.connect(f);
      node = f;
    }
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vib; lg.gain.value = o.vibDepth ?? o.freq * 0.04;
      l.connect(lg); lg.connect(osc.frequency);
      l.start(t); l.stop(t + dur + 0.02);
    }
    if (o.trem) {
      const l = ctx.createOscillator(), lg = ctx.createGain(), tg = ctx.createGain();
      l.frequency.value = o.trem; lg.gain.value = 0.5; tg.gain.value = 0.5;
      l.connect(lg); lg.connect(tg.gain);
      node.connect(tg); node = tg;
      l.start(t); l.stop(t + dur + 0.02);
    }
    node.connect(g); g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // ---- public API ------------------------------------------------------------------
  // positional when x is given
  play(name, x, y, z, vol = 1, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.vol.sfx <= 0) return;
    let gain = vol, pan = 0;
    if (x !== undefined) {
      const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
      const d = Math.hypot(dx, dy, dz);
      const range = 16 * Math.max(1, vol);
      if (d > range) return;
      gain = Math.min(1, vol) * (1 - d / range);
      if (d > 0.5) pan = Math.max(-1, Math.min(1, ((dx * -Math.cos(this.lyaw) + dz * -Math.sin(this.lyaw)) / d) * 0.8));
    }
    // avoid stacking the exact same sound many times in one instant
    const now = ctx.currentTime, lk = this.last.get(name);
    if (lk && now - lk < 0.03) return;
    this.last.set(name, now);
    const g = ctx.createGain();
    g.gain.value = gain;
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    this._voice(name, out, now + 0.001, pitch);
  }
  ui(name) {
    this.play(name, undefined, 0, 0, 0.6, 1);
  }

  _material(m, out, t, p, kind) {
    // kind: 0 step, 1 dig/break, 2 place
    const v = kind === 0 ? 0.32 : 0.55, d = kind === 0 ? 0.8 : 1;
    switch (m) {
      case 'grass':
        this.noise(out, t, 0.13 * d, { freq: 1400 * p, to: 700 * p, q: 0.8, gain: v * 0.8, a: 0.012 });
        this.noise(out, t + 0.02, 0.09 * d, { freq: 3200 * p, q: 1.2, gain: v * 0.35, a: 0.02 });
        break;
      case 'gravel':
        for (let i = 0; i < 4; i++) this.noise(out, t + i * 0.022 + rnd() * 0.01, 0.045, { freq: rr(900, 2600) * p, q: 2.5, gain: v * 0.7 });
        this.noise(out, t, 0.12 * d, { type: 'lowpass', freq: 500 * p, gain: v * 0.5 });
        break;
      case 'sand':
        this.noise(out, t, 0.18 * d, { freq: 2400 * p, to: 1500 * p, q: 0.6, gain: v * 0.7, a: 0.03 });
        break;
      case 'snow':
        this.noise(out, t, 0.16 * d, { type: 'lowpass', freq: 1500 * p, to: 500 * p, gain: v * 0.8, a: 0.02 });
        this.noise(out, t + 0.03, 0.06, { freq: 4200 * p, q: 3, gain: v * 0.2 });
        break;
      case 'wood':
        this.tone(out, t, 0.09 * d, { type: 'triangle', freq: 230 * p, to: 150 * p, gain: v * 0.9 });
        this.noise(out, t, 0.05, { freq: 800 * p, q: 3, gain: v * 0.7 });
        break;
      case 'cloth':
        this.noise(out, t, 0.12 * d, { type: 'lowpass', freq: 700 * p, to: 300 * p, gain: v * 0.9, a: 0.01 });
        break;
      case 'glass':
        if (kind === 1) {
          for (let i = 0; i < 6; i++) this.tone(out, t + rnd() * 0.06, rr(0.08, 0.25), { freq: rr(2200, 6500) * p, gain: 0.12 });
          this.noise(out, t, 0.25, { type: 'highpass', freq: 3500, gain: 0.4 });
        } else {
          this.tone(out, t, 0.06, { freq: 2100 * p, gain: v * 0.3 });
          this.noise(out, t, 0.05, { type: 'highpass', freq: 3000, gain: v * 0.4 });
        }
        break;
      default: // stone
        this.noise(out, t, 0.07 * d, { freq: 1900 * p, q: 1.6, gain: v * 0.75 });
        this.tone(out, t, 0.06 * d, { type: 'triangle', freq: 170 * p, to: 110 * p, gain: v * 0.6 });
        this.noise(out, t, 0.03, { type: 'highpass', freq: 4500, gain: v * 0.25 });
    }
  }

  _voice(name, out, t, p) {
    const us = name.indexOf('_');
    const head = us > 0 ? name.slice(0, us) : name, tail = us > 0 ? name.slice(us + 1) : '';
    if (head === 'step') return this._material(tail, out, t, p * rr(0.9, 1.1), 0);
    if (head === 'dig') return this._material(tail, out, t, p * rr(0.75, 0.9), 1);
    if (head === 'place') return this._material(tail, out, t, p * rr(0.7, 0.85), 2);
    switch (name) {
      case 'click':
        this.noise(out, t, 0.03, { freq: 2200, q: 4, gain: 0.5 });
        this.tone(out, t, 0.04, { type: 'square', freq: 900, to: 500, gain: 0.12 });
        break;
      case 'pop':
        this.tone(out, t, 0.09, { freq: 520 * p, to: 1100 * p, gain: 0.5 });
        break;
      case 'orb':
        this.tone(out, t, 0.25, { freq: 1300 * p, gain: 0.2 });
        this.tone(out, t + 0.03, 0.3, { freq: 1950 * p, gain: 0.14 });
        break;
      case 'levelup':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(out, t + i * 0.07, 0.5, { type: 'triangle', freq: f, gain: 0.2 }));
        break;
      case 'hurt':
        this.tone(out, t, 0.2, { type: 'sawtooth', freq: 240 * p, to: 130 * p, gain: 0.45, lp: 900 });
        this.noise(out, t, 0.08, { freq: 900, q: 1, gain: 0.3 });
        break;
      case 'fall':
        this.tone(out, t, 0.14, { type: 'sine', freq: 110, to: 50, gain: 0.8 });
        this.noise(out, t, 0.1, { type: 'lowpass', freq: 600, gain: 0.5 });
        break;
      case 'eat':
        for (let i = 0; i < 2; i++) this.noise(out, t + i * 0.07, 0.06, { freq: rr(700, 1500) * p, q: 2, gain: 0.5 });
        break;
      case 'burp':
        this.tone(out, t, 0.28, { type: 'sawtooth', freq: 130, to: 70, gain: 0.4, lp: 600, vib: 28, vibDepth: 14 });
        break;
      case 'splash':
        this.noise(out, t, 0.5, { freq: 1800, to: 500, q: 0.7, gain: 0.6, a: 0.02 });
        this.noise(out, t + 0.05, 0.3, { type: 'highpass', freq: 3000, gain: 0.2, a: 0.05 });
        break;
      case 'swim':
        this.noise(out, t, 0.3, { freq: 900 * p, to: 400 * p, q: 1, gain: 0.3, a: 0.06 });
        break;
      case 'explode':
        this.noise(out, t, 1.6, { type: 'lowpass', freq: 900, to: 60, gain: 1.6, a: 0.005 });
        this.tone(out, t, 0.9, { freq: 90, to: 28, gain: 1.2 });
        this.noise(out, t, 0.25, { freq: 2500, to: 400, q: 0.5, gain: 0.6 });
        break;
      case 'fuse':
        this.noise(out, t, 1.4, { type: 'highpass', freq: 2500, to: 5000, gain: 0.3, a: 0.05 });
        break;
      case 'fizz':
        this.noise(out, t, 0.45, { type: 'highpass', freq: 3500, gain: 0.35, a: 0.01 });
        break;
      case 'fire':
        this.noise(out, t, 0.35, { freq: 700, to: 2600, q: 0.8, gain: 0.5, a: 0.05 });
        break;
      case 'bow':
        this.tone(out, t, 0.18, { type: 'triangle', freq: 420 * p, to: 160 * p, gain: 0.45 });
        this.noise(out, t, 0.12, { freq: 3000, q: 1, gain: 0.2 });
        break;
      case 'arrow_hit':
        this.tone(out, t, 0.08, { type: 'triangle', freq: 300 * p, to: 180 * p, gain: 0.5 });
        this.noise(out, t, 0.05, { freq: 1500, q: 2, gain: 0.5 });
        break;
      case 'door':
        this.tone(out, t, 0.08, { type: 'triangle', freq: 190 * p, to: 120 * p, gain: 0.6 });
        this.noise(out, t, 0.06, { freq: 600 * p, q: 2, gain: 0.5 });
        this.tone(out, t + 0.02, 0.12, { type: 'sawtooth', freq: 320 * p, to: 420 * p, gain: 0.05, lp: 1200 });
        break;
      case 'chest':
        this.tone(out, t, 0.12, { type: 'triangle', freq: 150 * p, to: 95 * p, gain: 0.6 });
        this.tone(out, t + 0.03, 0.2, { type: 'sawtooth', freq: 260 * p, to: 380 * p, gain: 0.06, lp: 1000 });
        break;
      case 'break':
        this.noise(out, t, 0.2, { freq: 1200, q: 1, gain: 0.5 });
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.03, 0.12, { freq: rr(700, 1800), gain: 0.15 });
        break;
      case 'attack':
        this.noise(out, t, 0.12, { freq: 900, to: 300, q: 0.8, gain: 0.5 });
        break;
      case 'sweep':
        this.noise(out, t, 0.15, { type: 'highpass', freq: 1200, gain: 0.25, a: 0.03 });
        break;
      // ---- animals & monsters ----
      case 'pig_say':
        for (let i = 0; i < (rnd() < 0.5 ? 1 : 2); i++) this.tone(out, t + i * 0.16, 0.13, { type: 'sawtooth', freq: 190 * p, to: 130 * p, gain: 0.4, lp: 900, q: 3, vib: 40, vibDepth: 25 });
        break;
      case 'pig_hurt':
        this.tone(out, t, 0.3, { type: 'sawtooth', freq: 480 * p, to: 300 * p, gain: 0.4, lp: 1600, q: 3, vib: 30, vibDepth: 40 });
        break;
      case 'pig_death':
        this.tone(out, t, 0.6, { type: 'sawtooth', freq: 460 * p, to: 150 * p, gain: 0.4, lp: 1400, q: 3, vib: 25, vibDepth: 40 });
        break;
      case 'cow_say':
        this.tone(out, t, 0.9, { type: 'sawtooth', freq: 125 * p, to: 95 * p, gain: 0.5, lp: 520, q: 4, vib: 5, vibDepth: 4, a: 0.12 });
        break;
      case 'cow_hurt':
        this.tone(out, t, 0.4, { type: 'sawtooth', freq: 190 * p, to: 120 * p, gain: 0.5, lp: 700, q: 4, a: 0.03 });
        break;
      case 'cow_death':
        this.tone(out, t, 0.8, { type: 'sawtooth', freq: 180 * p, to: 70 * p, gain: 0.5, lp: 600, q: 4, a: 0.03 });
        break;
      case 'sheep_say':
        this.tone(out, t, 0.6, { type: 'sawtooth', freq: 330 * p, to: 290 * p, gain: 0.4, lp: 1300, q: 2, trem: 11, a: 0.05 });
        break;
      case 'sheep_hurt':
        this.tone(out, t, 0.35, { type: 'sawtooth', freq: 420 * p, to: 330 * p, gain: 0.4, lp: 1500, q: 2, trem: 14 });
        break;
      case 'sheep_death':
        this.tone(out, t, 0.7, { type: 'sawtooth', freq: 400 * p, to: 200 * p, gain: 0.4, lp: 1300, q: 2, trem: 12 });
        break;
      case 'shear':
        this.noise(out, t, 0.08, { freq: 3000, q: 2, gain: 0.5 });
        this.noise(out, t + 0.1, 0.08, { freq: 3600, q: 2, gain: 0.5 });
        break;
      case 'chicken_say':
        for (let i = 0; i < 2 + ((rnd() * 2) | 0); i++) this.tone(out, t + i * 0.11, 0.06, { type: 'square', freq: rr(650, 800) * p, to: 950 * p, gain: 0.14, lp: 2500 });
        break;
      case 'chicken_hurt':
        this.tone(out, t, 0.2, { type: 'square', freq: 1100 * p, to: 600 * p, gain: 0.18, lp: 3000, vib: 35, vibDepth: 80 });
        break;
      case 'chicken_death':
        this.tone(out, t, 0.4, { type: 'square', freq: 1000 * p, to: 350 * p, gain: 0.18, lp: 3000, vib: 30, vibDepth: 80 });
        break;
      case 'zombie_say':
        this.tone(out, t, 1.0, { type: 'sawtooth', freq: 78 * p, to: 60 * p, gain: 0.55, lp: 380, q: 5, vib: 6, vibDepth: 5, a: 0.15 });
        this.noise(out, t, 0.9, { freq: 300, q: 1, gain: 0.12, a: 0.2 });
        break;
      case 'zombie_hurt':
        this.tone(out, t, 0.35, { type: 'sawtooth', freq: 120 * p, to: 80 * p, gain: 0.55, lp: 500, q: 4 });
        break;
      case 'zombie_death':
        this.tone(out, t, 0.9, { type: 'sawtooth', freq: 110 * p, to: 45 * p, gain: 0.55, lp: 450, q: 4 });
        break;
      case 'skeleton_say':
        for (let i = 0; i < 5; i++) this.noise(out, t + i * rr(0.05, 0.085), 0.03, { freq: rr(1600, 2600) * p, q: 6, gain: 0.5 });
        break;
      case 'skeleton_hurt':
        for (let i = 0; i < 3; i++) this.noise(out, t + i * 0.05, 0.04, { freq: rr(1100, 1700) * p, q: 5, gain: 0.6 });
        break;
      case 'skeleton_death':
        for (let i = 0; i < 8; i++) this.noise(out, t + i * 0.06 + rnd() * 0.02, 0.04, { freq: rr(900, 2200) * p * (1 - i * 0.06), q: 5, gain: 0.55 });
        break;
      case 'creeper_hurt': case 'creeper_death':
        this.noise(out, t, name === 'creeper_death' ? 0.7 : 0.35, { type: 'highpass', freq: 2200, to: 1200, gain: 0.35 });
        break;
      case 'spider_say':
        this.noise(out, t, 0.4, { freq: 3600 * p, q: 2, gain: 0.3, a: 0.05 });
        for (let i = 0; i < 4; i++) this.noise(out, t + 0.05 + i * 0.07, 0.02, { freq: 1500, q: 8, gain: 0.35 });
        break;
      case 'spider_hurt': case 'spider_death':
        this.noise(out, t, name === 'spider_death' ? 0.7 : 0.3, { freq: 3000 * p, to: 1500 * p, q: 2, gain: 0.4 });
        break;
    }
  }

  // ---- generative music --------------------------------------------------------------
  _note(freq, t, dur, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [mult, amp, type] of [[1, 1, 'sine'], [2, 0.28, 'sine'], [3, 0.1, 'sine'], [1.003, 0.4, 'triangle']]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type;
      o.frequency.value = freq * mult;
      og.gain.value = amp;
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    g.connect(lp);
    lp.connect(this.music);
    lp.connect(this.reverb);
  }
  _pad(freqs, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    for (const f of freqs) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(g);
        o.start(t); o.stop(t + dur + 0.1);
      }
    }
    g.connect(lp);
    lp.connect(this.reverb);
    lp.connect(this.music);
  }
  // schedule one gentle piece (about a minute and a half)
  _compose(t0) {
    const roots = [220, 196, 174.61, 261.63, 146.83];
    const root = roots[(rnd() * roots.length) | 0];
    const modes = [[0, 2, 4, 7, 9], [0, 2, 3, 7, 10], [0, 2, 4, 6, 7, 9, 11], [0, 3, 5, 7, 10]];
    const scale = modes[(rnd() * modes.length) | 0];
    const deg = (i) => root * Math.pow(2, (scale[((i % scale.length) + scale.length) % scale.length] + 12 * Math.floor(i / scale.length)) / 12);
    const beat = rr(0.62, 0.8);
    let t = t0, i = (rnd() * 3) | 0;
    const bars = 26 + ((rnd() * 10) | 0);
    for (let bar = 0; bar < bars; bar++) {
      const chord = [0, 2, 4].map((k) => deg(i + k - scale.length));
      if (bar % 4 === 0) this._pad(chord, t, beat * 16);
      if (bar % 2 === 0) this._note(deg(i - scale.length), t, beat * 7, 0.11);
      const n = rnd() < 0.25 ? 0 : 1 + ((rnd() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const step = [0, 1, 2, 2, 4, -1, 3][(rnd() * 7) | 0];
        const when = t + ((rnd() * 8) | 0) * (beat / 2);
        this._note(deg(i + step + (rnd() < 0.3 ? scale.length : 0)), when, beat * rr(3, 6), rr(0.06, 0.13));
        if (rnd() < 0.2) this._note(deg(i + step + 2), when + beat / 2, beat * 3, 0.05);
      }
      t += beat * 4;
      if (bar % 2 === 1) i += [0, 1, -1, 2, -2, 3][(rnd() * 6) | 0];
      if (i > 5) i -= 3;
      if (i < -4) i += 3;
    }
    return t - t0;
  }
  // call regularly (e.g. once per second)
  updateMusic(active) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (!active || this.vol.music <= 0) return;
    if (this.nextMusic === 0) this.nextMusic = now + rr(6, 14);
    if (now >= this.nextMusic) {
      const len = this._compose(now + 0.2);
      this.nextMusic = now + len + rr(50, 140);
    }
  }
}
