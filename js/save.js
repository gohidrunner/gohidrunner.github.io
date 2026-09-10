/* =============================================================================
 * save.js  --  the persisted profile: best scores, unlocks, settings.
 *
 * Every read and write goes through U.storeGet/U.storeSet, which swallow the
 * exception localStorage throws outright in iOS private mode. Nothing here may
 * assume a write succeeded -- the game has to stay playable with persistence
 * entirely unavailable, so the in-memory copy is always the working state and
 * storage is only a mirror of it.
 * ========================================================================== */
'use strict';

const Save = {
  data: null,

  _defaults() {
    return {
      version: 1,
      best: 0,               // best score in a single run
      lifetime: 0,           // total score ever, drives arena unlocks
      runs: 0,
      arena: 'steppe',       // last selected
      achievements: {},      // id -> true
      seenChars: {},         // id -> true, for the Collection greying
      settings: {
        sfx: true,
        volume: CFG.audio.volume,
        shake: true,
        touch: 'auto',       // auto | on | off
        colourblind: false,
        performance: false,
      },
    };
  },

  load() {
    const stored = U.storeGet(CFG.storage.key, null);
    const def = Save._defaults();
    if (!stored || typeof stored !== 'object') {
      Save.data = def;
      return Save.data;
    }
    // Shallow-merge onto defaults so a save written by an older build gains
    // new keys instead of leaving them undefined all over the UI.
    Save.data = Object.assign(def, stored);
    Save.data.settings = Object.assign(def.settings, stored.settings || {});
    return Save.data;
  },

  flush() { U.storeSet(CFG.storage.key, Save.data); },

  get settings() { return Save.data.settings; },

  set(key, value) {
    Save.data[key] = value;
    Save.flush();
  },

  setSetting(key, value) {
    Save.data.settings[key] = value;
    Save.flush();
  },

  /* Called once at the end of a run. Returns whether it was a personal best,
   * because the results screen needs to know before the value is overwritten. */
  recordRun(stats) {
    const isBest = stats.score > Save.data.best;
    if (isBest) Save.data.best = stats.score;
    Save.data.lifetime += stats.score;
    Save.data.runs++;
    Save.flush();
    return isBest;
  },

  hasAchievement(id) { return !!Save.data.achievements[id]; },

  grantAchievement(id) {
    if (Save.data.achievements[id]) return false;
    Save.data.achievements[id] = true;
    Save.flush();
    return true;
  },

  markCharSeen(id) {
    if (Save.data.seenChars[id]) return;
    Save.data.seenChars[id] = true;
    Save.flush();
  },
};
