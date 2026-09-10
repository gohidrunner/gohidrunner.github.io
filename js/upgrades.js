/* =============================================================================
 * upgrades.js  --  the shared level map for passives AND tools.
 *
 * ONE registry, one level path. A passive and a tool differ only by their
 * `kind` field and what their apply() writes into; taking either is the same
 * code, so the card modal, the Collection screen, the level pips and the
 * evolution check never branch on which sort of thing they are holding.
 *
 * Every quantity lives in CFG.upgrades / CFG.tools. This file holds names,
 * descriptions, icons and the one line that turns a level into an effect.
 *
 * HOW EFFECTS REACH THE GAME. Nothing here mutates gameplay directly. apply()
 * writes into a plain "buffs" bag which is rebuilt FROM SCRATCH every time a
 * level is taken, and the game reads that bag at its own point of use. That
 * matters because upgrades, per-run modifiers and timed events all want to
 * scale the same handful of numbers: if each wrote a delta into the live
 * value, they could not be removed independently and an event that ended
 * would leave its multiplier behind forever. Rebuilding is O(upgrades taken),
 * runs once per level-up, and cannot drift.
 *
 * Adding an upgrade is a table entry plus its numbers in config. Adding a tool
 * is a table entry, an icon, and one case in the fire switch in tools.js.
 * ========================================================================== */
'use strict';

