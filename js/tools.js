/* =============================================================================
 * tools.js  --  auto-firing tools, their world effects, and the escorts.
 *
 * Tools never poll the registry. Tools.sync() rebuilds the active list from
 * Upgrades.levels whenever anything changes, and the update loop walks that
 * list. Each entry carries its own `kind`, which is the only branch:
 *
 *   cast     counts down a cooldown and fires once
 *   aura     applies continuously, no cooldown
 *   orbit    maintains escort entities
 *   passive  contributes nothing here; the buffs bag already has it
 *
 * Adding a tool is a table entry in upgrades.js, an icon, and one case in
 * _fire(). Nothing else in the game should need to know it exists.
 *
 * World effects created here (smoke, dust, decoys, barricades) live in one
 * `zones` array with a shape and a timer, so rendering and expiry are shared
 * rather than reimplemented per tool.
 * ========================================================================== */
'use strict';

const Tools = {
  active: [],      // {id, level, kind, cooldown, cd, cfg}
  zones: [],       // timed world effects
  escorts: [],

  reset() {
    Tools.active.length = 0;
    Tools.zones.length = 0;
    Tools.escorts.length = 0;
  },

  /* Rebuild the active list from what the player owns. Cooldown progress is
   * preserved across a rebuild so levelling a tool mid-cooldown does not
   * silently refund it. */
  sync() {
    const prev = Object.create(null);
    for (let i = 0; i < Tools.active.length; i++) prev[Tools.active[i].id] = Tools.active[i].cd;

    Tools.active.length = 0;
    for (const id in Upgrades.levels) {
      const u = Upgrades.byId[id];
      if (!u || u.kind !== 'tool') continue;
      const cfg = CFG.tools[id];
      if (!cfg) continue;
      const level = Upgrades.levels[id];
      const t = {
        id: id, level: level, kind: cfg.kind, cfg: cfg,
        maxLevel: u.max, icon: u.icon,
        cooldown: 0, cd: 0,
      };
      t.cooldown = Tools.cooldownOf(t);
      t.cd = (prev[id] != null) ? Math.min(prev[id], t.cooldown) : t.cooldown * 0.35;
      Tools.active.push(t);
    }
    // Stable order so the tray does not reshuffle when a tool levels.
    Tools.active.sort((a, b) => (a.id < b.id ? -1 : 1));
  },

  cooldownOf(t) {
    if (t.kind !== 'cast') return 0;
    const mul = (Game.buffs && Game.buffs.cooldownMul) || 1;
    return Math.max(0.4, t.cfg.cooldown * mul);
  },

  /* ------------------------------------------------------------- update */

  update(dt) {
    for (let i = 0; i < Tools.active.length; i++) {
      const t = Tools.active[i];
      if (t.kind === 'cast') {
        t.cooldown = Tools.cooldownOf(t);
        t.cd -= dt;
        if (t.cd <= 0) { t.cd = t.cooldown; Tools._fire(t); }
      } else if (t.kind === 'aura') {
        Tools._aura(t, dt);
      } else if (t.kind === 'orbit') {
        Tools._orbit(t, dt);
      }
    }
    Tools._updateZones(dt);
    Tools._coldAura(dt);
  },

  /* Cold Aura is a passive, not a tool, but it is an aura by behaviour and
   * this is where auras are applied. */
  _coldAura(dt) {
    const amt = Game.buffs.coldAura;
    if (!amt) return;
    const r = CFG.upgrades.coldAura.radius;
    const out = [];
    const near = Game.gohidGrid.query(Game.commander.x, Game.commander.y, r, out);
    for (let i = 0; i < near.length; i++) {
      const g = near[i];
      if (U.dist2(g.x, g.y, Game.commander.x, Game.commander.y) > r * r) continue;
      g.applySlow(Math.min(0.8, amt), 0.2);
    }
  },

  /* ---------------------------------------------------------------- cast */

  _fire(t) {
    const c = Game.commander;
    const cfg = t.cfg;
    const lv = t.level;

    switch (t.id) {
      case 'smokeBomb': {
        const r = cfg.radius + cfg.radiusPerLevel * (lv - 1);
        const d = cfg.duration + cfg.durationPerLevel * (lv - 1);
        // Blackout: blinded gohids also wander instead of holding a heading.
        Tools._zone({
          kind: 'smoke', x: c.x, y: c.y, r: r, t: d, max: d,
          colour: '#cfc6ef',
          tick: (z) => Tools._eachGohidIn(z, (g) => g.applyBlind(0.25)),
        });
        break;
      }
      case 'netTrap': {
        const d = cfg.duration + cfg.durationPerLevel * (lv - 1);
        const n = 1 + Math.floor(cfg.targetsPerLevel * (lv - 1));
        // Snare Web: roots everything in a radius instead of one target.
        if (Upgrades.hasEvolution('snareWeb')) {
          const r = CFG.evolutions.snareWeb.radius;
          Tools._eachGohidNear(c.x, c.y, r, (g) => g.applyRoot(d));
          Tools._zone({ kind: 'web', x: c.x, y: c.y, r: r, t: 0.5, max: 0.5,
                        colour: '#cbbf9a' });
        } else {
          Tools._nearestGohids(n, cfg.range).forEach((g) => g.applyRoot(d));
        }
        break;
      }
      case 'flashbang': {
        const d = cfg.duration + cfg.durationPerLevel * (lv - 1);
        // "Everything on screen" -- the visible extent, which is why this
        // reads the zoomed viewport rather than a fixed radius.
        const r = Math.max(Render.w, Render.h) / (2 * (Render.zoom || 1));
        Tools._eachGohidNear(c.x, c.y, r, (g) => g.applyStun(d));
        Game.flash = 1;
        Game.shake = Math.max(Game.shake, 8);
        break;
      }
      case 'decoyDummy': {
        const d = cfg.duration + cfg.durationPerLevel * (lv - 1);
        const lure = { x: c.x, y: c.y, dead: false };
        Tools._zone({
          kind: 'decoy', x: c.x, y: c.y, r: 26, t: d, max: d,
          colour: '#6b6386', lure: lure,
          tick: (z) => Tools._eachGohidNear(z.x, z.y, cfg.pull,
                                            (g) => { g.lure = lure; }),
          end: () => { lure.dead = true; },
        });
        // Phantom Herd: the decoy brings fake aydins with it.
        if (Upgrades.hasEvolution('phantomHerd')) {
          for (let i = 0; i < CFG.evolutions.phantomHerd.fakes; i++) {
            const a = (Math.PI * 2 * i) / CFG.evolutions.phantomHerd.fakes;
            Tools._zone({
              kind: 'phantom', x: c.x + Math.cos(a) * 50, y: c.y + Math.sin(a) * 50,
              r: 14, t: d, max: d, colour: '#6b6386',
            });
          }
        }
        break;
      }
      case 'barricade': {
        const len = cfg.length + cfg.lengthPerLevel * (lv - 1);
        // Dropped across the commander's path, so it lands between the herd
        // and whatever is chasing it.
        const a = Math.atan2(c.vy, c.vx) + Math.PI / 2;
        Tools._zone({
          kind: 'wall', x: c.x, y: c.y, r: len / 2, t: cfg.duration,
          max: cfg.duration, angle: a, colour: '#7d7392',
          tick: (z, dt2) => {
            Tools._eachGohidNear(z.x, z.y, z.r + 40, (g) => {
              // Push perpendicular to the wall: pathing "around" it without a
              // navmesh, which at these speeds reads the same.
              const dx = g.x - z.x, dy = g.y - z.y;
              const perp = -Math.sin(z.angle) * dx + Math.cos(z.angle) * dy;
              const sign = perp >= 0 ? 1 : -1;
              g.x += -Math.sin(z.angle) * sign * cfg.push * dt2;
              g.y += Math.cos(z.angle) * sign * cfg.push * dt2;
            });
          },
        });
        break;
      }
      case 'slingshot': {
        const k = cfg.knockback + cfg.knockPerLevel * (lv - 1);
        const g = Tools._nearestGohids(1, cfg.range)[0];
        if (g) {
          const a = U.angleTo(c.x, c.y, g.x, g.y);
          g.x = U.clamp(g.x + Math.cos(a) * k, CFG.world.edgePad,
                        CFG.world.width - CFG.world.edgePad);
          g.y = U.clamp(g.y + Math.sin(a) * k, CFG.world.edgePad,
                        CFG.world.height - CFG.world.edgePad);
          g.vx = 0; g.vy = 0;
          Particles.burst(g.x, g.y, 8, { speed: 160, life: 0.35, size: 3,
                                         colour: CFG.palette.gohid });
        }
        break;
      }
      case 'tunnel': {
        const d = cfg.distance + cfg.distancePerLevel * (lv - 1);
        const a = (c.vx || c.vy) ? Math.atan2(c.vy, c.vx) : 0;
        const nx = U.clamp(c.x + Math.cos(a) * d, CFG.world.edgePad,
                           CFG.world.width - CFG.world.edgePad);
        const ny = U.clamp(c.y + Math.sin(a) * d, CFG.world.edgePad,
                           CFG.world.height - CFG.world.edgePad);
        Particles.burst(c.x, c.y, 18, { speed: 220, life: 0.4, size: 3,
                                        colour: CFG.palette.rally });
        // Only the RALLIED herd comes along -- that is what makes tunnel a
        // panic button you have to set up rather than a free escape.
        const dx = nx - c.x, dy = ny - c.y;
        if (Game.rallying) {
          const rr = Game.cohesionRadius * CFG.rally.protectRadiusMul;
          for (let i = 0; i < Game.aydins.length; i++) {
            const ay = Game.aydins[i];
            if (U.dist2(ay.x, ay.y, c.x, c.y) > rr * rr) continue;
            ay.x = U.clamp(ay.x + dx, 0, CFG.world.width);
            ay.y = U.clamp(ay.y + dy, 0, CFG.world.height);
          }
        }
        c.x = nx; c.y = ny;
        Particles.burst(nx, ny, 18, { speed: 220, life: 0.4, size: 3,
                                      colour: CFG.palette.rally });
        break;
      }
      case 'bola': {
        const d = cfg.duration + cfg.durationPerLevel * (lv - 1);
        const pair = Tools._nearestGohids(2, cfg.range);
        pair.forEach((g) => g.applySlow(cfg.slow, d));
        if (pair.length === 2) {
          Tools._zone({ kind: 'chain', x: 0, y: 0, r: 0, t: d, max: d,
                        colour: '#cbbf9a', a: pair[0], b: pair[1] });
        }
        break;
      }
      case 'firecracker': {
        const r = cfg.radius + cfg.radiusPerLevel * (lv - 1);
        Tools._eachGohidNear(c.x, c.y, r, (g) => {
          g.applyBlind(cfg.flee);
          const a = U.angleTo(c.x, c.y, g.x, g.y);
          g.blindA = a;                       // sent outward, not just confused
        });
        Particles.burst(c.x, c.y, 20, { speed: 260, life: 0.4, size: 3,
                                        colour: '#ffb347' });
        Game.shake = Math.max(Game.shake, 5);
        break;
      }
    }
  },

  /* ---------------------------------------------------------------- aura */

  _aura(t, dt) {
    const c = Game.commander;
    const lv = t.level;
    const cfg = t.cfg;
    switch (t.id) {
      case 'piedPiper':
        // Contributes through the cohesion radius, read in Game._updateRally.
        break;
      case 'dustCloud': {
        const r = cfg.radius + cfg.radiusPerLevel * (lv - 1);
        const slow = cfg.slow + cfg.slowPerLevel * (lv - 1);
        Tools._eachGohidNear(c.x, c.y, r, (g) => {
          g.applySlow(Math.min(0.85, slow), 0.2);
          if (Upgrades.hasEvolution('blackout')) g.applyBlind(0.2);
        });
        break;
      }
      case 'warDrum':
        // Read by Game via buffs; see aydinSpeedAura below.
        break;
      case 'lantern':
        // Reveals stalkers; harmless until that variant exists.
        break;
    }
  },

  /* Multiplier the herd gets from aura tools. Read at the point of use rather
   * than baked into the buffs bag, because it depends on tool level which can
   * change mid-run without a rebuild. */
  aydinSpeedAura() {
    let mul = 1;
    for (let i = 0; i < Tools.active.length; i++) {
      const t = Tools.active[i];
      if (t.id !== 'warDrum') continue;
      mul *= 1 + t.cfg.speed + t.cfg.perLevel * (t.level - 1);
    }
    return mul;
  },

  /* Rally/cohesion tightening from Pied Piper, and its Iron Herd evolution. */
  cohesionRadiusMul() {
    let mul = 1;
    for (let i = 0; i < Tools.active.length; i++) {
      const t = Tools.active[i];
      if (t.id !== 'piedPiper') continue;
      mul *= Math.pow(t.cfg.radiusMul - t.cfg.perLevel * (t.level - 1), 1);
    }
    return Math.max(0.35, mul);
  },

  /* --------------------------------------------------------------- orbit */

  _orbit(t, dt) {
    const cfg = t.cfg;
    const honour = Upgrades.hasEvolution('honourGuard');
    const want = honour ? CFG.evolutions.honourGuard.count
                        : Math.floor(cfg.count + cfg.countPerLevel * (t.level - 1));

    while (Tools.escorts.length < want) {
      Tools.escorts.push({ a: Math.random() * Math.PI * 2, dead: 0, banish: honour });
    }
    Tools.escorts.length = Math.min(Tools.escorts.length, want);

    const c = Game.commander;
    for (let i = 0; i < Tools.escorts.length; i++) {
      const e = Tools.escorts[i];
      e.banish = honour;
      if (e.dead > 0) { e.dead -= dt; continue; }
      e.a += cfg.speed * dt;
      e.x = c.x + Math.cos(e.a) * cfg.radius;
      e.y = c.y + Math.sin(e.a) * cfg.radius;
    }
  },

  /* An escort intercepts one capture, then respawns. Honour Guard banishes
   * the gohid instead of merely blocking it. Returns true if it intervened. */
  intercept(gohid) {
    for (let i = 0; i < Tools.escorts.length; i++) {
      const e = Tools.escorts[i];
      if (e.dead > 0) continue;
      if (U.dist2(e.x, e.y, gohid.x, gohid.y) > 60 * 60) continue;
      e.dead = CFG.tools.outriders.respawn;
      Particles.burst(e.x, e.y, 10, { speed: 150, life: 0.4, size: 3,
                                      colour: CFG.palette.aydin });
      if (e.banish) {
        gohid.beginLeaving();
        Audio2.banish();
      }
      return true;
    }
    return false;
  },

  /* --------------------------------------------------------------- zones */

  _zone(z) { Tools.zones.push(z); },

  _updateZones(dt) {
    for (let i = Tools.zones.length - 1; i >= 0; i--) {
      const z = Tools.zones[i];
      z.t -= dt;
      if (z.tick) z.tick(z, dt);
      if (z.t <= 0) {
        if (z.end) z.end(z);
        Tools.zones.splice(i, 1);
      }
    }
  },

  _eachGohidIn(z, fn) { Tools._eachGohidNear(z.x, z.y, z.r, fn); },

  _eachGohidNear(x, y, r, fn) {
    const out = [];
    const near = Game.gohidGrid.query(x, y, r, out);
    for (let i = 0; i < near.length; i++) {
      const g = near[i];
      if (g.leaving) continue;
      if (U.dist2(g.x, g.y, x, y) > r * r) continue;
      fn(g);
    }
  },

  _nearestGohids(n, range) {
    const out = [];
    const near = Game.gohidGrid.query(Game.commander.x, Game.commander.y, range, out);
    const list = [];
    for (let i = 0; i < near.length; i++) {
      const g = near[i];
      if (g.leaving) continue;
      const d2 = U.dist2(g.x, g.y, Game.commander.x, Game.commander.y);
      if (d2 > range * range) continue;
      list.push({ g: g, d: d2 });
    }
    list.sort((a, b) => a.d - b.d);
    return list.slice(0, n).map((e) => e.g);
  },

  /* ---------------------------------------------------------------- draw */

  draw(ctx, view) {
    for (let i = 0; i < Tools.zones.length; i++) {
      const z = Tools.zones[i];
      const fade = U.quantise(Math.min(1, z.t / Math.max(0.001, z.max)), 6);

      if (z.kind === 'chain') {
        if (!z.a || !z.b) continue;
        ctx.globalAlpha = 0.35 + fade * 0.4;
        ctx.strokeStyle = z.colour;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(z.a.x, z.a.y); ctx.lineTo(z.b.x, z.b.y); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }

      if (z.kind === 'wall') {
        ctx.save();
        ctx.translate(z.x, z.y);
        ctx.rotate(z.angle);
        ctx.globalAlpha = 0.35 + fade * 0.45;
        ctx.fillStyle = z.colour;
        ctx.fillRect(-3, -z.r, 6, z.r * 2);
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }

      if (z.kind === 'decoy' || z.kind === 'phantom') {
        const cv = Sprites.tinted(z.kind === 'decoy' ? 'commander' : 'aydin',
                                  z.colour, 0.55);
        if (cv) {
          ctx.globalAlpha = 0.45 + fade * 0.35;
          const s = z.kind === 'decoy' ? CFG.commander.sprite : CFG.aydin.sprite;
          ctx.drawImage(cv, Math.round(z.x - s / 2), Math.round(z.y - s + 6), s, s);
          ctx.globalAlpha = 1;
        }
        continue;
      }

      // smoke / dust / web: a filled disc, a bright rim, and an inner ring
      // that shrinks as it expires so the zone reads as a countdown.
      //
      // Deliberately loud. At the first pass these were drawn at 0.12-0.32
      // alpha and a cast zone was genuinely hard to find on a green floor --
      // an effect the player paid a level for has to be obvious.
      ctx.globalAlpha = 0.18 + fade * 0.26;
      ctx.fillStyle = z.colour;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();

      ctx.globalAlpha = 0.55 + fade * 0.4;
      ctx.strokeStyle = z.colour;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();

      ctx.globalAlpha = 0.30 + fade * 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * fade, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Escorts ride above the zones.
    const cv = Sprites.tinted('aydin', CFG.palette.aydin, 0.5);
    for (let i = 0; i < Tools.escorts.length; i++) {
      const e = Tools.escorts[i];
      if (e.dead > 0 || e.x == null || !cv) continue;
      const s = CFG.aydin.sprite * 0.85;
      ctx.drawImage(cv, Math.round(e.x - s / 2), Math.round(e.y - s + 6), s, s);
    }
  },
};
