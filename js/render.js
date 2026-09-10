/* =============================================================================
 * render.js  --  camera, world drawing, and the in-canvas overlays.
 *
 * Pixel rules that hold everywhere in this file:
 *   - imageSmoothingEnabled is off; every sprite is drawn at integer coords.
 *   - Nothing eases smoothly. Progress values go through U.quantise so
 *     animation reads as a handful of discrete frames.
 *   - Particles are squares (see particles.js).
 *
 * Sprites are flipped by caching a mirrored canvas per source rather than by
 * ctx.scale(-1,1) per entity: with several hundred entities on screen, the
 * save/restore pairs are a real cost, and the cache is a handful of canvases.
 * ========================================================================== */
'use strict';

const Render = {
  ctx: null,
  canvas: null,
  view: { x0: 0, y0: 0, x1: 0, y1: 0 },
  camX: 0, camY: 0,
  w: 0, h: 0,               // css pixels
  zoom: 1,                  // <1 means zoomed out; see CFG.display.minVisibleWorld
  dpr: 1,                   // set by Main.resize; see the note in draw()
  _flip: new WeakMap(),
  _vignette: null,
  _vigW: 0, _vigH: 0,
  _drawList: [],

  init(canvas) {
    Render.canvas = canvas;
    Render.ctx = canvas.getContext('2d', { alpha: false });
    Render.ctx.imageSmoothingEnabled = false;
    Render.camX = Game.commander ? Game.commander.x : CFG.world.width / 2;
    Render.camY = Game.commander ? Game.commander.y : CFG.world.height / 2;
  },

  /* Recomputed whenever the canvas is sized. */
  updateZoom() {
    const D = CFG.display;
    const z = U.clamp(Render.w / D.minVisibleWorld, D.zoomMin, D.zoomMax);
    // Snap to 1/20ths so resizing cannot produce a continuous stream of
    // slightly different scales, each of which resamples every sprite edge
    // differently and makes the whole scene crawl.
    Render.zoom = Math.round(z * 20) / 20;
  },

  /* A horizontally mirrored copy of a sprite canvas, built once and reused. */
  flipped(cv) {
    if (!cv) return null;
    let f = Render._flip.get(cv);
    if (f) return f;
    f = document.createElement('canvas');
    f.width = cv.width; f.height = cv.height;
    const g = f.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(cv.width, 0);
    g.scale(-1, 1);
    g.drawImage(cv, 0, 0);
    Render._flip.set(cv, f);
    return f;
  },

  /* ---------------------------------------------------------------- camera */

  updateCamera(dt) {
    const c = Game.commander;
    if (!c) return;
    const look = CFG.display.cameraLookahead;
    const tx = c.x + c.vx * look;
    const ty = c.y + c.vy * look;
    // Exponential damp so the follow is frame-rate independent.
    const rate = CFG.display.cameraLerp * 60;
    Render.camX = U.damp(Render.camX, tx, rate, dt);
    Render.camY = U.damp(Render.camY, ty, rate, dt);

    const hw = Render.w / (2 * Render.zoom), hh = Render.h / (2 * Render.zoom);
    // Only clamp on an axis where the world is actually bigger than the view;
    // otherwise a small window would pin the camera to a corner.
    if (CFG.world.width > hw * 2) Render.camX = U.clamp(Render.camX, hw, CFG.world.width - hw);
    else Render.camX = CFG.world.width / 2;
    if (CFG.world.height > hh * 2) Render.camY = U.clamp(Render.camY, hh, CFG.world.height - hh);
    else Render.camY = CFG.world.height / 2;
  },

  /* ------------------------------------------------------------------ draw */

  draw() {
    const ctx = Render.ctx;
    if (!ctx) return;
    const w = Render.w, h = Render.h;

    let sx = 0, sy = 0;
    if (Game.shake > 0.1) {
      // Quantised to whole pixels -- sub-pixel shake on pixel art just blurs.
      sx = Math.round(U.rand(-Game.shake, Game.shake));
      sy = Math.round(U.rand(-Game.shake, Game.shake));
    }

    // World units visible on screen, which is larger than the CSS size when
    // zoomed out. Every camera and culling calculation works in these units.
    const z = Render.zoom;
    const vw = w / z, vh = h / z;

    const ox = Math.round(vw / 2 - Render.camX) + sx;
    const oy = Math.round(vh / 2 - Render.camY) + sy;

    const v = Render.view;
    v.x0 = -ox - 64; v.y0 = -oy - 64;
    v.x1 = -ox + vw + 64; v.y1 = -oy + vh + 64;

    // Draw in CSS pixels by re-applying the DPR scale. Resetting to the
    // identity here instead would paint a w*h CSS-pixel rectangle onto a
    // (w*dpr)*(h*dpr) backing store, leaving unpainted bands down the right
    // and bottom edges. Invisible at DPR 1, which is why this only ever shows
    // up on a phone -- where the cap makes DPR 1.5.
    ctx.setTransform(Render.dpr, 0, 0, Render.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = CFG.palette.world.void;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.scale(z, z);
    ctx.translate(ox, oy);

    Render._drawFloor(ctx, v);
    Render._drawTelegraphs(ctx);
    Render._drawRallyRing(ctx);
    Pickups.draw(ctx, v);        // ground items and chests, under everything
    Tools.draw(ctx, v);          // smoke, walls, decoys, escorts
    Particles.draw(ctx, v);
    Render._drawEntities(ctx, v);

    ctx.restore();

    Render._drawOverlays(ctx, w, h);
  },

  /* Floor is a tile grid culled to the camera. At 4000x3000 with 64px tiles
   * that is ~2900 tiles, of which maybe 250 are ever visible. */
  _drawFloor(ctx, v) {
    const T = CFG.world.tile;
    // The arena owns the floor palette, so switching maps is a data change.
    const P = (typeof Arenas !== 'undefined') ? Arenas.palette() : CFG.palette;
    const x0 = Math.max(0, Math.floor(v.x0 / T));
    const x1 = Math.min(Math.ceil(CFG.world.width / T), Math.ceil(v.x1 / T));
    const y0 = Math.max(0, Math.floor(v.y0 / T));
    const y1 = Math.min(Math.ceil(CFG.world.height / T), Math.ceil(v.y1 / T));

    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        ctx.fillStyle = ((tx + ty) & 1) ? P.floorA : P.floorB;
        ctx.fillRect(tx * T, ty * T, T, T);
      }
    }

    // Decor from a positional hash, so it is stable across frames without
    // storing anything: same tile, same tuft, every time.
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const hsh = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        if ((hsh & 7) > 2) continue;
        const px = tx * T + (hsh >> 3 & 31) + 8;
        const py = ty * T + (hsh >> 8 & 31) + 8;
        ctx.fillStyle = (hsh & 1) ? P.decor : P.decor2;
        const s = 3 + (hsh >> 13 & 1) * 2;
        ctx.fillRect(px, py, s, s);
        ctx.fillRect(px + s, py - 2, 2, 2);
      }
    }

    // World bounds, so the edge of the map is legible before you hit it.
    ctx.strokeStyle = P.edge || CFG.palette.world.edge;
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, CFG.world.width, CFG.world.height);

    if (typeof Arenas !== 'undefined') Arenas.drawWalls(ctx, v);
  },

  /* The 1.5s warning before a captured aydin becomes a hunter. */
  _drawTelegraphs(ctx) {
    const dur = CFG.gohid.spawnTelegraph;
    for (let i = 0; i < Game.pending.length; i++) {
      const p = Game.pending[i];
      const t = U.quantise(p.t / dur, 6);
      const r = 8 + (1 - t) * 70;
      ctx.globalAlpha = 0.35 + t * 0.5;
      ctx.strokeStyle = CFG.palette.gohidTint;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // A filling core, so the ring reads as a countdown rather than a pulse.
      ctx.globalAlpha = 0.25 + t * 0.55;
      ctx.fillStyle = CFG.palette.gohidTint;
      const cs = Math.round(4 + t * 12);
      ctx.fillRect(Math.round(p.x - cs / 2), Math.round(p.y - cs / 2), cs, cs);
    }
    ctx.globalAlpha = 1;
  },

  /* The commander's cohesion radius, drawn faintly so the player can always
   * see the shape of their own herd -- this is the readout that makes rally a
   * decision rather than a guess. */
  _drawRallyRing(ctx) {
    const c = Game.commander;
    if (!c) return;
    ctx.save();
    ctx.globalAlpha = Game.rallying ? 0.30 : 0.13;
    ctx.strokeStyle = Game.rallying ? CFG.palette.world.rallyRing
                                    : CFG.palette.world.herdRing;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Game.cohesionRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  _drawEntities(ctx, v) {
    const list = Render._drawList;
    list.length = 0;

    for (let i = 0; i < Game.aydins.length; i++) {
      const a = Game.aydins[i];
      if (a.x < v.x0 || a.x > v.x1 || a.y < v.y0 || a.y > v.y1) continue;
      list.push(a);
    }
    for (let i = 0; i < Game.gohids.length; i++) {
      const g = Game.gohids[i];
      if (g.x < v.x0 || g.x > v.x1 || g.y < v.y0 || g.y > v.y1) continue;
      list.push(g);
    }
    if (Game.commander) list.push(Game.commander);

    // Depth sort: things lower on screen draw in front.
    list.sort((p, q) => p.y - q.y);

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e instanceof Gohid) Render._drawGohid(ctx, e);
      else if (e instanceof Aydin) Render._drawAydin(ctx, e);
      else Render._drawCommander(ctx, e);
    }
  },

  _shadow(ctx, x, y, w) {
    ctx.fillStyle = CFG.palette.world.shadow;
    ctx.fillRect(Math.round(x - w / 2), Math.round(y - 2), Math.round(w), 4);
    ctx.globalAlpha = 1;
  },

  /* Bob is quantised into whole pixels: a smooth sine bob on a 26px sprite
   * looks like it is sliding, a stepped one looks like it is walking. */
  _bob(e) {
    const s = Math.sin(e.bob);
    return Math.round(s * CFG.fx.bobAmount);
  },

  _drawAydin(ctx, a) {
    const size = CFG.aydin.sprite;
    const x = Math.round(a.x - size / 2);
    const y = Math.round(a.y - size + 6) + Render._bob(a);

    Render._shadow(ctx, a.x, a.y, size * 0.55);

    let cv;
    if (a.invuln > 0) {
      // Newly recruited: flashes white and cannot be taken. Flashing is
      // quantised so it strobes in steps rather than pulsing smoothly.
      const on = (Math.floor(a.invuln * 12) & 1) === 0;
      cv = on ? Sprites.silhouette('aydin', CFG.palette.world.invulnFlash)
              : Sprites.tinted('aydin', null);
    } else if (a.character) {
      // Named aydins carry their own colour so they can be picked out of a
      // crowd of a hundred identical ones at a glance.
      cv = Sprites.tinted('aydin', a.character.colour, 0.42);
    } else if (a.panic > 0) {
      cv = Sprites.tinted('aydin', CFG.palette.world.panicTint,
                          CFG.palette.world.panicAmt);
    } else {
      cv = Sprites.tinted('aydin', null);
    }
    if (!cv) return;
    ctx.drawImage(a.face < 0 ? Render.flipped(cv) : cv, x, y, size, size);
    if (a.character) Render._badge(ctx, a.character.badge, a.x, y - 4,
                                   a.character.colour);
  },

  /* A one-character marker above a sprite, drawn with the pixel font at a
   * whole-pixel position so it does not blur. */
  _badge(ctx, ch, wx, wy, colour) {
    ctx.font = '10px "Gohid Pixel", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = CFG.palette.ink;
    ctx.fillText(ch, Math.round(wx) + 1, Math.round(wy) + 1);
    ctx.fillStyle = colour || CFG.palette.text;
    ctx.fillText(ch, Math.round(wx), Math.round(wy));
    ctx.textAlign = 'left';
  },

  _drawGohid(ctx, g) {
    const size = CFG.gohid.sprite * (g.sizeMul || 1);
    const x = Math.round(g.x - size / 2);
    const y = Math.round(g.y - size + 6) + Render._bob(g);

    Render._shadow(ctx, g.x, g.y, size * 0.5);

    let cv;
    if (g.spawnFlash > 0 && (Math.floor(g.spawnFlash * 16) & 1) === 0) {
      cv = Sprites.silhouette('gohid', CFG.palette.world.invulnFlash);
    } else if (g.stunT > 0 || g.rootT > 0) {
      // Disabled gohids go cold. A tool that stops one has to be legible at a
      // glance or the player cannot tell it worked.
      cv = Sprites.tinted('gohid', CFG.palette.rally, 0.5);
    } else if (g.blindT > 0) {
      cv = Sprites.tinted('gohid', '#8d86a8', 0.55);
    } else {
      // Strong tint: both sprites are dark-haired head-and-shoulders photos
      // and read almost identically at this size without it. Each variant
      // recolours the same sprite -- no per-variant art is authored.
      const v = Variants.cfg(g.variant);
      cv = Sprites.tinted('gohid', v.tint,
                          g.leaving ? 0.22 : (v.tintAmt || CFG.palette.gohidTintAmt));
    }
    if (!cv) return;
    // Stalkers are barely there until they are close, or until a lantern is
    // lit. Quantised so they fade in as steps rather than a smooth reveal.
    const va = Variants.alphaFor(g);
    ctx.globalAlpha = g.leaving ? 0.5 : U.quantise(va, 4) || va;
    ctx.drawImage(g.face < 0 ? Render.flipped(cv) : cv, x, y, size, size);
    ctx.globalAlpha = 1;

    // The badge. Colour alone is not enough: several variant tints are close
    // together at this size, and a colourblind player has nothing else to go
    // on. Drawn as blocky pixels rather than text so it stays crisp.
    const badge = Variants.cfg(g.variant).badge;
    if (badge && va > 0.5) Render._badge(ctx, badge, g.x, y - 4);

    if (g.rootT > 0 || g.stunT > 0 || g.slowT > 0) {
      const mark = (g.stunT > 0) ? CFG.palette.rally
                 : (g.rootT > 0) ? '#cbbf9a' : '#9fd8ff';
      ctx.fillStyle = mark;
      ctx.fillRect(Math.round(g.x - 6), Math.round(y - 6), 12, 3);
    }
  },

  _drawCommander(ctx, c) {
    const size = CFG.commander.sprite;
    const x = Math.round(c.x - size / 2);
    const y = Math.round(c.y - size + 6) + Render._bob(c);
    Render._shadow(ctx, c.x, c.y, size * 0.5);
    const cv = Sprites.tinted('commander', null);
    if (!cv) return;
    ctx.drawImage(c.face < 0 ? Render.flipped(cv) : cv, x, y, size, size);
  },

  /* ------------------------------------------------------------- overlays */

  _drawOverlays(ctx, w, h) {
    // Rally desaturates the world very slightly -- a quiet signal that the
    // game has changed mode, read peripherally rather than looked at.
    if (Game.rallying) {
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = CFG.rally.desaturate;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = prev;
    }

    // Limited vision: a hard-edged darkness ring rather than a soft gradient,
    // so it reads as pixel art rather than a blur filter.
    const vis = (typeof Events !== 'undefined') ? Events.visionRadius() : 0;
    if (vis > 0) Render._drawVision(ctx, w, h, vis);

    if (Game.flash > 0.01) {
      ctx.globalAlpha = U.quantise(Game.flash, 4) * 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    if (Game.hitFlash > 0.01) {
      ctx.globalAlpha = U.quantise(Game.hitFlash, 4) * 0.20;
      ctx.fillStyle = CFG.palette.world.hitFlash;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    if (!Render._vignette || Render._vigW !== w || Render._vigH !== h) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36,
                                         w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(10,14,8,0.42)');
      Render._vignette = g;
      Render._vigW = w; Render._vigH = h;
    }
    ctx.fillStyle = Render._vignette;
    ctx.fillRect(0, 0, w, h);

    if (Input.stick.active) Render._drawStick(ctx);
  },

  /* Darkness outside a radius around the commander.
   *
   * Built on an OFFSCREEN canvas and then drawn over the scene. The obvious
   * version -- fill the main canvas dark, then punch the hole with
   * destination-out -- does not work: a 2D canvas has no layers, so
   * destination-out erases the GAME as well as the overlay, and the hole comes
   * out blacker than the surround. That is exactly what it did, and it went
   * unnoticed because vision is only used by one arena and one 1-in-6 run
   * modifier.
   *
   * The mask only changes when the viewport or the radius changes, so it is
   * cached and the per-frame cost is a single drawImage. */
  _visionMask(w, h, radius) {
    if (Render._visCanvas && Render._visW === w && Render._visH === h
        && Render._visR === radius) {
      return Render._visCanvas;
    }
    const cv = Render._visCanvas || document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(6,5,10,0.92)';
    g.fillRect(0, 0, w, h);

    // Punch the hole. Safe here: this canvas holds nothing but the overlay.
    // Stepped rings give a hard pixel edge rather than a smooth vignette.
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      g.globalAlpha = 0.30 + i * 0.18;
      g.beginPath();
      g.arc(w / 2, h / 2, radius * (1 - i * 0.055), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    Render._visCanvas = cv;
    Render._visW = w; Render._visH = h; Render._visR = radius;
    return cv;
  },

  _drawVision(ctx, w, h, radius) {
    // Radius is in world units; the mask is in screen pixels.
    const r = Math.round(radius * Render.zoom);
    ctx.drawImage(Render._visionMask(Math.round(w), Math.round(h), r), 0, 0);
  },

  /* The floating stick is drawn where the thumb actually landed. */
  _drawStick(ctx) {
    const s = Input.stick;
    const R = CFG.input.joystickRadius;
    const dx = s.cx - s.ox, dy = s.cy - s.oy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const cl = Math.min(len, R);
    const kx = s.ox + (dx / len) * cl, ky = s.oy + (dy / len) * cl;

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = CFG.palette.world.stick;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.ox, s.oy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = CFG.palette.world.stick;
    ctx.fillRect(Math.round(kx - 13), Math.round(ky - 13), 26, 26);
    ctx.globalAlpha = 1;
  },
};
