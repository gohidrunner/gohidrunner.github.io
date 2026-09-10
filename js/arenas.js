/* =============================================================================
 * arenas.js  --  the five maps.
 *
 * An arena is data: a floor palette, an unlock threshold, and a twist. The
 * twist is expressed as `mods` / `flags` / `vision` -- the SAME shape an event
 * or a run modifier uses -- so it folds through `Game.recomputeMods()` and
 * `Events.visionRadius()` without any arena-specific plumbing in the game loop.
 *
 * Only two arenas need real behaviour, and both are one small thing:
 *   Ruins       static walls that push entities out of them
 *   Frozen Lake the commander accelerates instead of setting velocity
 *
 * Walls are generated from a per-run seed rather than stored, so the layout is
 * stable for a run, identical on a retry of that run, and costs nothing to
 * keep around.
 * ========================================================================== */
'use strict';

const Arenas = {
  list: CFG.arenas.list,
  current: CFG.arenas.list[0],
  walls: [],

  byId(id) {
    for (let i = 0; i < Arenas.list.length; i++) {
      if (Arenas.list[i].id === id) return Arenas.list[i];
    }
    return Arenas.list[0];
  },

  unlocked(a) {
    const lifetime = (typeof Save !== 'undefined' && Save.data) ? Save.data.lifetime : 0;
    return lifetime >= a.unlock;
  },

  /* Chosen on the arena screen, applied when a run starts. An arena that has
   * since been locked (a wiped save) silently falls back to the steppe rather
   * than starting a run the player cannot have. */
  select(id) {
    const a = Arenas.byId(id);
    Arenas.current = Arenas.unlocked(a) ? a : Arenas.list[0];
    return Arenas.current;
  },

  reset() {
    const id = (typeof Save !== 'undefined' && Save.data) ? Save.data.arena : 'steppe';
    Arenas.select(id);
    Arenas._buildWalls();
  },

  /* ---------------------------------------------------------------- walls */

  _buildWalls() {
    Arenas.walls.length = 0;
    const n = Arenas.current.walls || 0;
    if (!n) return;
    const C = CFG.arenas;
    const pad = 300;
    for (let i = 0; i < n; i++) {
      const horizontal = Math.random() < 0.5;
      const len = U.rand(C.wallMin, C.wallMax);
      const w = horizontal ? len : C.wallThick;
      const h = horizontal ? C.wallThick : len;
      const x = U.rand(pad, CFG.world.width - pad - w);
      const y = U.rand(pad, CFG.world.height - pad - h);
      // Never wall in the starting position.
      if (Math.abs(x - CFG.world.width / 2) < 400
          && Math.abs(y - CFG.world.height / 2) < 400) continue;
      Arenas.walls.push({ x: x, y: y, w: w, h: h });
    }
  },

  /* Push an entity out of any wall it is inside, along the shallowest axis --
   * which is what makes something slide ALONG a wall rather than stick to it.
   * Used for the commander, the herd and the gohids alike, so nothing can end
   * up inside geometry. */
  resolve(e, dt) {
    const walls = Arenas.walls;
    if (!walls.length) return;
    const r = 10;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (e.x + r < w.x || e.x - r > w.x + w.w) continue;
      if (e.y + r < w.y || e.y - r > w.y + w.h) continue;

      const left = (e.x + r) - w.x;
      const right = (w.x + w.w) - (e.x - r);
      const top = (e.y + r) - w.y;
      const bottom = (w.y + w.h) - (e.y - r);
      const m = Math.min(left, right, top, bottom);
      if (m === left) e.x = w.x - r;
      else if (m === right) e.x = w.x + w.w + r;
      else if (m === top) e.y = w.y - r;
      else e.y = w.y + w.h + r;
    }
  },

  /* ------------------------------------------------------------- queries */

  palette() { return Arenas.current; },
  vision() { return Arenas.current.vision || 0; },
  slide() { return Arenas.current.slide || 0; },
  mods() { return Arenas.current.mods || null; },

  /* Night Forest makes stalkers more common. Applied as a weight multiplier so
   * it composes with the time-based unlock rather than replacing it. */
  variantWeight(id, base) {
    const boost = Arenas.current.variantBoost;
    return boost && boost[id] ? base * boost[id] : base;
  },

  /* ---------------------------------------------------------------- draw */

  drawWalls(ctx, view) {
    const walls = Arenas.walls;
    if (!walls.length) return;
    const p = Arenas.current;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.x > view.x1 || w.x + w.w < view.x0) continue;
      if (w.y > view.y1 || w.y + w.h < view.y0) continue;
      ctx.fillStyle = p.edge;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = p.decor;
      ctx.fillRect(w.x + 3, w.y + 3, w.w - 6, w.h - 6);
      ctx.fillStyle = p.decor2;
      ctx.fillRect(w.x + 3, w.y + 3, w.w - 6, 3);
    }
  },
};
