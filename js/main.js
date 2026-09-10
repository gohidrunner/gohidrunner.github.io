/* =============================================================================
 * main.js  --  bootstrap, canvas sizing, and the frame loop.
 *
 * Loaded LAST; everything else must already exist when this runs.
 *
 * Four defensive measures live here, all of them for failures that only show up
 * on real devices:
 *
 * 1. THE FRAME BODY IS WRAPPED IN try/catch. An uncaught throw inside a
 *    requestAnimationFrame callback does not just log -- it kills the loop
 *    permanently, and the game freezes with no way back. Catching lets one bad
 *    frame be survivable.
 *
 * 2. SIZE IS POLLED, NOT LISTENED FOR. Mobile browsers resize the visual
 *    viewport when the URL bar slides away without reliably firing `resize`,
 *    which leaves the canvas the wrong size and every touch coordinate offset.
 *
 * 3. CONTEXT LOSS IS HANDLED. Backgrounding a tab on a memory-pressured phone
 *    can drop the 2D context; drawing into a lost context throws every frame.
 *
 * 4. devicePixelRatio IS CAPPED on touch devices. A DPR-3 phone otherwise
 *    renders ~9x the pixels of a DPR-1 screen for no visible gain.
 * ========================================================================== */
'use strict';

const Main = {
  canvas: null,
  last: 0,
  raf: 0,
  fps: 60,
  _fpsAccum: 0,
  _fpsFrames: 0,
  contextLost: false,
  cssW: 0, cssH: 0, dpr: 1,

  boot() {
    Main.canvas = document.getElementById('game');
    if (!Main.canvas) { console.error('[main] no canvas'); return; }

    Main.canvas.addEventListener('contextlost', Main._onContextLost);
    Main.canvas.addEventListener('contextrestored', Main._onContextRestored);

    Main.resize(true);
    Save.load();
    Music.init();
    Upgrades.init();          // build the id index before anything resets
    Characters.init();
    Arenas.reset();
    Audio2.enabled = Save.settings.sfx;
    Audio2.volume = Save.settings.volume;
    Game.init();
    Render.init(Main.canvas);
    Minimap.init();
    HUD.init();
    UI.init();
    Input.init(Main.canvas, () => { Audio2.resume(); Music.unlock(); });

    Sprites.load(() => {
      UI.show('menu');
      Game.attract();
      Music.play('menu');
      Main.last = performance.now();
      Main.raf = requestAnimationFrame(Main.frame);
    });
  },

  /* ------------------------------------------------------------ canvas size */

  resize(force) {
    const cv = Main.canvas;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const touch = Input.touchEnabled ||
                  ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const cap = touch ? CFG.display.maxDprTouch : CFG.display.maxDprDesktop;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);

    if (!force && cssW === Main.cssW && cssH === Main.cssH && dpr === Main.dpr) return;

    Main.cssW = cssW; Main.cssH = cssH; Main.dpr = dpr;
    cv.width = Math.max(1, Math.round(cssW * dpr));
    cv.height = Math.max(1, Math.round(cssH * dpr));
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';

    Render.w = cssW;
    Render.h = cssH;
    Render.updateZoom();
    Minimap.resize();          // its own DPR, independent of the main canvas
    Render.dpr = dpr;                    // Render.draw() re-applies this
    Render._vignette = null;             // regenerate at the new size

    const ctx = cv.getContext('2d', { alpha: false });
    if (ctx) {
      // Draw in CSS pixels; the DPR scale is applied once, here.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
  },

  _onContextLost(e) {
    e.preventDefault();
    Main.contextLost = true;
    console.warn('[main] 2d context lost -- pausing draw');
  },

  _onContextRestored() {
    Main.contextLost = false;
    Main.resize(true);
    Render.init(Main.canvas);
    console.warn('[main] 2d context restored');
  },

  /* ------------------------------------------------------------------ frame */

  frame(now) {
    Main.raf = requestAnimationFrame(Main.frame);
    try {
      let dt = (now - Main.last) / 1000;
      Main.last = now;
      // Clamp: a backgrounded tab returns with a multi-second dt, which would
      // teleport every entity across the map in a single step.
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05;

      Main._fpsAccum += dt;
      Main._fpsFrames++;
      if (Main._fpsAccum >= 0.4) {
        Main.fps = Main._fpsFrames / Main._fpsAccum;
        Main._fpsAccum = 0;
        Main._fpsFrames = 0;
      }

      // Polled rather than event-driven; see note 2 at the top of the file.
      Main.resize(false);

      Game.update(dt);
      Render.updateCamera(dt);

      if (!Main.contextLost) {
        // Always clear at the true pixel size: on a mid-frame viewport change
        // the backing store can be larger than the transform implies, leaving
        // an un-cleared band of last frame's pixels along the edge.
        const ctx = Render.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, Main.canvas.width, Main.canvas.height);
        ctx.restore();
        Render.draw();
      }

      if (Game.state === 'playing' && !UI.paused) {
        HUD.update(dt, Main.fps);
        Minimap.update(dt);
      }
      UI.updateBanners(dt);
      Music.duck(UI.paused || Game.state !== 'playing');
      Music.update(dt);
      Main._checkDeath();

    } catch (err) {
      // One bad frame must not end the run.
      console.error('[main] frame error', err);
    }
  },
};

/* The run ended: hand the stats to the results screen. Polled from the frame
 * loop rather than pushed from Game._die so that game.js stays unaware of the
 * DOM -- it is the same reason the headless harness can run game.js at all. */
Main._checkDeath = function () {
  if (Game.state !== 'dead' || UI.current === 'results') return;
  const s = Game.stats;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('res-score', U.formatNum(s.score));
  set('res-peak', s.peakHerd);
  set('res-lost', s.lost);
  set('res-created', s.created);
  set('res-banished', s.banished);
  set('res-level', s.level || 1);
  // Named aydins brought home, out of those that ever arrived.
  set('res-chars', (s.charactersSeen - s.charactersLost) + ' / ' + s.charactersSeen);
  set('res-time', U.formatTime(s.time));
  set('res-best', U.formatNum(s.best));
  const nb = document.getElementById('res-new');
  if (nb) nb.hidden = !s.isBest;

  const ach = document.getElementById('res-ach');
  if (ach) {
    const got = s.trophies || [];
    ach.hidden = !got.length;
    ach.textContent = got.length
      ? 'TROPHIES: ' + got.map((a) => a.name).join('  ·  ') : '';
  }
  UI.show('results');
};

window.addEventListener('DOMContentLoaded', Main.boot);
