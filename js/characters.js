/* =============================================================================
 * characters.js  --  the named aydins, and what each of them does.
 *
 * A character aydin is an ordinary Aydin with a `character` field pointing at
 * one of these instances. It flocks, panics and dies like any other member of
 * the herd -- that is the whole point. The player has to protect something
 * specific while it behaves exactly like the crowd it is hiding in.
 *
 * Only one of each may exist at a time. Losing one is meant to hurt: the HUD
 * portrait shatters and the worst sound in the game plays.
 *
 * ABILITIES ARE PULL, NOT PUSH. Nothing here reaches into the game loop to
 * change a number. Each ability either (a) runs on its own timer inside
 * update(), or (b) exposes a query the relevant system calls at its own point
 * of use -- speedFor(), cohesionMul(), expMul(), and so on. That keeps
 * character effects removable the moment the character dies, with no state to
 * unwind, which is exactly the problem the buffs bag solves for upgrades.
 * ========================================================================== */
'use strict';

const Characters = {
  active: [],       // live instances, in arrival order
  timer: 0,

  /* ------------------------------------------------------------- registry */

  list: [
    {
      id: 'shield', name: 'SHIELD', badge: 'S', colour: '#8ab6ff',
      desc: 'Body-blocks the next capture anywhere in the herd, then becomes '
          + 'an ordinary aydin.',
    },
    {
      id: 'medic', name: 'MEDIC', badge: '+', colour: '#7ee081',
      desc: 'Each captured aydin has a chance to be recovered, reappearing '
          + 'beside you in a panic.',
    },
    {
      id: 'trickster', name: 'TRICKSTER', badge: '?', colour: '#b96ad6',
      desc: 'Drops a decoy every few seconds that nearby gohids chase.',
    },
    {
      id: 'bard', name: 'BARD', badge: 'J', colour: '#ffcc6a',
      desc: 'Every aydin near it runs faster.',
    },
    {
      id: 'banner', name: 'BANNER', badge: 'T', colour: '#ff9a4a',
      desc: 'The whole herd keeps closer to you.',
    },
    {
      id: 'scout', name: 'SCOUT', badge: 'O', colour: '#5ad1c4',
      desc: 'Triples pickup reach and marks pickups and chests on the minimap.',
    },
    {
      id: 'trapper', name: 'TRAPPER', badge: 'X', colour: '#cbbf9a',
      desc: 'Leaves a trail behind the herd. Gohids crossing it are slowed.',
    },
    {
      id: 'warden', name: 'WARDEN', badge: 'W', colour: '#ece6f5',
      desc: 'Periodically banishes the gohid nearest the herd, permanently.',
    },
    {
      id: 'hound', name: 'HOUND', badge: 'H', colour: '#d69a4a',
      desc: 'Pushes strays back toward the pack.',
    },
    {
      id: 'elder', name: 'ELDER', badge: 'E', colour: '#ffe9b0',
      desc: 'Large experience bonus while alive. No survival value at all.',
    },
  ],

  byId: Object.create(null),

  init() {
    Characters.byId = Object.create(null);
    for (let i = 0; i < Characters.list.length; i++) {
      Characters.byId[Characters.list[i].id] = Characters.list[i];
    }
  },

  reset() {
    Characters.active.length = 0;
    Characters.timer = CFG.characters.interval;
  },

  /* Shepherd's Mark scales every ability. Applied here rather than in config
   * so the same number cannot be forgotten by one ability and not another. */
  _boost() {
    const owned = (typeof Upgrades !== 'undefined')
      ? Upgrades.levelOf('shepherds') : 0;
    return owned > 0 ? 1 + CFG.tools.shepherds.charBoost : 1;
  },

  alive(id) {
    for (let i = 0; i < Characters.active.length; i++) {
      const c = Characters.active[i];
      if (c.id === id && c.alive) return c;
    }
    return null;
  },

  /* ------------------------------------------------------------- spawning */

  update(dt) {
    Characters._prune();

    const C = CFG.characters;
    const ramp = Math.min(1, Game.time / C.rampTime);
    const rate = (Game.buffs ? Game.buffs.charSpawnMul : 1);
    const interval = U.lerp(C.interval, C.intervalMin, ramp) / rate;

    Characters.timer -= dt;
    if (Characters.timer <= 0) {
      Characters.timer = interval;
      Characters.spawn();
    }

    for (let i = 0; i < Characters.active.length; i++) {
      const c = Characters.active[i];
      if (!c.alive) continue;
      Characters._ability(c, dt);
    }

    Characters._applyAuras();
  },

  /* A character whose aydin was captured stays in the list so the HUD can
   * show its shattered portrait for the rest of the run. */
  _prune() {
    for (let i = 0; i < Characters.active.length; i++) {
      const c = Characters.active[i];
      if (c.alive && (!c.aydin || !c.aydin.alive)) {
        c.alive = false;
        Game.stats.charactersLost++;
      }
    }
  },

  spawn() {
    // One of each at a time, and never re-spawn one that has been lost --
    // otherwise the loss is only a temporary inconvenience.
    const taken = Object.create(null);
    for (let i = 0; i < Characters.active.length; i++) taken[Characters.active[i].id] = true;
    const pool = Characters.list.filter((d) => !taken[d.id]);
    if (!pool.length) return null;

    const def = U.pick(pool);
    const c = Game.commander;
    const a = U.rand(0, Math.PI * 2);
    const d = CFG.characters.spawnDist;
    const aydin = new Aydin(
      U.clamp(c.x + Math.cos(a) * d, CFG.world.edgePad, CFG.world.width - CFG.world.edgePad),
      U.clamp(c.y + Math.sin(a) * d, CFG.world.edgePad, CFG.world.height - CFG.world.edgePad),
      false);
    aydin.invuln = CFG.characters.invuln;

    const inst = {
      id: def.id, name: def.name, badge: def.badge, colour: def.colour,
      desc: def.desc, alive: true, aydin: aydin,
      t: 0, charges: def.id === 'shield' ? CFG.characters.shield.blocks : 0,
    };
    aydin.character = inst;

    Game.aydins.push(aydin);
    Characters.active.push(inst);
    Game.stats.charactersSeen++;

    if (typeof Save !== 'undefined' && Save.data) Save.markCharSeen(def.id);
    UI.banner(def.name, 'event', 'HAS JOINED THE HERD');
    Audio2.eventBanner();
    return inst;
  },

  /* ------------------------------------------------------------ abilities */

  _ability(c, dt) {
    c.t += dt;
    const B = Characters._boost();
    const a = c.aydin;

    switch (c.id) {
      case 'trickster': {
        const cfg = CFG.characters.trickster;
        if (c.t < cfg.every / B) break;
        c.t = 0;
        // Reuses the decoy zone the Decoy Dummy tool already defines, so there
        // is one lure implementation rather than two that drift apart.
        const lure = { x: a.x, y: a.y, dead: false };
        Tools._zone({
          kind: 'decoy', x: a.x, y: a.y, r: 20,
          t: cfg.duration * B, max: cfg.duration * B, colour: c.colour,
          lure: lure,
          tick: (z) => Tools._eachGohidNear(z.x, z.y, cfg.pull,
                                            (g) => { g.lure = lure; }),
          end: () => { lure.dead = true; },
        });
        break;
      }

      case 'trapper': {
        const cfg = CFG.characters.trapper;
        if (c.t < cfg.every) break;
        c.t = 0;
        Tools._zone({
          kind: 'trail', x: a.x, y: a.y, r: cfg.radius,
          t: cfg.life, max: cfg.life, colour: c.colour,
          tick: (z) => Tools._eachGohidIn(z, (g) => {
            g.applySlow(Math.min(0.85, cfg.slow * B), cfg.duration);
          }),
        });
        break;
      }

      case 'warden': {
        const cfg = CFG.characters.warden;
        if (c.t < cfg.every / B) break;
        c.t = 0;
        // Nearest to the HERD, not to the commander -- the warden protects the
        // aydins, which is often not where the player is standing.
        const g = Game.gohidGrid.nearest(a.x, a.y, 1400, (x) => !x.leaving);
        if (g) {
          Game.banishGohid(g);
          UI.banner('BANISHED', 'level');
        }
        break;
      }

      case 'hound': {
        const cfg = CFG.characters.hound;
        const cmd = Game.commander;
        // Strays only. Walking the whole herd every frame is fine at these
        // counts and avoids a second spatial structure.
        for (let i = 0; i < Game.aydins.length; i++) {
          const s = Game.aydins[i];
          if (s === a) continue;
          const dx = cmd.x - s.x, dy = cmd.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < cfg.strayDist) continue;
          s.vx += (dx / dist) * cfg.push * B * dt;
          s.vy += (dy / dist) * cfg.push * B * dt;
        }
        break;
      }
    }
  },

  /* Bard's speed aura, applied as a per-aydin stamp. Runs once per frame
   * before the herd moves; Aydin.update reads the stamp. A stamp rather than a
   * reset pass means the herd is walked once, not twice. */
  _applyAuras() {
    const bard = Characters.alive('bard');
    if (!bard || !bard.aydin) return;
    const cfg = CFG.characters.bard;
    const mul = 1 + cfg.speed * Characters._boost();
    const out = [];
    const near = Game.aydinGrid.query(bard.aydin.x, bard.aydin.y, cfg.radius, out);
    for (let i = 0; i < near.length; i++) {
      const s = near[i];
      if (U.dist2(s.x, s.y, bard.aydin.x, bard.aydin.y) > cfg.radius * cfg.radius) continue;
      s.auraSpeed = mul;
      s.auraStamp = Game.frame;
    }
  },

  /* ---------------------------------------------------------- queries ----
   * These are the "pull" side: systems ask, rather than being written into. */

  /* Shield: consumes a charge to block one capture anywhere in the herd, then
   * reverts to an ordinary aydin. */
  consumeShield() {
    const s = Characters.alive('shield');
    if (!s || s.charges <= 0) return false;
    s.charges--;
    if (s.charges <= 0) {
      s.spent = true;
      UI.banner('SHIELD BROKEN', 'bad');
    }
    return true;
  },

  /* Medic: a chance to recover a captured aydin beside the commander. */
  tryRecover(x, y) {
    const m = Characters.alive('medic');
    if (!m) return false;
    if (Math.random() >= CFG.characters.medic.chance * Characters._boost()) return false;
    const c = Game.commander;
    const a = new Aydin(c.x + U.rand(-40, 40), c.y + U.rand(-40, 40), false);
    a.invuln = 0.6;
    a.panic = CFG.aydin.panicTime;      // it comes back frightened
    Game.aydins.push(a);
    Particles.burst(a.x, a.y, 10, {
      speed: 120, life: 0.4, size: 3, colour: '#7ee081',
    });
    return true;
  },

  /* Banner: the whole herd holds a tighter radius. */
  cohesionMul() {
    return Characters.alive('banner')
      ? 1 - CFG.characters.banner.cohesionCut * Characters._boost() : 1;
  },

  expMul() {
    return Characters.alive('elder')
      ? 1 + CFG.characters.elder.exp * Characters._boost() : 1;
  },

  magnetMul() {
    return Characters.alive('scout') ? CFG.characters.scout.magnet : 1;
  },

  marksPickups() { return !!Characters.alive('scout'); },
};
