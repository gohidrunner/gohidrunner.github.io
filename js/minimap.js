/* =============================================================================
 * minimap.js  --  the bottom-left overview.
 *
 * This is how the player sees a gohid pack sweeping in from off-screen, which
 * is information the main view cannot give them at any zoom. It is the
 * difference between being ambushed and choosing to run.
 *
 * It draws on its OWN clock (CFG.minimap.refreshHz), not once per frame. At 60
 * fps this is a few hundred fillRects of pure overhead for information that
 * changes far too slowly to need 60 updates a second -- and it is the kind of
 * cost that only shows up on the phone, in the middle of the biggest herd,
 * exactly when the frame budget is already gone.
 *
 * Dots are squares. Colour means what it means everywhere else: warm gold is
 * yours, red is coming for you.
 * ========================================================================== */
'use strict';

const Minimap = {
  canvas: null,
  ctx: null,
  size: 0,
  _acc: 0,
  _scale: 1,
  _ox: 0, _oy: 0,

  init() {
    Minimap.canvas = document.getElementById('minimap');
    if (!Minimap.canvas) return;
    Minimap.ctx = Minimap.canvas.getContext('2d');
    Minimap.resize();
  },

  resize() {
    if (!Minimap.canvas) return;
    // At the full 148px the minimap covered 40% of a 375px-wide phone and
    // crowded the rally control off the bottom bar.
    const cssSize = (window.innerWidth <= 560)
      ? CFG.minimap.sizeMobile : CFG.minimap.size;
    // The minimap is small and static, so it can afford full DPR for crisp
    // dots without the cost that made the main canvas cap its ratio.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    Minimap.size = cssSize;
    Minimap.canvas.width = Math.round(cssSize * dpr);
    Minimap.canvas.height = Math.round(cssSize * dpr);
    Minimap.canvas.style.width = cssSize + 'px';
    Minimap.canvas.style.height = cssSize + 'px';
    Minimap.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Minimap.ctx.imageSmoothingEnabled = false;

    // Letterbox the arena into the square so the map keeps its aspect ratio.
    const W = CFG.world.width, H = CFG.world.height;
    Minimap._scale = Math.min(cssSize / W, cssSize / H);
    Minimap._ox = (cssSize - W * Minimap._scale) / 2;
    Minimap._oy = (cssSize - H * Minimap._scale) / 2;
  },

  update(dt) {
    Minimap._acc += dt;
    const interval = 1 / CFG.minimap.refreshHz;
    if (Minimap._acc < interval) return;
    Minimap._acc = 0;
    Minimap.draw();
  },

  _dot(ctx, x, y, size, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(
      Math.round(Minimap._ox + x * Minimap._scale - size / 2),
      Math.round(Minimap._oy + y * Minimap._scale - size / 2),
      size, size);
  },

  draw() {
    const ctx = Minimap.ctx;
    if (!ctx || !Game.commander) return;
    const P = CFG.palette;
    const M = CFG.minimap;
    const s = Minimap.size;

    ctx.clearRect(0, 0, s, s);

    // Arena bounds.
    ctx.fillStyle = P.ink;
    ctx.fillRect(Minimap._ox, Minimap._oy,
                 CFG.world.width * Minimap._scale,
                 CFG.world.height * Minimap._scale);
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(Minimap._ox + 0.5, Minimap._oy + 0.5,
                   CFG.world.width * Minimap._scale - 1,
                   CFG.world.height * Minimap._scale - 1);

    // The herd, drawn first and dim, so it reads as a soft cloud rather than a
    // set of individuals -- the player needs its SHAPE, not its members.
    ctx.globalAlpha = 0.75;
    const herd = Game.aydins;
    for (let i = 0; i < herd.length; i++) {
      Minimap._dot(ctx, herd[i].x, herd[i].y, M.dotHerd, P.aydin);
    }
    ctx.globalAlpha = 1;

    // Pickups and chests. The Scout marks them; without it they are only
    // visible when they are already on screen.
    const marks = (typeof Characters !== 'undefined') && Characters.marksPickups();
    if (marks && Game.pickups) {
      for (let i = 0; i < Game.pickups.length; i++) {
        const p = Game.pickups[i];
        Minimap._dot(ctx, p.x, p.y, 3, P.exp);
      }
    }
    if (marks && Game.chests) {
      for (let i = 0; i < Game.chests.length; i++) {
        const c = Game.chests[i];
        Minimap._dot(ctx, c.x, c.y, 4, P.score);
      }
    }

    // Character aydins get their own pip in their own colour, above the herd.
    for (let i = 0; i < herd.length; i++) {
      const a = herd[i];
      if (a.character) Minimap._dot(ctx, a.x, a.y, 3, a.character.colour || P.aydinGlow);
    }

    // Every gohid. These are the reason the minimap exists.
    const gohids = Game.gohids;
    for (let i = 0; i < gohids.length; i++) {
      const g = gohids[i];
      if (g.leaving) continue;
      Minimap._dot(ctx, g.x, g.y, M.dotGohid, P.gohid);
    }
    // Telegraphed spawns show too -- a gohid that is about to exist is already
    // something to steer around.
    for (let i = 0; i < Game.pending.length; i++) {
      const p = Game.pending[i];
      Minimap._dot(ctx, p.x, p.y, M.dotGohid, P.gohidDark);
    }

    // The commander last, so he is never hidden under the herd he leads.
    const c = Game.commander;
    Minimap._dot(ctx, c.x, c.y, M.dotCommander + 2, P.ink);
    Minimap._dot(ctx, c.x, c.y, M.dotCommander, P.rally);

    // Viewport rectangle, so the minimap and the main view are relatable.
    // Uses the ZOOMED extent -- at zoom < 1 the camera sees more world than
    // its CSS size, and a rect drawn from the CSS size would under-report what
    // is actually on screen.
    if (Render.w) {
      const vw = Render.w / Render.zoom, vh = Render.h / Render.zoom;
      ctx.strokeStyle = 'rgba(236,230,245,0.28)';
      ctx.strokeRect(
        Math.round(Minimap._ox + (Render.camX - vw / 2) * Minimap._scale) + 0.5,
        Math.round(Minimap._oy + (Render.camY - vh / 2) * Minimap._scale) + 0.5,
        Math.round(vw * Minimap._scale),
        Math.round(vh * Minimap._scale));
    }
  },
};
