/* =============================================================================
 * audio.js  --  procedural WebAudio. No audio files, ever.
 *
 * One short method per game event. Everything is synthesised from oscillators
 * and a noise buffer, so the whole soundtrack costs one 1-second buffer of
 * memory and no network requests.
 *
 * Browsers refuse to start an AudioContext outside a user gesture, so the
 * context is created lazily and resume() is retried on the first input. Every
 * public method is a no-op until then -- callers never have to check.
 * ========================================================================== */
'use strict';

const Audio2 = {
  ctx: null,
  master: null,
  noiseBuf: null,
  enabled: CFG.audio.enabled,
  volume: CFG.audio.volume,

  init() {
    if (Audio2.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { Audio2.enabled = false; return; }
    try {
      Audio2.ctx = new AC();
      Audio2.master = Audio2.ctx.createGain();
      Audio2.master.gain.value = Audio2.volume;
      Audio2.master.connect(Audio2.ctx.destination);
      Audio2._buildNoise();
    } catch (e) {
      console.warn('[audio] unavailable', e);
      Audio2.enabled = false;
    }
  },

  /* Called from the first pointer/key event. */
  resume() {
    Audio2.init();
    if (Audio2.ctx && Audio2.ctx.state === 'suspended') {
      Audio2.ctx.resume().catch(() => {});
    }
  },

  setVolume(v) {
    Audio2.volume = v;
    if (Audio2.master) Audio2.master.gain.value = v;
  },

  _buildNoise() {
    const ctx = Audio2.ctx;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    Audio2.noiseBuf = buf;
  },

  _ok() { return Audio2.enabled && Audio2.ctx && Audio2.ctx.state === 'running'; },

  /* ------------------------------------------------------------ primitives */

  /* A single enveloped oscillator. `slide` sweeps the frequency over the note,
   * which is what gives the gohid-spawn tone its rising dread. */
  tone(opts) {
    if (!Audio2._ok()) return;
    const ctx = Audio2.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type || 'square';
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.slide) {
      o.frequency.exponentialRampToValueAtTime(
        Math.max(20, opts.slide), t + (opts.dur || 0.2));
    }
    const vol = (opts.vol == null ? 0.3 : opts.vol);
    const atk = opts.atk == null ? 0.005 : opts.atk;
    const dur = opts.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.value = opts.filterFreq || 800;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(Audio2.master);
    o.start(t + (opts.delay || 0));
    o.stop(t + dur + 0.02 + (opts.delay || 0));
  },

  noise(opts) {
    if (!Audio2._ok()) return;
    const ctx = Audio2.ctx, t = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = Audio2.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 900, t);
    if (opts.slide) {
      f.frequency.exponentialRampToValueAtTime(
        Math.max(40, opts.slide), t + (opts.dur || 0.2));
    }
    f.Q.value = opts.q == null ? 1 : opts.q;
    const g = ctx.createGain();
    const vol = opts.vol == null ? 0.25 : opts.vol;
    const dur = opts.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(Audio2.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  /* ---------------------------------------------------------- game events */

  /* Warm, small, upward. Fires constantly, so it stays quiet and short. */
  recruit() {
    Audio2.tone({ type: 'square', freq: 520, slide: 780, dur: 0.09, vol: 0.10 });
  },

  /* An aydin is gone. This is the sound the player must learn to hate: a dry
   * downward snap with a wet noise tail. */
  capture() {
    Audio2.tone({ type: 'sawtooth', freq: 300, slide: 70, dur: 0.16, vol: 0.22,
                  filter: 'lowpass', filterFreq: 1400 });
    Audio2.noise({ freq: 1600, slide: 220, dur: 0.13, vol: 0.16, q: 0.7 });
  },

  /* The consequence. Low, rising, and long enough to be felt during the
   * telegraph -- the player should hear a new gohid coming before it exists. */
  gohidSpawn() {
    Audio2.tone({ type: 'sawtooth', freq: 55, slide: 150,
                  dur: CFG.gohid.spawnTelegraph, vol: 0.20,
                  filter: 'lowpass', filterFreq: 500, atk: 0.4 });
    Audio2.tone({ type: 'square', freq: 82, slide: 220,
                  dur: CFG.gohid.spawnTelegraph, vol: 0.07, atk: 0.5 });
  },

  /* The herd snapping inward. Needs to feel physical and satisfying, because
   * the player will press it thousands of times a run. */
  rallySnap() {
    Audio2.tone({ type: 'square', freq: 900, slide: 320, dur: 0.10, vol: 0.16 });
    Audio2.noise({ freq: 2400, slide: 500, dur: 0.14, vol: 0.13, q: 0.8 });
  },

  rallyRelease() {
    Audio2.tone({ type: 'square', freq: 340, slide: 620, dur: 0.07, vol: 0.08 });
  },

  /* Commander was touched: the herd blows apart. */
  scatter() {
    Audio2.noise({ freq: 400, slide: 2600, dur: 0.32, vol: 0.24, q: 0.5 });
    Audio2.tone({ type: 'sawtooth', freq: 180, slide: 60, dur: 0.30, vol: 0.16,
                  filter: 'lowpass', filterFreq: 900 });
  },

  /* The howler. Long, low and rising -- it has to be recognisable from
   * off-screen, because the herd will scatter before the player sees why. */
  howl() {
    Audio2.tone({ type: 'sawtooth', freq: 90, slide: 260, dur: 0.75, vol: 0.20,
                  filter: 'lowpass', filterFreq: 900, atk: 0.15 });
    Audio2.tone({ type: 'square', freq: 135, slide: 330, dur: 0.7, vol: 0.09,
                  atk: 0.2 });
    Audio2.noise({ freq: 300, slide: 1400, dur: 0.6, vol: 0.10, q: 0.6 });
  },

  /* A gohid gives up and wanders off. Small mercy, small sound. */
  banish() {
    Audio2.tone({ type: 'triangle', freq: 420, slide: 1100, dur: 0.22, vol: 0.14 });
    Audio2.noise({ freq: 1800, slide: 4000, dur: 0.20, vol: 0.08, q: 1.2 });
  },

  gameOver() {
    [0, 0.16, 0.34].forEach((d, i) => {
      Audio2.tone({ type: 'sawtooth', freq: 220 - i * 55, slide: 60 - i * 12,
                    dur: 0.7, vol: 0.18, delay: d,
                    filter: 'lowpass', filterFreq: 800 });
    });
  },

  /* Rising three-note arpeggio. Deliberately the most "positive" sound in the
   * game -- it is competing with the capture sound for the player's attention. */
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) => {
      Audio2.tone({ type: 'square', freq: f, dur: 0.18, vol: 0.15, delay: i * 0.075 });
    });
  },

  /* One chime per card as it flips in; the pitch climbs with the index so a
   * legendary chest audibly out-ranks a normal one. */
  chestCard(i) {
    Audio2.tone({ type: 'triangle', freq: 660 + i * 120, slide: 990 + i * 120,
                  dur: 0.16, vol: 0.13, delay: i * 0.09 });
  },

  chest() {
    Audio2.tone({ type: 'square', freq: 392, slide: 784, dur: 0.22, vol: 0.14 });
    Audio2.noise({ freq: 2200, slide: 600, dur: 0.25, vol: 0.10, q: 0.9 });
  },

  eventBanner() {
    Audio2.tone({ type: 'sawtooth', freq: 160, slide: 320, dur: 0.35, vol: 0.14,
                  filter: 'lowpass', filterFreq: 1200 });
    Audio2.tone({ type: 'square', freq: 640, dur: 0.12, vol: 0.09, delay: 0.1 });
  },

  /* The worst sound in the game, and it should be. A character aydin is the
   * thing the player was specifically protecting, so this is dissonant, low,
   * and longer than any other cue -- it has to cut through whatever else is
   * happening at the moment it fires. */
  characterLost() {
    Audio2.tone({ type: 'sawtooth', freq: 210, slide: 42, dur: 0.9, vol: 0.24,
                  filter: 'lowpass', filterFreq: 700 });
    Audio2.tone({ type: 'square', freq: 233, slide: 58, dur: 0.85, vol: 0.13 });
    Audio2.noise({ freq: 900, slide: 120, dur: 0.7, vol: 0.16, q: 0.5 });
    Audio2.tone({ type: 'sawtooth', freq: 104, dur: 1.1, vol: 0.16, delay: 0.16,
                  filter: 'lowpass', filterFreq: 400 });
  },

  start() {
    [523, 659, 784].forEach((f, i) => {
      Audio2.tone({ type: 'square', freq: f, dur: 0.13, vol: 0.13, delay: i * 0.07 });
    });
  },
};