const Upgrades = {
  /* id -> level taken. The single source of truth for what the player owns. */
  levels: Object.create(null),
  evolved: Object.create(null),

  /* ------------------------------------------------------------- registry */

  /* `apply(b, lv)` receives the buffs bag and the level owned (1..max).
   * `desc(lv)` describes what the NEXT level does, so a card reads as a
   * promise rather than a status line. */
  list: [
    /* ---------------------------------------------------------- passives */
    {
      id: 'boots', name: 'BOOTS', kind: 'passive', max: 5,
      desc: (lv) => 'Commander speed +' + pct(CFG.upgrades.boots.perLevel * (lv + 1)),
      apply: (b, lv) => { b.commanderSpeed *= 1 + CFG.upgrades.boots.perLevel * lv; },
      icon: (g, S) => { boot(g, S); },
    },
    {
      id: 'whistle', name: 'WHISTLE', kind: 'passive', max: 5,
      desc: (lv) => 'The herd answers faster. Cohesion +'
                    + pct(CFG.upgrades.whistle.perLevel * (lv + 1)),
      apply: (b, lv) => { b.cohesionStrength *= 1 + CFG.upgrades.whistle.perLevel * lv; },
      icon: (g, S) => { ring(g, S, CFG.palette.aydin); },
    },
    {
      id: 'grazing', name: 'GRAZING', kind: 'passive', max: 5,
      desc: (lv) => 'Aydin speed +' + pct(CFG.upgrades.grazing.perLevel * (lv + 1)),
      apply: (b, lv) => { b.aydinSpeed *= 1 + CFG.upgrades.grazing.perLevel * lv; },
      icon: (g, S) => { blob(g, S, CFG.palette.aydin); },
    },
    {
      id: 'beacon', name: 'BEACON', kind: 'passive', max: 5,
      desc: (lv) => 'Recruits arrive ' + pct(CFG.upgrades.beacon.perLevel * (lv + 1))
                    + ' faster',
      apply: (b, lv) => { b.recruitMul *= 1 + CFG.upgrades.beacon.perLevel * lv; },
      icon: (g, S) => { tower(g, S); },
    },
    {
      id: 'slippery', name: 'SLIPPERY', kind: 'passive', max: 5,
      desc: (lv) => 'Gohids miss ' + pct(CFG.upgrades.slippery.perLevel * (lv + 1))
                    + ' of grabs',
      apply: (b, lv) => { b.missChance += CFG.upgrades.slippery.perLevel * lv; },
      icon: (g, S) => { drop(g, S); },
    },
    {
      id: 'wideRally', name: 'WIDE RALLY', kind: 'passive', max: 5,
      desc: (lv) => 'Rally gathers a ring '
                    + pct(CFG.upgrades.wideRally.perLevel * (lv + 1)) + ' wider',
      apply: (b, lv) => { b.rallyRadiusMul *= 1 + CFG.upgrades.wideRally.perLevel * lv; },
      icon: (g, S) => { ring(g, S, CFG.palette.rally); },
    },
    {
      id: 'ironNerve', name: 'IRON NERVE', kind: 'passive', max: 5,
      desc: (lv) => 'Panic fades ' + pct(CFG.upgrades.ironNerve.perLevel * (lv + 1))
                    + ' sooner',
      apply: (b, lv) => {
        b.panicTimeMul *= Math.max(0.1, 1 - CFG.upgrades.ironNerve.perLevel * lv);
      },
      icon: (g, S) => { shield(g, S, CFG.palette.rally); },
    },
    {
      id: 'amulet', name: 'AMULET', kind: 'passive', max: 5,
      desc: (lv) => 'Experience +' + pct(CFG.upgrades.amulet.perLevel * (lv + 1)),
      apply: (b, lv) => { b.expMul *= 1 + CFG.upgrades.amulet.perLevel * lv; },
      icon: (g, S) => { gem(g, S, CFG.palette.exp); },
    },
    {
      id: 'clover', name: 'CLOVER', kind: 'passive', max: 5,
      desc: (lv) => 'Luck +' + pct(CFG.upgrades.clover.perLevel * (lv + 1))
                    + '. Better cards and chests',
      apply: (b, lv) => { b.luck += CFG.upgrades.clover.perLevel * lv; },
      icon: (g, S) => { gem(g, S, CFG.palette.good); },
    },
    {
      id: 'coldAura', name: 'COLD AURA', kind: 'passive', max: 5,
      desc: (lv) => 'Gohids near the herd slowed '
                    + pct(CFG.upgrades.coldAura.perLevel * (lv + 1)),
      apply: (b, lv) => { b.coldAura += CFG.upgrades.coldAura.perLevel * lv; },
      icon: (g, S) => { ring(g, S, '#9fd8ff'); },
    },
    {
      id: 'longLegs', name: 'LONG LEGS', kind: 'passive', max: 5,
      desc: (lv) => 'Rally costs ' + pct(CFG.upgrades.longLegs.perLevel * (lv + 1))
                    + ' less speed',
      apply: (b, lv) => {
        b.rallySlowRelief = Math.min(1, b.rallySlowRelief
                                      + CFG.upgrades.longLegs.perLevel * lv);
      },
      icon: (g, S) => { boot(g, S, CFG.palette.rally); },
    },
    {
      id: 'secondWind', name: 'SECOND WIND', kind: 'passive', max: 1,
      desc: () => 'Once per run, below ' + CFG.upgrades.secondWind.threshold
                  + ' aydins, ' + CFG.upgrades.secondWind.revive + ' return',
      apply: (b) => { b.secondWind = true; },
      icon: (g, S) => { heart(g, S); },
    },
    {
      id: 'sharpEyes', name: 'SHARP EYES', kind: 'passive', max: 5,
      desc: (lv) => 'Pickup magnet +' + pct(CFG.upgrades.sharpEyes.perLevel * (lv + 1)),
      apply: (b, lv) => { b.magnetMul *= 1 + CFG.upgrades.sharpEyes.perLevel * lv; },
      icon: (g, S) => { eye(g, S); },
    },
    {
      id: 'thickHide', name: 'THICK HIDE', kind: 'passive', max: 5,
      desc: (lv) => 'Scatters end ' + pct(CFG.upgrades.thickHide.perLevel * (lv + 1))
                    + ' sooner',
      apply: (b, lv) => {
        b.scatterMul *= Math.max(0.15, 1 - CFG.upgrades.thickHide.perLevel * lv);
      },
      icon: (g, S) => { shield(g, S, '#b08a5a'); },
    },
    {
      id: 'vanguard', name: 'VANGUARD', kind: 'passive', max: 5,
      desc: (lv) => 'The leading ' + pct(CFG.upgrades.vanguard.perLevel * (lv + 1))
                    + ' of the herd cannot be grabbed',
      apply: (b, lv) => { b.vanguard += CFG.upgrades.vanguard.perLevel * lv; },
      icon: (g, S) => { shield(g, S, CFG.palette.aydin); },
    },
    {
      id: 'fastHands', name: 'FAST HANDS', kind: 'passive', max: 5,
      desc: (lv) => 'Tool cooldowns -' + pct(CFG.upgrades.fastHands.perLevel * (lv + 1)),
      apply: (b, lv) => {
        b.cooldownMul *= Math.max(0.2, 1 - CFG.upgrades.fastHands.perLevel * lv);
      },
      icon: (g, S) => { clock(g, S); },
    },
    {
      id: 'bigHeart', name: 'BIG HEART', kind: 'passive', max: 5,
      desc: (lv) => 'Character aydins appear '
                    + pct(CFG.upgrades.bigHeart.perLevel * (lv + 1)) + ' more often',
      apply: (b, lv) => { b.charSpawnMul *= 1 + CFG.upgrades.bigHeart.perLevel * lv; },
      icon: (g, S) => { heart(g, S, CFG.palette.aydin); },
    },
    {
      id: 'stampede', name: 'STAMPEDE', kind: 'passive', max: 5,
      desc: (lv) => 'After any capture the herd runs +'
                    + pct(CFG.upgrades.stampede.perLevel * (lv + 1)) + ' for '
                    + CFG.upgrades.stampede.duration + 's',
      apply: (b, lv) => { b.stampede += CFG.upgrades.stampede.perLevel * lv; },
      icon: (g, S) => { arrows(g, S); },
    },

    /* ------------------------------------------------------------- tools */
    tool('smokeBomb', 'SMOKE BOMB',
         (lv) => 'Blinds gohids in a radius for ' + dur('smokeBomb', lv) + 's',
         (g, S) => cloud(g, S, '#8d86a8')),
    tool('netTrap', 'NET TRAP',
         (lv) => 'Roots the nearest gohid for ' + dur('netTrap', lv) + 's',
         (g, S) => net(g, S)),
    tool('flashbang', 'FLASHBANG',
         (lv) => 'Stuns every gohid on screen for ' + dur('flashbang', lv) + 's',
         (g, S) => star(g, S, '#ffffff')),
    tool('decoyDummy', 'DECOY DUMMY',
         (lv) => 'A false commander pulls gohids for ' + dur('decoyDummy', lv) + 's',
         (g, S) => figure(g, S, '#6b6386')),
    tool('barricade', 'BARRICADE',
         () => 'Drops a wall gohids are pushed around',
         (g, S) => wall(g, S)),
    tool('slingshot', 'SLINGSHOT',
         (lv) => 'Knocks the nearest gohid back '
                 + Math.round(CFG.tools.slingshot.knockback
                              + CFG.tools.slingshot.knockPerLevel * (lv - 1)) + 'px',
         (g, S) => sling(g, S)),
    tool('tunnel', 'TUNNEL',
         (lv) => 'Teleports you and the rallied herd '
                 + Math.round(CFG.tools.tunnel.distance
                              + CFG.tools.tunnel.distancePerLevel * (lv - 1)) + 'px',
         (g, S) => hole(g, S)),
    tool('bola', 'BOLA',
         (lv) => 'Chains two gohids together, both slowed, ' + dur('bola', lv) + 's',
         (g, S) => bolaIcon(g, S)),
    tool('firecracker', 'FIRECRACKER',
         () => 'Scares nearby gohids away from the herd',
         (g, S) => star(g, S, '#ffb347')),

    tool('piedPiper', 'PIED PIPER',
         () => 'Aura: the herd sticks to you like glue',
         (g, S) => ring(g, S, CFG.palette.aydin)),
    tool('dustCloud', 'DUST CLOUD',
         (lv) => 'Aura: gohids inside are slowed '
                 + pct(CFG.tools.dustCloud.slow
                       + CFG.tools.dustCloud.slowPerLevel * (lv - 1)),
         (g, S) => cloud(g, S, '#c9bd96')),
    tool('warDrum', 'WAR DRUM',
         (lv) => 'Aura: every aydin runs +'
                 + pct(CFG.tools.warDrum.speed
                       + CFG.tools.warDrum.perLevel * (lv - 1)),
         (g, S) => drum(g, S)),
    tool('lantern', 'LANTERN',
         () => 'Aura: reveals stalkers and marks hunters',
         (g, S) => lamp(g, S)),

    tool('outriders', 'OUTRIDERS',
         (lv) => Math.floor(CFG.tools.outriders.count
                            + CFG.tools.outriders.countPerLevel * (lv - 1))
                 + ' escorts circle the herd. Each blocks one capture',
         (g, S) => escorts(g, S)),
    tool('shepherds', "SHEPHERD'S MARK",
         () => 'Character aydin abilities +'
               + pct(CFG.tools.shepherds.charBoost),
         (g, S) => star(g, S, CFG.palette.aydin)),
  ],

  byId: Object.create(null),

  init() {
    Upgrades.byId = Object.create(null);
    for (let i = 0; i < Upgrades.list.length; i++) {
      Upgrades.byId[Upgrades.list[i].id] = Upgrades.list[i];
    }
  },

  reset() {
    Upgrades.levels = Object.create(null);
    Upgrades.evolved = Object.create(null);
    Upgrades.rebuild();
  },

  levelOf(id) { return Upgrades.levels[id] || 0; },
  isMaxed(u) { return Upgrades.levelOf(u.id) >= u.max; },

  owned(kind) {
    const out = [];
    for (let i = 0; i < Upgrades.list.length; i++) {
      const u = Upgrades.list[i];
      const lv = Upgrades.levelOf(u.id);
      if (!lv) continue;
      if (kind === 'passives' && u.kind !== 'passive') continue;
      if (kind === 'tools' && u.kind !== 'tool') continue;
      out.push({ name: u.name, desc: u.desc(lv), level: lv, maxLevel: u.max });
    }
    return out;
  },

  /* ------------------------------------------------------------- buffs */

  /* A fresh bag every time. See the header for why this is rebuilt rather
   * than incremented. */
  _blank() {
    return {
      commanderSpeed: 1, aydinSpeed: 1, cohesionStrength: 1, recruitMul: 1,
      expMul: 1, rallyRadiusMul: 1, panicTimeMul: 1, scatterMul: 1,
      cooldownMul: 1, magnetMul: 1, charSpawnMul: 1,
      missChance: 0, luck: 0, coldAura: 0, vanguard: 0, stampede: 0,
      rallySlowRelief: 0, secondWind: false,
    };
  },

  rebuild() {
    const b = Upgrades._blank();
    for (const id in Upgrades.levels) {
      const u = Upgrades.byId[id];
      if (u && u.apply) u.apply(b, Upgrades.levels[id]);
    }
    Game.buffs = b;
    Tools.sync();
    Game.recomputeMods();
    return b;
  },

  /* ------------------------------------------------------------- taking */

  take(id) {
    const u = Upgrades.byId[id];
    if (!u) return;
    Upgrades.levels[id] = Math.min(u.max, Upgrades.levelOf(id) + 1);
    Upgrades.rebuild();
    Upgrades.checkEvolutions();
  },

  /* --------------------------------------------------------- card offers */

  /* Three cards, never offering something already maxed. Luck tilts the roll
   * toward tools, so a lucky level feels different rather than merely bigger.
   * If every upgrade is maxed the pool is empty and the caller skips the
   * modal rather than showing three blanks. */
  offer(count) {
    const n = count || CFG.cards.count;
    const luck = (Game.buffs && Game.buffs.luck) || 0;
    const pool = [];
    for (let i = 0; i < Upgrades.list.length; i++) {
      const u = Upgrades.list[i];
      if (Upgrades.isMaxed(u)) continue;
      if (Upgrades.evolved[u.id]) continue;      // consumed by a fusion
      let w = (u.kind === 'tool')
        ? CFG.cards.baseToolWeight + luck * CFG.cards.luckToolBonus
        : CFG.cards.basePassiveWeight;
      // A tool already owned is likelier than a brand new one, so runs
      // converge on a build instead of collecting singles.
      if (u.kind === 'tool' && Upgrades.levelOf(u.id) > 0) w *= 1.6;
      pool.push({ u: u, w: w });
    }
    const picked = [];
    for (let k = 0; k < n && pool.length; k++) {
      let total = 0;
      for (let i = 0; i < pool.length; i++) total += pool[i].w;
      let r = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].w;
        if (r <= 0) { idx = i; break; }
      }
      const u = pool[idx].u;
      pool.splice(idx, 1);
      const lv = Upgrades.levelOf(u.id);
      picked.push({
        id: u.id, name: u.name, kind: u.kind,
        kindLabel: u.kind === 'tool' ? 'TOOL' : 'PASSIVE',
        desc: u.desc(lv), level: lv, maxLevel: u.max, icon: u.icon,
      });
    }
    return picked;
  },

  /* -------------------------------------------------------- evolutions */

  /* Both ingredients at max fuse automatically, with a flash and a freeze. */
  checkEvolutions() {
    for (const id in CFG.evolutions) {
      if (Upgrades.evolved[id]) continue;
      const e = CFG.evolutions[id];
      let ok = true;
      for (let i = 0; i < e.from.length; i++) {
        const u = Upgrades.byId[e.from[i]];
        if (!u || Upgrades.levelOf(u.id) < u.max) { ok = false; break; }
      }
      if (ok && e.needsCharacter) {
        ok = (Game.characters || []).some(
          (c) => c.id === e.needsCharacter && c.alive);
      }
      if (!ok) continue;
      Upgrades.evolved[id] = true;
      Game.freeze = 0.45;                      // freeze-frame on the fusion
      Game.flash = 1;
      Audio2.levelUp();
      UI.banner(EVO_NAMES[id] || id.toUpperCase(), 'level', 'EVOLVED');
      Tools.sync();
    }
  },

  hasEvolution(id) { return !!Upgrades.evolved[id]; },
};

