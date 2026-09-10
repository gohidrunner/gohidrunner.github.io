/* =============================================================================
 * hud.js  --  the in-run heads-up display.
 *
 * The two numbers that matter -- AYDINS and GOHIDS -- dominate everything else,
 * because the entire game is the relationship between them.
 *
 * Every node is looked up ONCE and written in place. Nothing here assigns
 * innerHTML during a frame: rebuilding DOM at 60fps forces layout every tick
 * and is a genuine, measured cost, not a style preference. Values are also
 * compared before writing, so a steady herd count does not dirty the DOM sixty
 * times a second for no reason.
 *
 * The tool tray follows the same rule the hard way: slots are created when the
 * set of tools CHANGES, and only their cooldown sweep and pips are touched per
 * frame.
 * ========================================================================== */
'use strict';

const HUD = {
  el: {},
  _last: {},
  _toolSlots: [],
  _toolSig: '',
  _charSlots: {},
  _rallyFill: 0,

  init() {
    const g = (id) => document.getElementById(id);
    HUD.el = {
      root:     g('hud'),
      aydins:   g('hud-aydins'),
      gohids:   g('hud-gohids'),
      aydinBox: g('hud-aydin-box'),
      gohidBox: g('hud-gohid-box'),
      score:    g('hud-score'),
      time:     g('hud-time'),
      fps:      g('hud-fps'),
      level:    g('hud-level'),
      exp:      g('hud-exp'),
      rally:    g('hud-rally'),
      rallyRing: g('rally-ring'),
      tools:    g('hud-tools'),
      chars:    g('hud-chars'),
      minimapBox: g('hud-minimap-box'),
    };
    HUD._rallyCtx = HUD.el.rallyRing ? HUD.el.rallyRing.getContext('2d') : null;
    HUD.reset();
  },

  show(on) {
    if (HUD.el.root) HUD.el.root.hidden = !on;
  },

  reset() {
    HUD._last = {
      aydins: -1, gohids: -1, score: -1, time: -1,
      level: -1, exp: -1, fps: -1, rally: null,
    };
    HUD._toolSig = '';
    if (HUD.el.tools) HUD.el.tools.textContent = '';
    HUD._toolSlots.length = 0;
    if (HUD.el.chars) HUD.el.chars.textContent = '';
    HUD._charSlots = {};
    HUD._rallyFill = 0;
  },

  update(dt, fps) {
    const e = HUD.el;
    if (!e.aydins) return;

    /* ---- the two counts ------------------------------------------------ */

    const a = Game.aydins.length;
    if (a !== HUD._last.aydins) {
      e.aydins.textContent = a;
      if (HUD._last.aydins >= 0) {
        HUD._flash(e.aydinBox, a > HUD._last.aydins ? 'pulse-up' : 'pulse-down');
      }
      HUD._last.aydins = a;
    }

    // Pending spawns are counted: a gohid mid-telegraph is already a fact the
    // player has to plan around, and hiding it until it pops would make the
    // number lie for a second and a half.
    const gh = Game.gohids.length + Game.pending.length;
    if (gh !== HUD._last.gohids) {
      e.gohids.textContent = gh;
      if (HUD._last.gohids >= 0 && gh > HUD._last.gohids) {
        HUD._flash(e.gohidBox, 'gohid-incoming');
      }
      HUD._last.gohids = gh;
    }

    /* ---- score, always ticking ----------------------------------------- */

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

    /* ---- level and exp -------------------------------------------------- */

    if (Game.level !== HUD._last.level) {
      e.level.textContent = 'LV ' + Game.level;
      HUD._last.level = Game.level;
    }
    // Quantised to whole percent: writing a style every frame for a change no
    // one can see is exactly the per-frame DOM churn this file avoids.
    const pct = Math.max(0, Math.min(100,
      Math.round((Game.exp / Math.max(1, Game.expToNext)) * 100)));
    if (pct !== HUD._last.exp) {
      e.exp.style.width = pct + '%';
      HUD._last.exp = pct;
    }

    /* ---- rally ---------------------------------------------------------- */

    HUD._updateRally(dt);

    /* ---- tools and characters ------------------------------------------- */

    HUD.updateTools();
    HUD.updateChars();

    if (e.fps && CFG.debug.showFps) {
      const v = fps | 0;
      if (v !== HUD._last.fps) { e.fps.textContent = v + ' fps'; HUD._last.fps = v; }
    }
  },

  /* The ring fills while rally is held and drains when released. It is not a
   * resource -- there is nothing to run out of -- it is a readout of which of
   * the game's two verbs is currently active, placed where a thumb already is. */
  _updateRally(dt) {
    const on = Game.rallying;
    if (on !== HUD._last.rally) {
      HUD.el.rally.className = 'hud-rally' + (on ? ' on' : '');
      HUD._last.rally = on;
    }
    const target = on ? 1 : 0;
    const rate = on ? 6 : 4;
    HUD._rallyFill = U.damp(HUD._rallyFill, target, rate, dt);

    const ctx = HUD._rallyCtx;
    if (!ctx) return;
    const S = 56, r = 22, cx = S / 2, cy = S / 2;
    ctx.clearRect(0, 0, S, S);

    ctx.strokeStyle = CFG.palette.border;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Quantised into wedges so it advances in frames, like everything else.
    const fill = U.quantise(HUD._rallyFill, 12);
    if (fill > 0.001) {
      ctx.strokeStyle = CFG.palette.rally;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fill);
      ctx.stroke();
    }

    ctx.fillStyle = on ? CFG.palette.rally : CFG.palette.border;
    const d = on ? 12 : 8;
    ctx.fillRect(Math.round(cx - d / 2), Math.round(cy - d / 2), d, d);
  },

  /* ------------------------------------------------------------- tool tray */

  updateTools() {
    const host = HUD.el.tools;
    if (!host) return;
    const tools = Game.tools || [];

    // Rebuild ONLY when the set of tools changes, never per frame.
    const sig = tools.map((t) => t.id + ':' + t.level).join(',');
    if (sig !== HUD._toolSig) {
      HUD._toolSig = sig;
      host.textContent = '';
      HUD._toolSlots.length = 0;
      for (let i = 0; i < tools.length; i++) {
        const slot = document.createElement('div');
        slot.className = 'tool-slot';
        const cv = document.createElement('canvas');
        cv.width = 40; cv.height = 40;
        slot.appendChild(cv);
        const pips = document.createElement('div');
        pips.className = 'tool-pips';
        for (let p = 0; p < (tools[i].maxLevel || 5); p++) {
          const pip = document.createElement('span');
          pip.className = 'pip' + (p < tools[i].level ? ' on' : '');
          pips.appendChild(pip);
        }
        slot.appendChild(pips);
        host.appendChild(slot);
        HUD._toolSlots.push({ el: slot, ctx: cv.getContext('2d'), last: -1 });
      }
    }

    // Per frame, only the cooldown sweep is touched.
    for (let i = 0; i < HUD._toolSlots.length; i++) {
      const t = tools[i];
      const s = HUD._toolSlots[i];
      const ready = t.cooldown > 0 ? 1 - (t.cd / t.cooldown) : 1;
      const q = U.quantise(ready, 8);
      if (q === s.last) continue;
      s.last = q;
      HUD._drawToolIcon(s.ctx, t, q);
    }
  },

  _drawToolIcon(ctx, tool, ready) {
    const S = 40;
    ctx.clearRect(0, 0, S, S);
    if (tool.icon) tool.icon(ctx, S);
    else {
      ctx.fillStyle = CFG.palette.rally;
      ctx.fillRect(12, 12, 16, 16);
    }
    if (ready < 1) {
      // Radial sweep: the unfilled wedge is what is still on cooldown.
      ctx.fillStyle = 'rgba(13,11,20,0.72)';
      ctx.beginPath();
      ctx.moveTo(S / 2, S / 2);
      ctx.arc(S / 2, S / 2, S, -Math.PI / 2 + Math.PI * 2 * ready, Math.PI * 1.5);
      ctx.closePath();
      ctx.fill();
    }
  },

  /* ------------------------------------------------- character aydin strip */

  updateChars() {
    const host = HUD.el.chars;
    if (!host) return;
    const chars = Game.characters || [];

    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      let slot = HUD._charSlots[c.id];
      if (!slot) {
        const el = document.createElement('div');
        el.className = 'char-portrait';
        const cv = document.createElement('canvas');
        cv.width = 34; cv.height = 34;
        el.appendChild(cv);
        const badge = document.createElement('div');
        badge.className = 'char-badge';
        badge.textContent = c.badge || '';
        badge.style.color = c.colour || CFG.palette.aydin;
        el.appendChild(badge);
        host.appendChild(el);
        slot = HUD._charSlots[c.id] = { el: el, drawn: false, lost: false };
      }
      if (!slot.drawn) {
        const cv = slot.el.querySelector('canvas');
        const ctx = cv.getContext('2d');
        const sprite = Sprites.tinted('aydin', c.colour, 0.45);
        if (sprite) {
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, 34, 34);
          ctx.drawImage(sprite, 0, 0, 34, 34);
          slot.drawn = true;
        }
      }
      // The portrait shatters and greys when its aydin is taken. This is meant
      // to land in the player's stomach, so it is deliberately not subtle.
      if (!c.alive && !slot.lost) {
        slot.lost = true;
        slot.el.className = 'char-portrait lost shatter';
        Audio2.characterLost();
      }
    }
  },

  /* Restart a CSS animation: remove the class, force a reflow read, re-add.
   * Without the reflow the browser coalesces both changes and the animation
   * never replays on a rapid second hit -- which is precisely when the player
   * most needs to see it. */
  _flash(node, cls) {
    if (!node) return;
    node.classList.remove('pulse-up', 'pulse-down', 'gohid-incoming');
    void node.offsetWidth;
    node.classList.add(cls);
  },
};
