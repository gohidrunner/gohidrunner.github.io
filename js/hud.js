/* =============================================================================
 * hud.js  --  DOM heads-up display.
 *
 * The two numbers that matter -- AYDINS and GOHIDS -- dominate everything else,
 * because the entire game is the relationship between them.
 *
 * Every node here is looked up ONCE and then written in place. Nothing in this
 * file ever assigns innerHTML during a frame: rebuilding DOM at 60fps forces
 * layout on every tick and is a genuine, measurable cost, not a style
 * preference. Values are also compared before writing, so a steady herd count
 * does not dirty the DOM 60 times a second for no reason.
 * ========================================================================== */
'use strict';

const HUD = {
  el: {},
  _last: { aydins: -1, gohids: -1, score: -1, time: -1 },

  init() {
    const g = (id) => document.getElementById(id);
    HUD.el = {
      aydins:  g('hud-aydins'),
      gohids:  g('hud-gohids'),
      score:   g('hud-score'),
      time:    g('hud-time'),
      fps:     g('hud-fps'),
      aydinBox: g('hud-aydin-box'),
      gohidBox: g('hud-gohid-box'),
      rally:   g('hud-rally'),
      root:    g('hud'),
    };
  },

  show(on) {
    if (HUD.el.root) HUD.el.root.style.display = on ? '' : 'none';
  },

  update(fps) {
    const e = HUD.el;
    if (!e.aydins) return;

    const a = Game.aydins.length;
    if (a !== HUD._last.aydins) {
      e.aydins.textContent = a;
      // Rising and falling herd counts must not read the same. Green pulse on
      // a gain, red shake on a loss -- the player is watching the herd, not
      // this number, so it has to signal in peripheral vision.
      if (e.aydinBox) {
        const cls = a > HUD._last.aydins ? 'pulse-up' : 'pulse-down';
        if (HUD._last.aydins >= 0) HUD._flash(e.aydinBox, cls);
      }
      HUD._last.aydins = a;
    }

    const gh = Game.gohids.length + Game.pending.length;
    if (gh !== HUD._last.gohids) {
      e.gohids.textContent = gh;
      if (e.gohidBox && HUD._last.gohids >= 0 && gh > HUD._last.gohids) {
        HUD._flash(e.gohidBox, 'pulse-down');
      }
      HUD._last.gohids = gh;
    }

    // The score is always ticking -- a static number is a dead number.
    const s = Math.floor(Game.score);
    if (s !== HUD._last.score) {
      e.score.textContent = U.formatNum(s);
      HUD._last.score = s;
    }

    const t = Math.floor(Game.time);
    if (t !== HUD._last.time) {
      e.time.textContent = U.formatTime(Game.time);
      HUD._last.time = t;
    }

    if (e.rally) {
      const on = Game.rallying;
      if (on !== HUD._rallyOn) {
        e.rally.classList.toggle('on', on);
        HUD._rallyOn = on;
      }
    }

    if (e.fps && CFG.debug.showFps) {
      const v = fps | 0;
      if (v !== HUD._lastFps) { e.fps.textContent = v + ' fps'; HUD._lastFps = v; }
    }
  },

  /* Restart a CSS animation by removing the class, forcing reflow, re-adding.
   * Without the reflow read the browser coalesces both changes and the
   * animation never replays on a rapid second hit. */
  _flash(node, cls) {
    node.classList.remove('pulse-up', 'pulse-down');
    void node.offsetWidth;
    node.classList.add(cls);
  },

  reset() {
    HUD._last.aydins = -1;
    HUD._last.gohids = -1;
    HUD._last.score = -1;
    HUD._last.time = -1;
    HUD._rallyOn = null;
    HUD._lastFps = -1;
  },
};
