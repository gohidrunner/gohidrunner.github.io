/* =============================================================================
 * sprites.js  --  asset loading, pixel normalisation, and runtime tinting.
 *
 * Two rules drive this file:
 *
 * 1. ONE SPRITE PER CREATURE, RECOLOURED AT RUNTIME. Every aydin variant and
 *    every gohid variant is the same base image with a tint and a badge. No
 *    per-type art is authored.
 *
 * 2. TINTING IS DONE BY HAND, NOT BY canvas `filter`. Filters operate on
 *    premultiplied edges and leave a coloured fringe around transparent pixels,
 *    which on a 32px sprite is extremely visible. Instead we read the pixel
 *    buffer and blend only where alpha > 0, then cache the result -- tinting is
 *    far too slow to redo per frame.
 *
 * Every asset path has a procedural canvas fallback, so a missing or blocked
 * file degrades to a drawn shape rather than taking the game down.
 * ========================================================================== */
'use strict';

const Sprites = {
  base: {},        // name -> canvas, normalised to CFG.assets.pixelSize
  _tintCache: new Map(),
  ready: false,

  /* ------------------------------------------------------------ loading */

  load(onDone) {
    const names = ['gohid', 'aydin', 'commander'];
    let pending = names.length;
    const finish = () => {
      if (--pending === 0) { Sprites.ready = true; if (onDone) onDone(); }
    };

    names.forEach((name) => {
      // Prefer the base64 copy from js/assets.js. A file:// PNG taints the
      // canvas, and a tainted canvas throws on getImageData -- which every
      // tint below depends on. The data URI keeps the canvas clean, so the
      // game works opened straight off the disk with no server. Falls back to
      // the real file if assets.js has not been generated.
      const embedded = (typeof EMBEDDED !== 'undefined') ? EMBEDDED[name] : null;
      const path = embedded || CFG.assets[name];
      const img = new Image();
      let settled = false;

      const ok = () => {
        if (settled) return;
        settled = true;
        try {
          Sprites.base[name] = Sprites._normalise(img, name);
        } catch (e) {
          console.warn('[sprites] normalise failed for ' + name + ' -- using fallback', e);
          Sprites.base[name] = Sprites._fallback(name);
        }
        finish();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        console.warn('[sprites] could not load ' + path + ' -- using procedural fallback');
        Sprites.base[name] = Sprites._fallback(name);
        finish();
      };

      img.onload = ok;
      img.onerror = fail;
      img.src = path;
      // Cached images can already be complete before the handlers attach.
      if (img.complete && img.naturalWidth) ok();
    });
  },

  /* Draw the source into a pixelSize x pixelSize canvas so that photographic
   * and hand-drawn art end up sharing one pixel grid.
   *
   * The downscale runs WITH smoothing on (a proper area average) and the result
   * is drawn WITH smoothing off later. Nearest-neighbour subsampling a 125px
   * photo straight down to 32px throws away most of the pixels and turns a face
   * into noise; averaging first, then hard-scaling on draw, is what actually
   * produces clean pixel art from a photograph. */
  _normalise(img, name) {
    const S = CFG.assets.pixelSize;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;

    if (name === 'gohid' && CFG.assets.gohidCrop) {
      const c = CFG.assets.gohidCrop;
      sx = sw * c[0];
      sy = sh * c[1];
      sw = sw * c[2];
      sh = sh * c[3];
    }

    // Letterbox into a square so the sprite is never stretched.
    const side = Math.max(sw, sh);
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const dw = (sw / side) * S, dh = (sh / side) * S;
    g.drawImage(img, sx, sy, sw, sh, (S - dw) / 2, (S - dh) / 2, dw, dh);

    // Hard-threshold the alpha. Averaging leaves a halo of partial alpha around
    // the cutout; on a hard-edged sprite that halo reads as blur, and it makes
    // the tint blend look muddy right at the silhouette.
    const id = g.getImageData(0, 0, S, S);
    const d = id.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
    g.putImageData(id, 0, 0);
    return cv;
  },

  /* --------------------------------------------------------- fallbacks */

  _fallback(name) {
    const S = CFG.assets.pixelSize;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

    if (name === 'aydin') {
      px(4, 14, 24, 13, '#e7d9c1');
      px(5, 22, 22, 6, '#c6b396');
      px(11, 7, 10, 11, '#7c5e48');
      px(13, 11, 2, 2, '#ffffff');
      px(17, 11, 2, 2, '#ffffff');
      px(6, 26, 2, 4, '#5c4433');
      px(12, 26, 2, 4, '#5c4433');
      px(18, 26, 2, 4, '#5c4433');
      px(24, 26, 2, 4, '#5c4433');
    } else if (name === 'commander') {
      px(8, 13, 16, 17, '#3a607a');
      px(11, 4, 10, 10, '#e2b28c');
      px(10, 3, 12, 6, '#2c3a56');
      px(11, 16, 10, 2, '#d4943c');
      px(24, 4, 2, 26, '#84603c');
    } else {
      px(7, 6, 18, 20, '#b6705a');
      px(7, 4, 18, 6, '#2a2018');
      px(11, 13, 3, 2, '#150f0c');
      px(18, 13, 3, 2, '#150f0c');
      px(13, 20, 6, 2, '#5c2a24');
      px(5, 26, 22, 6, '#d9d4cc');
    }
    return cv;
  },

  /* ------------------------------------------------------------ tinting */

  /* Alpha-safe tint: blend `colour` into every pixel with alpha > 0, leave
   * fully transparent pixels untouched, cache by name+colour+strength.
   * Called once per distinct look, never per frame. */
  tinted(name, colour, strength) {
    const src = Sprites.base[name];
    if (!src) return null;
    if (!colour) return src;
    const amt = (strength == null) ? 0.55 : strength;
    const key = name + '|' + colour + '|' + amt.toFixed(2);
    const hit = Sprites._tintCache.get(key);
    if (hit) return hit;

    const S = src.width;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);

    const rgb = U.hexToRgb(colour);
    const id = g.getImageData(0, 0, S, S);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;               // never touch transparent px
      d[i]     = d[i]     + (rgb.r - d[i])     * amt;
      d[i + 1] = d[i + 1] + (rgb.g - d[i + 1]) * amt;
      d[i + 2] = d[i + 2] + (rgb.b - d[i + 2]) * amt;
    }
    g.putImageData(id, 0, 0);
    Sprites._tintCache.set(key, cv);
    return cv;
  },

  /* A flat silhouette of the sprite, used for the spawn-invulnerability flash
   * and for hit flashes. Same caching rules. */
  silhouette(name, colour) {
    const src = Sprites.base[name];
    if (!src) return null;
    const key = name + '|SIL|' + colour;
    const hit = Sprites._tintCache.get(key);
    if (hit) return hit;

    const S = src.width;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    const rgb = U.hexToRgb(colour);
    const id = g.getImageData(0, 0, S, S);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = rgb.r;
      d[i + 1] = rgb.g;
      d[i + 2] = rgb.b;
    }
    g.putImageData(id, 0, 0);
    Sprites._tintCache.set(key, cv);
    return cv;
  },
};
