/* =============================================================================
 * utils.js  --  small maths / helper functions. Depends only on config.js.
 * ========================================================================== */
'use strict';

const U = {

  clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
  lerp(a, b, t) { return a + (b - a) * t; },

  /* Frame-rate independent smoothing. lerp(a,b,0.1) behaves differently at
   * 30fps and 144fps; this does not. */
  damp(a, b, rate, dt) { return b + (a - b) * Math.exp(-rate * dt); },

  dist(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); },
  dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },

  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return (a + Math.random() * (b - a + 1)) | 0; },
  pick(arr) { return arr[(Math.random() * arr.length) | 0]; },
  chance(p) { return Math.random() < p; },

  /* Quantise 0..1 progress into N discrete steps. Every animation in the game
   * runs through this -- it is what makes motion read as limited-frame pixel
   * art instead of smooth CSS-style easing. */
  quantise(t, steps) {
    const s = steps || CFG.fx.animSteps;
    return Math.floor(U.clamp(t, 0, 1) * s) / s;
  },

  /* Angle helpers */
  angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },

  /* A point on the world edge, at least `min` and at most `max` away from
   * (x,y). Used to walk recruits in from off-screen. */
  edgePointNear(x, y, min, max) {
    const W = CFG.world.width, H = CFG.world.height, pad = CFG.world.edgePad;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = U.rand(min, max);
      const px = U.clamp(x + Math.cos(a) * d, pad, W - pad);
      const py = U.clamp(y + Math.sin(a) * d, pad, H - pad);
      if (U.dist(x, y, px, py) >= min * 0.8) return { x: px, y: py };
    }
    return { x: U.clamp(x + min, pad, W - pad), y: U.clamp(y, pad, H - pad) };
  },

  /* localStorage throws outright in iOS private mode -- never touch it raw. */
  storeGet(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  storeSet(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  },

  formatTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  },

  /* "12,480" -- the score is read at a glance mid-panic, so it gets separators */
  formatNum(n) {
    return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = parseInt(h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  },
};
