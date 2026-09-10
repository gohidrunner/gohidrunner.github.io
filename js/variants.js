/* =============================================================================
 * variants.js  --  gohid kinds, unlocked by elapsed run time.
 *
 * Every variant is the SAME sprite with a runtime tint and a badge glyph. No
 * new art is authored, which is the rule for the whole project.
 *
 * A variant is DATA plus, at most, one case in _behave(). The Gohid class
 * reads its variant for speed, size, grab radius and whether it can grab at
 * all; anything more interesting than that gets a case here. Adding a variant
 * should be a config entry, a badge character, and nothing else unless it does
 * something genuinely new.
 *
 * Badges exist because the tints alone are not enough: at 44px, against a lit
 * floor, several of these reds are close together, and a colourblind player
 * has nothing at all to go on. The badge is drawn in render.js.
 * ========================================================================== */
'use strict';

const Variants = {
  /* Pick a kind for a newly created gohid. Later variants are unlocked by run
   * time, so the threat keeps changing shape without the player having to
   * learn eight behaviours in the first minute. */
  roll() {
    const t = Game.time;
    let total = 0;
    const pool = [];
    for (const id in CFG.variants) {
      const v = CFG.variants[id];
      if (t < v.after) continue;
      pool.push(id);
      total += v.weight;
    }
    if (!pool.length) return 'gohid';
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= CFG.variants[pool[i]].weight;
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  },

  cfg(id) { return CFG.variants[id] || CFG.variants.gohid; },

  /* Applied once, when the gohid is created. */
  apply(g, id) {
    const v = Variants.cfg(id);
    g.variant = id;
    g.speedMul = v.speedMul || 1;
    g.sizeMul = v.sizeMul || 1;
    g.grabRadius = (v.grabRadius != null) ? v.grabRadius : CFG.gohid.grabRadius;
    g.grabCount = v.grabCount || 1;
    g.canGrab = (v.canGrab !== false);
    g.vt = Math.random() * 3;      // per-variant timer, desynchronised
    g.revealed = (v.revealAt == null);
  },

  /* Per-frame behaviour. Called from Gohid.update AFTER the status-effect gate,
   * so a stunned howler cannot howl. */
  behave(g, dt, game) {
    const v = Variants.cfg(g.variant);
    g.vt += dt;

    switch (g.variant) {
      case 'howler': {
        // Does not grab. Instead it blows the herd apart for something else to
        // pick off -- the only gohid that is dangerous through other gohids.
        if (g.vt < v.every) break;
        g.vt = 0;
        const out = [];
        const near = game.aydinGrid.query(g.x, g.y, v.radius, out);
        let hit = 0;
        for (let i = 0; i < near.length; i++) {
          const a = near[i];
          if (U.dist2(a.x, a.y, g.x, g.y) > v.radius * v.radius) continue;
          a.panic = game.tuning.panicTime;
          hit++;
        }
        if (hit) {
          Particles.burst(g.x, g.y, 22, {
            speed: 300, life: 0.5, size: 3, colour: v.tint, drag: 2.2,
          });
          Audio2.howl();
          game.shake = Math.max(game.shake, 6);
        }
        break;
      }

      case 'herder': {
        // Pushes aydins AWAY from the commander, cutting strays out of the
        // pack for the rest of the board to chase down.
        const cmd = game.commander;
        const out = [];
        const near = game.aydinGrid.query(g.x, g.y, v.radius, out);
        for (let i = 0; i < near.length; i++) {
          const a = near[i];
          if (U.dist2(a.x, a.y, g.x, g.y) > v.radius * v.radius) continue;
          const dx = a.x - cmd.x, dy = a.y - cmd.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          a.vx += (dx / d) * v.push * dt;
          a.vy += (dy / d) * v.push * dt;
        }
        break;
      }

      case 'stalker': {
        // Nearly invisible until it is close, then fully visible and fast.
        const d2 = U.dist2(g.x, g.y, game.commander.x, game.commander.y);
        const lit = Variants.lanternActive();
        g.revealed = lit || d2 < v.revealAt * v.revealAt;
        break;
      }
    }
  },

  /* The Lantern tool exists precisely to answer stalkers. */
  lanternActive() {
    if (typeof Tools === 'undefined') return false;
    for (let i = 0; i < Tools.active.length; i++) {
      if (Tools.active[i].id === 'lantern') return true;
    }
    return false;
  },

  /* Hunters ignore the herd and go for the named aydins. Returns a target or
   * null, in which case the gohid falls back to normal hunting. */
  preferredTarget(g, game) {
    if (g.variant !== 'hunter') return null;
    if (typeof Characters === 'undefined') return null;
    let best = null, bestD = Infinity;
    for (let i = 0; i < Characters.active.length; i++) {
      const c = Characters.active[i];
      if (!c.alive || !c.aydin || !c.aydin.alive) continue;
      const d = U.dist2(g.x, g.y, c.aydin.x, c.aydin.y);
      if (d < bestD) { bestD = d; best = c.aydin; }
    }
    return best;
  },

  /* Splitter: banishing one is the wrong reflex. */
  onBanish(g) {
    const v = Variants.cfg(g.variant);
    if (!v.splitInto) return;
    for (let i = 0; i < (v.splitCount || 2); i++) {
      const a = (Math.PI * 2 * i) / (v.splitCount || 2);
      const child = new Gohid(g.x + Math.cos(a) * 30, g.y + Math.sin(a) * 30);
      Variants.apply(child, v.splitInto);
      Game.gohids.push(child);
      Game.stats.created++;
    }
    Particles.burst(g.x, g.y, 16, {
      speed: 220, life: 0.45, size: 3, colour: v.tint,
    });
    UI.banner('IT SPLIT', 'bad');
  },

  /* Draw alpha, so stalkers can hide. */
  alphaFor(g) {
    const v = Variants.cfg(g.variant);
    if (v.hiddenAlpha != null && !g.revealed) return v.hiddenAlpha;
    return 1;
  },
};
