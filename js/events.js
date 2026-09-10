/* =============================================================================
 * events.js  --  timed run events and the per-run modifier.
 *
 * THE SCHEDULER NEVER TOUCHES GAMEPLAY. An event is data: a duration, a bag of
 * multipliers, and a list of flags. Starting one adds it to a list and asks the
 * game to refold its multipliers; stopping one removes it and refolds again.
 * Nothing here writes a speed, a spawn rate or a score.
 *
 * That matters because upgrades, the run modifier and several events all want
 * to scale the SAME handful of numbers. If each wrote a delta into the live
 * value, two overlapping events could not be unwound independently and the one
 * that ended second would leave the other's multiplier behind. Folding from
 * scratch means an event's effect disappears the instant it expires, with no
 * bookkeeping, which is the same reason the upgrade buffs bag is rebuilt
 * rather than incremented.
 *
 * Effects that are not multipliers are FLAGS, asked for at the point of use:
 * Events.flag('silence') in the gohid update, Events.flag('thinIce') in the
 * capture path. A flag never pushes; the system that cares does the asking.
 *
 * A per-run modifier is the same shape with no duration, so it folds through
 * exactly the same code.
 * ========================================================================== */
'use strict';

const Events = {
  active: [],          // {def, t}
  modifier: null,      // the per-run modifier, or null
  timer: 0,

  reset() {
    Events.active.length = 0;
    Events.modifier = null;
    Events.timer = CFG.events.first;
    // Refold immediately. Clearing the list without refolding leaves Game.mods
    // holding multipliers from events that no longer exist, and every reader
    // downstream then sees a run that is faster or richer than it should be.
    // Any state-clearing call has to leave the folded values consistent.
    if (typeof Game !== 'undefined' && Game.recomputeMods) Game.recomputeMods();
  },

  /* Rolled once at the start of a run. Returns the modifier so the caller can
   * apply its one-off effects (starting herd size, starting gohids). */
  rollModifier() {
    Events.modifier = null;
    if (!U.chance(CFG.modifiers.chance)) return null;
    Events.modifier = U.pick(CFG.modifiers.list);
    return Events.modifier;
  },

  /* ------------------------------------------------------------- schedule */

  update(dt) {
    // Expire first, so an event that ends this frame is gone before anything
    // reads the folded multipliers.
    let changed = false;
    for (let i = Events.active.length - 1; i >= 0; i--) {
      const e = Events.active[i];
      e.t -= dt;
      if (e.t <= 0) { Events.active.splice(i, 1); changed = true; }
    }

    Events.timer -= dt;
    if (Events.timer <= 0) {
      Events.timer = U.rand(CFG.events.minGap, CFG.events.maxGap);
      if (Events.start()) changed = true;
    }

    if (changed) Game.recomputeMods();
  },

  start(id) {
    // Never run the same event twice at once -- two Golden Hours would read as
    // one that simply refuses to end.
    const running = Object.create(null);
    for (let i = 0; i < Events.active.length; i++) running[Events.active[i].def.id] = true;
    const pool = CFG.events.list.filter((d) => !running[d.id] && (!id || d.id === id));
    if (!pool.length) return false;

    const def = id ? pool[0] : U.pick(pool);
    Events.active.push({ def: def, t: def.duration, max: def.duration });
    UI.banner(def.name, def.kind, def.sub);
    Audio2.eventBanner();
    Game.recomputeMods();
    return true;
  },

  /* ------------------------------------------------------------- queries */

  /* Every multiplier from the modifier and every running event, folded
   * together. Game.recomputeMods multiplies this onto the upgrade buffs. */
  fold(into) {
    const apply = (mods) => {
      if (!mods) return;
      for (const k in mods) into[k] = (into[k] == null ? 1 : into[k]) * mods[k];
    };
    if (Events.modifier) apply(Events.modifier.mods);
    for (let i = 0; i < Events.active.length; i++) apply(Events.active[i].def.mods);
    return into;
  },

  /* Non-multiplier effects. Asked for; never pushed. */
  flag(name) {
    if (Events.modifier && Events.modifier.flags
        && Events.modifier.flags.indexOf(name) >= 0) return true;
    for (let i = 0; i < Events.active.length; i++) {
      const f = Events.active[i].def.flags;
      if (f && f.indexOf(name) >= 0) return true;
    }
    return false;
  },

  /* How many gohids a single capture creates. Thin Ice doubles it. */
  captureSpawnCount() { return Events.flag('thinIce') ? 2 : 1; },

  /* Vision radius in world units, or 0 for unlimited. Arenas will feed into
   * this too when they land. */
  visionRadius() {
    const mod = (Events.modifier && Events.modifier.vision) || 0;
    const arena = (typeof Arenas !== 'undefined') ? Arenas.vision() : 0;
    // Whichever is tighter wins: Fog in the Night Forest should not be a
    // relief because the two cancelled out.
    if (mod && arena) return Math.min(mod, arena);
    return mod || arena;
  },

  /* For the Collection screen's Active Effects tab. A permanent effect reports
   * itself as permanent rather than showing a number that never moves. */
  listActive() {
    const out = [];
    if (Events.modifier) {
      out.push({ name: Events.modifier.name, permanent: true });
    }
    for (let i = 0; i < Events.active.length; i++) {
      out.push({ name: Events.active[i].def.name, remaining: Events.active[i].t });
    }
    return out;
  },
};
