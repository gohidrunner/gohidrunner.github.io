/* =============================================================================
 * ui.js  --  screens, modals and banners.
 *
 * One screen is visible at a time, or none during play. UI.show(name) is the
 * only way that changes, so there is a single place where "what is the game
 * doing right now" is decided.
 *
 * Screens that PAUSE the game (pause, level-up, chest) are listed in PAUSING.
 * The game loop reads UI.paused rather than each screen checking for itself,
 * because the failure mode otherwise is a screen that dims the world while the
 * herd keeps being eaten behind it.
 *
 * Buttons are wired by data attribute, not by id, and the click handler is
 * delegated from the document. That means a screen built later -- an arena
 * card, a level-up card -- works without registering anything.
 *
 *   data-screen="collection"   show that screen, remembering where we came from
 *   data-back                  return to whatever showed this screen
 *   data-go="play|resume|menu|quit"   verbs handled in _verb()
 * ========================================================================== */
'use strict';

const UI = {
  current: null,
  _returnTo: null,
  _banners: [],
  el: {},

  // Showing any of these stops the world.
  PAUSING: { pause: 1, levelup: 1, chest: 1 },

  get paused() { return !!UI.PAUSING[UI.current]; },

  init() {
    const g = (id) => document.getElementById(id);
    UI.el = {
      bannerLayer: g('banner-layer'),
      levelupCards: g('levelup-cards'),
      levelupLevel: g('levelup-level'),
      chestCards: g('chest-cards'),
      chestKicker: g('chest-kicker'),
      arenaList: g('arena-list'),
      achGrid: g('ach-grid'),
      settingsList: g('settings-list'),
      collectionBody: g('collection-body'),
      collectionTabs: g('collection-tabs'),
    };

    // One delegated listener for every button in every screen, including ones
    // that do not exist yet.
    document.addEventListener('click', UI._onClick);

    // Escape and P toggle pause during a run.
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k !== 'escape' && k !== 'p') return;
      if (Game.state === 'playing' && !UI.current) UI.show('pause');
      else if (UI.current === 'pause') UI.hide();
    });

    UI._buildSettings();
    UI._buildArenas();
    UI._buildAchievements();
    UI._collectionTab('passives');
  },

  _onClick(e) {
    const t = e.target.closest('[data-screen], [data-back], [data-go], [data-tab], [data-arena]');
    if (!t) return;
    if (t.dataset.screen) {
      UI._returnTo = UI.current;
      UI.show(t.dataset.screen);
    } else if (t.hasAttribute('data-back')) {
      UI.show(UI._returnTo || 'menu');
    } else if (t.dataset.go) {
      UI._verb(t.dataset.go);
    } else if (t.dataset.tab) {
      UI._collectionTab(t.dataset.tab);
    } else if (t.dataset.arena) {
      UI._pickArena(t.dataset.arena);
    }
  },

  _verb(verb) {
    Audio2.resume();
    Music.unlock();
    if (verb === 'play') {
      // Order matters: UI.hide() decides HUD visibility from Game.state, so
      // the run has to be started BEFORE hiding, or the HUD stays hidden for
      // the whole run.
      HUD.reset();
      Game.start();
      UI.hide();
      Music.play('run');
    } else if (verb === 'resume') {
      UI.hide();
    } else if (verb === 'menu' || verb === 'quit') {
      UI.show('menu');
      Game.attract();
      Music.play('menu');
    }
  },

  /* ----------------------------------------------------------- visibility */

  show(name) {
    const screens = document.querySelectorAll('.screen');
    for (let i = 0; i < screens.length; i++) {
      screens[i].hidden = (screens[i].id !== 'screen-' + name);
    }
    UI.current = name;
    HUD.show(false);
    if (name === 'settings') UI._buildSettings();
    if (name === 'arenas') UI._buildArenas();
    if (name === 'achievements') UI._buildAchievements();
  },

  hide() {
    const screens = document.querySelectorAll('.screen');
    for (let i = 0; i < screens.length; i++) screens[i].hidden = true;
    UI.current = null;
    HUD.show(Game.state === 'playing');
  },

  /* -------------------------------------------------------------- banners */

  /* Centre-screen announcement. Stepped pop-in, auto-fade. Kinds: level,
   * event, bad, plain. */
  banner(text, kind, sub) {
    const layer = UI.el.bannerLayer;
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'banner' + (kind ? ' banner-' + kind : '');
    el.textContent = text;
    if (sub) {
      const s = document.createElement('span');
      s.className = 'banner-sub';
      s.textContent = sub;
      el.appendChild(s);
    }
    layer.appendChild(el);
    const rec = { el: el, t: 0 };
    UI._banners.push(rec);
    // Cap the stack: an event, a level and a milestone can land together, and
    // a tower of banners hides the game they are describing.
    while (UI._banners.length > 3) {
      const old = UI._banners.shift();
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
  },

  updateBanners(dt) {
    for (let i = UI._banners.length - 1; i >= 0; i--) {
      const b = UI._banners[i];
      b.t += dt;
      if (b.t > CFG.banner.duration) {
        if (b.el.parentNode) b.el.parentNode.removeChild(b.el);
        UI._banners.splice(i, 1);
      } else if (b.t > CFG.banner.duration - 0.4 &&
                 b.el.className.indexOf('fading') < 0) {
        b.el.className += ' fading';
      }
    }
  },

  clearBanners() {
    for (let i = 0; i < UI._banners.length; i++) {
      const el = UI._banners[i].el;
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    UI._banners.length = 0;
  },

  /* ------------------------------------------------------------- level up */

  /* `cards` is whatever the upgrade system hands over; this only renders and
   * reports the choice back through onPick. */
  showLevelUp(cards, onPick) {
    UI.el.levelupLevel.textContent = Game.level;
    UI._renderCards(UI.el.levelupCards, cards, (card) => {
      UI.hide();
      if (onPick) onPick(card);
    });
    UI.show('levelup');
  },

  showChest(tier, cards) {
    UI.el.chestKicker.textContent = tier.name;
    UI.el.chestKicker.className = 'chest-kicker chest-' + tier.id;
    UI._renderCards(UI.el.chestCards, cards, null);
    UI.show('chest');
  },

  /* Cards flip in one at a time. The stagger is the reveal -- three cards
   * appearing at once is a menu, three arriving in sequence is a moment. */
  _renderCards(host, cards, onPick) {
    host.textContent = '';
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const el = document.createElement('div');
      el.className = 'card card-in';
      el.style.animationDelay = (i * 90) + 'ms';

      if (c.icon) {
        const icon = document.createElement('canvas');
        icon.className = 'card-icon';
        icon.width = 40; icon.height = 40;
        el.appendChild(icon);
        if (typeof c.icon === 'function') c.icon(icon.getContext('2d'), 40);
      }

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = c.name;
      el.appendChild(name);

      const kind = document.createElement('div');
      kind.className = 'card-kind ' + (c.kind || 'passive');
      kind.textContent = (c.kindLabel || c.kind || '').toUpperCase();
      el.appendChild(kind);

      const desc = document.createElement('div');
      desc.className = 'card-desc';
      desc.textContent = c.desc || '';
      el.appendChild(desc);

      if (c.maxLevel) {
        const pips = document.createElement('div');
        pips.className = 'card-pips';
        for (let p = 0; p < c.maxLevel; p++) {
          const pip = document.createElement('span');
          // The pip about to be filled is the one being bought.
          pip.className = 'pip' + (p < (c.level || 0) + 1 ? ' on' : '');
          pips.appendChild(pip);
        }
        el.appendChild(pips);
      }

      if (onPick) el.addEventListener('click', () => onPick(c));
      host.appendChild(el);
      Audio2.chestCard(i);
    }
  },

  /* ------------------------------------------------------------- settings */

  _buildSettings() {
    const host = UI.el.settingsList;
    if (!host) return;
    const s = Save.settings;
    host.textContent = '';

    const row = (name, hint, control) => {
      const r = document.createElement('div');
      r.className = 'setting';
      const label = document.createElement('div');
      label.className = 'setting-name';
      label.textContent = name;
      if (hint) {
        const h = document.createElement('div');
        h.className = 'setting-hint';
        h.textContent = hint;
        label.appendChild(h);
      }
      r.appendChild(label);
      r.appendChild(control);
      host.appendChild(r);
    };

    const toggle = (key, onChange) => {
      const b = document.createElement('button');
      b.className = 'toggle' + (s[key] ? ' on' : '');
      b.textContent = s[key] ? 'ON' : 'OFF';
      b.addEventListener('click', () => {
        Save.setSetting(key, !Save.settings[key]);
        b.className = 'toggle' + (Save.settings[key] ? ' on' : '');
        b.textContent = Save.settings[key] ? 'ON' : 'OFF';
        if (onChange) onChange(Save.settings[key]);
      });
      return b;
    };

    row('SOUND', 'Procedural, no audio files.',
        toggle('sfx', (on) => { Audio2.enabled = on; if (on) Audio2.resume(); }));

    const vol = document.createElement('input');
    vol.type = 'range';
    vol.className = 'slider';
    vol.min = 0; vol.max = 100; vol.step = 5;
    vol.value = Math.round(s.volume * 100);
    vol.addEventListener('input', () => {
      const v = Number(vol.value) / 100;
      Save.setSetting('volume', v);
      Audio2.setVolume(v);
    });
    row('VOLUME', null, vol);

    const musicBtn = document.createElement('button');
    musicBtn.className = 'toggle' + (Music.enabled ? ' on' : '');
    musicBtn.textContent = Music.enabled ? 'ON' : 'OFF';
    musicBtn.addEventListener('click', () => {
      Music.setEnabled(!Music.enabled);
      musicBtn.className = 'toggle' + (Music.enabled ? ' on' : '');
      musicBtn.textContent = Music.enabled ? 'ON' : 'OFF';
    });
    row('MUSIC', Music.nowPlaying() || 'Two tracks: menu and run.', musicBtn);

    const mvol = document.createElement('input');
    mvol.type = 'range';
    mvol.className = 'slider';
    mvol.min = 0; mvol.max = 100; mvol.step = 5;
    mvol.value = Math.round(Music.volume * 100);
    mvol.addEventListener('input', () => {
      Music.setVolume(Number(mvol.value) / 100);
      Music.applyVolumeNow();
    });
    row('MUSIC VOLUME', null, mvol);

    row('SCREEN SHAKE', 'Turn off if it makes you queasy.', toggle('shake'));
    row('COLOURBLIND BADGES', 'Marks each variant with a symbol as well as a colour.',
        toggle('colourblind'));
    row('PERFORMANCE MODE', 'Thins particles and caps herd render detail.',
        toggle('performance'));
  },

  /* --------------------------------------------------------------- arenas */

  _buildArenas() {
    const host = UI.el.arenaList;
    if (!host) return;
    host.textContent = '';
    const arenas = (typeof Arenas !== 'undefined') ? Arenas.list : [{
      id: 'steppe', name: 'OPEN STEPPE', unlock: 0,
      mod: 'No modifier. Open ground in every direction.',
      swatch: CFG.palette.steppeFloorA,
    }];

    for (let i = 0; i < arenas.length; i++) {
      const a = arenas[i];
      const unlocked = Save.data.lifetime >= a.unlock;
      const card = document.createElement('div');
      card.className = 'arena-card' + (unlocked ? '' : ' locked')
                     + (Save.data.arena === a.id ? ' selected' : '');
      if (unlocked) card.dataset.arena = a.id;

      const sw = document.createElement('div');
      sw.className = 'arena-swatch';
      sw.style.background = a.swatch || CFG.palette.panelLt;
      card.appendChild(sw);

      const info = document.createElement('div');
      info.className = 'arena-info';
      const nm = document.createElement('div');
      nm.className = 'arena-name';
      nm.textContent = unlocked ? a.name : '???';
      info.appendChild(nm);

      const md = document.createElement('div');
      md.className = 'arena-mod';
      md.textContent = unlocked ? a.mod : '';
      info.appendChild(md);

      if (unlocked) {
        const best = document.createElement('div');
        best.className = 'arena-best';
        const b = (Save.data.arenaBest && Save.data.arenaBest[a.id]) || 0;
        best.textContent = 'BEST ' + U.formatNum(b);
        info.appendChild(best);
      } else {
        const lock = document.createElement('div');
        lock.className = 'arena-lock';
        lock.textContent = 'LOCKED - ' + U.formatNum(a.unlock) + ' LIFETIME SCORE';
        info.appendChild(lock);
      }
      card.appendChild(info);
      host.appendChild(card);
    }
  },

  _pickArena(id) {
    Save.set('arena', id);
    UI._buildArenas();
  },

  /* ------------------------------------------------------------- trophies */

  _buildAchievements() {
    const host = UI.el.achGrid;
    if (!host) return;
    host.textContent = '';
    const list = (typeof Achievements !== 'undefined') ? Achievements.list : [];
    if (!list.length) {
      host.innerHTML = '';
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'Trophies arrive with the achievement system.';
      host.appendChild(note);
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const got = Save.hasAchievement(a.id);
      const el = document.createElement('div');
      el.className = 'ach' + (got ? ' got' : '');
      const nm = document.createElement('div');
      nm.className = 'ach-name';
      // Hidden achievements stay hidden until earned.
      nm.textContent = (got || !a.hidden) ? a.name : '???';
      el.appendChild(nm);
      el.appendChild(document.createTextNode(
        (got || !a.hidden) ? a.desc : 'Hidden'));
      host.appendChild(el);
    }
  },

  /* ----------------------------------------------------------- collection */

  _collectionTab(tab) {
    const tabs = UI.el.collectionTabs;
    if (tabs) {
      const btns = tabs.querySelectorAll('.tab');
      for (let i = 0; i < btns.length; i++) {
        btns[i].className = 'tab' + (btns[i].dataset.tab === tab ? ' tab-on' : '');
      }
    }
    const host = UI.el.collectionBody;
    if (!host) return;
    host.textContent = '';

    const rows = UI._collectionRows(tab);
    if (!rows.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = UI._emptyNote(tab);
      host.appendChild(note);
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const el = document.createElement('div');
      el.className = 'list-row' + (r.locked ? ' locked' : '');
      const name = document.createElement('div');
      name.className = 'list-name';
      name.textContent = r.name;
      if (r.desc) {
        const d = document.createElement('div');
        d.className = 'list-desc';
        d.textContent = r.desc;
        name.appendChild(d);
      }
      el.appendChild(name);
      if (r.meta) {
        const m = document.createElement('div');
        m.className = 'list-meta';
        m.textContent = r.meta;
        el.appendChild(m);
      }
      host.appendChild(el);
    }
  },

  _collectionRows(tab) {
    if (tab === 'effects') {
      const out = [];
      const eff = Game.effects || [];
      for (let i = 0; i < eff.length; i++) {
        out.push({
          name: eff[i].name,
          // Permanent effects say so rather than showing a number that never
          // moves -- "rest of run" is the honest label.
          meta: eff[i].permanent ? 'REST OF RUN'
                                 : Math.ceil(eff[i].remaining) + 's',
        });
      }
      return out;
    }
    if (tab === 'passives' || tab === 'tools') {
      // Upgrades is the registry; there is no Game.upgrades. This read the
      // wrong object and so the Collection screen always said "Nothing yet",
      // even mid-run with three tools equipped.
      const owned = (typeof Upgrades !== 'undefined') ? Upgrades.owned(tab) : [];
      return owned.map((u) => ({
        name: u.name, desc: u.desc, meta: 'LV ' + u.level + '/' + u.maxLevel,
      }));
    }
    if (tab === 'chars') {
      const all = (typeof Characters !== 'undefined') ? Characters.list : [];
      return all.map((c) => {
        const seen = Save.data.seenChars[c.id];
        return {
          name: seen ? c.name : '???',
          desc: seen ? c.desc : 'Not yet encountered.',
          locked: !seen,
        };
      });
    }
    return [];
  },

  _emptyNote(tab) {
    if (tab === 'effects') return 'No active effects.';
    if (tab === 'chars') return 'Character aydins arrive in a later build.';
    return 'Nothing yet. Level up during a run to pick upgrades.';
  },
};
