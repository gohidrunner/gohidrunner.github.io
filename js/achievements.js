/* =============================================================================
 * achievements.js  --  ~20 trophies, persisted across runs.
 *
 * Most are "a run stat passed a threshold", so they are pure data in config:
 * `stat` names a field on Game.stats, `min` is the bar. Only the handful that
 * cannot be said that way get a `test` function here, which keeps the list
 * readable and means adding one is usually a config line.
 *
 * They are checked on a slow clock (once a second) rather than every frame.
 * Twenty comparisons is not expensive, but it is pure waste sixty times a
 * second for conditions that move at human speed -- and this runs during the
 * exact moments the frame budget is already gone.
 *
 * Granting is idempotent: Save.grantAchievement returns false if it was
 * already held, so the banner fires once and never again.
 * ========================================================================== */
'use strict';

const Achievements = {
  list: CFG.achievements.list,
  _timer: 0,
  earnedThisRun: [],

  /* Conditions that are not a simple stat threshold. */
  tests: {
    allChars(g) {
      // Every character that ever arrived is still alive, and at least one did.
      return g.charactersSeen >= Characters.list.length && g.charactersLost === 0;
    },
    leanWin(g) {
      return !!(Events.modifier && Events.modifier.id === 'leanTimes')
             && g.score >= 5000;
    },
    everyEvo() {
      const all = Object.keys(CFG.evolutions);
      for (let i = 0; i < all.length; i++) {
        if (!Upgrades.hasEvolution(all[i])) return false;
      }
      return true;
    },
    noLoss(g) { return g.time >= 180 && g.lost === 0; },
    allArenas() {
      for (let i = 0; i < Arenas.list.length; i++) {
        if (!Arenas.unlocked(Arenas.list[i])) return false;
      }
      return true;
    },
  },

  reset() { Achievements.earnedThisRun.length = 0; Achievements._timer = 0; },

  /* Stats used by the thresholds that are not already tracked continuously. */
  track() {
    const g = Game.stats;
    const gohids = Game.gohids.length + Game.pending.length;
    if (gohids > (g.peakGohids || 0)) g.peakGohids = gohids;
    g.time = Game.time;
    g.score = Math.floor(Game.score);
    g.level = Game.level;
  },

  update(dt) {
    Achievements.track();
    Achievements._timer -= dt;
    if (Achievements._timer > 0) return;
    Achievements._timer = CFG.achievements.checkInterval;
    Achievements.check();
  },

  check() {
    const g = Game.stats;
    for (let i = 0; i < Achievements.list.length; i++) {
      const a = Achievements.list[i];
      if (Save.hasAchievement(a.id)) continue;

      let got = false;
      if (a.stat) got = (g[a.stat] || 0) >= a.min;
      else if (Achievements.tests[a.id]) {
        try { got = !!Achievements.tests[a.id](g); } catch (e) { got = false; }
      }
      if (!got) continue;

      if (Save.grantAchievement(a.id)) {
        Achievements.earnedThisRun.push(a);
        UI.banner(a.name, 'level', 'TROPHY');
        Audio2.chest();
      }
    }
  },

  /* Run-end conditions -- allChars and noLoss can only be judged once the run
   * is actually over, and lifetime-score unlocks land after the score is
   * banked, so this runs after Save.recordRun. */
  onRunEnd() {
    Achievements.track();
    Achievements.check();
    return Achievements.earnedThisRun;
  },

  count() {
    let n = 0;
    for (let i = 0; i < Achievements.list.length; i++) {
      if (Save.hasAchievement(Achievements.list[i].id)) n++;
    }
    return n;
  },
};