const EVO_NAMES = {
  blackout: 'BLACKOUT',
  snareWeb: 'SNARE WEB',
  ironHerd: 'IRON HERD',
  phantomHerd: 'PHANTOM HERD',
  honourGuard: 'HONOUR GUARD',
};

/* ------------------------------------------------------------- helpers */

function pct(v) { return Math.round(v * 100) + '%'; }

function dur(id, lv) {
  const t = CFG.tools[id];
  return (t.duration + (t.durationPerLevel || 0) * Math.max(0, lv - 1)).toFixed(1);
}

/* Every tool shares one shape, so the registry stays readable. */
function tool(id, name, desc, icon) {
  return {
    id: id, name: name, kind: 'tool', max: 5,
    desc: (lv) => desc(Math.max(1, lv + 1)),
    icon: icon,
    apply: () => {},          // tools act through Tools.sync(), not the bag
  };
}

/* ---------------------------------------------------------------- icons
 * Drawn, never emoji. Each is a few filled rects on a 40px canvas -- these
 * are read at a glance on a card and at 40px in the tool tray. */
function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

function ring(g, S, c) {
  g.strokeStyle = c; g.lineWidth = 3;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2); g.stroke();
  px(g, S / 2 - 2, S / 2 - 2, 4, 4, c);
}
function blob(g, S, c) {
  px(g, 10, 16, 20, 12, c);
  px(g, 14, 10, 12, 8, c);
  px(g, 12, 28, 4, 6, '#5c4433'); px(g, 24, 28, 4, 6, '#5c4433');
}
function boot(g, S, c) {
  const col = c || '#b08a5a';
  px(g, 12, 8, 8, 16, col); px(g, 12, 24, 18, 6, col);
  px(g, 10, 30, 22, 3, '#3a3350');
}
function tower(g, S) {
  px(g, 16, 8, 8, 20, '#8d86a8'); px(g, 12, 28, 16, 5, '#5c5578');
  px(g, 14, 4, 12, 5, CFG.palette.aydin);
}
function drop(g, S) {
  px(g, 18, 8, 4, 8, CFG.palette.rally);
  px(g, 15, 14, 10, 12, CFG.palette.rally);
  px(g, 17, 26, 6, 4, CFG.palette.rally);
}
function shield(g, S, c) {
  px(g, 12, 8, 16, 14, c); px(g, 14, 22, 12, 6, c); px(g, 18, 28, 4, 4, c);
}
function gem(g, S, c) {
  px(g, 16, 8, 8, 4, c); px(g, 12, 12, 16, 10, c); px(g, 16, 22, 8, 8, c);
}
function heart(g, S, c) {
  const col = c || CFG.palette.gohid;
  px(g, 10, 12, 8, 8, col); px(g, 22, 12, 8, 8, col);
  px(g, 12, 18, 16, 6, col); px(g, 16, 24, 8, 6, col);
}
function eye(g, S) {
  px(g, 8, 16, 24, 8, '#ece6f5'); px(g, 16, 14, 8, 12, '#ece6f5');
  px(g, 17, 17, 6, 6, CFG.palette.rally); px(g, 19, 19, 2, 2, '#0d0b14');
}
function clock(g, S) {
  ring(g, S, '#9fd8ff');
  px(g, 19, 12, 2, 9, '#9fd8ff'); px(g, 20, 19, 7, 2, '#9fd8ff');
}
function arrows(g, S) {
  for (let i = 0; i < 3; i++) {
    px(g, 8 + i * 9, 14, 6, 3, CFG.palette.aydin);
    px(g, 11 + i * 9, 11, 3, 3, CFG.palette.aydin);
    px(g, 11 + i * 9, 17, 3, 3, CFG.palette.aydin);
  }
}
function cloud(g, S, c) {
  px(g, 8, 18, 24, 8, c); px(g, 12, 12, 8, 8, c); px(g, 20, 14, 8, 6, c);
}
function net(g, S) {
  g.strokeStyle = '#cbbf9a'; g.lineWidth = 2;
  for (let i = 0; i <= 3; i++) {
    g.beginPath(); g.moveTo(8 + i * 8, 8); g.lineTo(8 + i * 8, 32); g.stroke();
    g.beginPath(); g.moveTo(8, 8 + i * 8); g.lineTo(32, 8 + i * 8); g.stroke();
  }
}
function star(g, S, c) {
  px(g, 18, 6, 4, 28, c); px(g, 6, 18, 28, 4, c);
  px(g, 11, 11, 5, 5, c); px(g, 24, 24, 5, 5, c);
  px(g, 24, 11, 5, 5, c); px(g, 11, 24, 5, 5, c);
}
function figure(g, S, c) {
  px(g, 16, 6, 8, 8, c); px(g, 12, 14, 16, 12, c);
  px(g, 14, 26, 4, 8, c); px(g, 22, 26, 4, 8, c);
}
function wall(g, S) {
  px(g, 6, 14, 28, 6, '#7d7392'); px(g, 6, 22, 28, 6, '#5c5578');
  px(g, 14, 14, 2, 14, '#3a3350'); px(g, 24, 14, 2, 14, '#3a3350');
}
function sling(g, S) {
  px(g, 10, 8, 4, 12, '#b08a5a'); px(g, 26, 8, 4, 12, '#b08a5a');
  px(g, 14, 18, 12, 3, '#cbbf9a'); px(g, 18, 22, 6, 6, '#9a8fb5');
}
function hole(g, S) {
  g.fillStyle = '#0d0b14';
  g.beginPath(); g.ellipse(S / 2, S / 2, 13, 8, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = CFG.palette.rally; g.lineWidth = 3;
  g.beginPath(); g.ellipse(S / 2, S / 2, 13, 8, 0, 0, Math.PI * 2); g.stroke();
}
function bolaIcon(g, S) {
  px(g, 8, 10, 8, 8, '#9a8fb5'); px(g, 24, 22, 8, 8, '#9a8fb5');
  g.strokeStyle = '#cbbf9a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(14, 16); g.lineTo(26, 26); g.stroke();
}
function drum(g, S) {
  px(g, 10, 12, 20, 16, '#8a4b3a'); px(g, 10, 10, 20, 4, '#cbbf9a');
  px(g, 10, 26, 20, 4, '#cbbf9a');
}
function lamp(g, S) {
  px(g, 16, 6, 8, 4, '#8d86a8'); px(g, 12, 10, 16, 16, CFG.palette.score);
  px(g, 14, 26, 12, 4, '#8d86a8');
}
function escorts(g, S) {
  ring(g, S, '#5c5578');
  px(g, 18, 4, 5, 5, CFG.palette.aydin);
  px(g, 31, 18, 5, 5, CFG.palette.aydin);
  px(g, 18, 31, 5, 5, CFG.palette.aydin);
  px(g, 4, 18, 5, 5, CFG.palette.aydin);
}
