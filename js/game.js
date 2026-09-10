/* =============================================================================
 * game.js  --  world state and the update loop.
 *
 * The whole design rests on one feedback loop, and it lives in _resolveCaptures
 * below: a captured aydin does not merely subtract from the herd, it ADDS to
 * the thing hunting the herd. Score and danger are the same number pulled in
 * opposite directions, which is why the herd is both the score and the bomb.
 *
 * Update order within a frame matters and is fixed:
 *   input -> rally -> rebuild grids -> move -> resolve -> spawn -> compact
 * Grids are rebuilt before anything moves, so every entity in a frame steers
 * against the same snapshot of the world rather than against a half-updated
 * one (which would make behaviour depend on array order).
 * ========================================================================== */
'use strict';

const Game = {
  state: 'title',            // title | playing | dead
  commander: null,
  aydins: [],
  gohids: [],
  pending: [],               // gohids mid-telegraph: {x, y, t}

  aydinGrid: null,
  gohidGrid: null,

  // Owned by systems that do not exist yet. They are declared here, empty, so
  // the HUD and minimap can iterate them unconditionally instead of guarding
  // every access -- and so adding those systems is filling an array rather
  // than teaching the UI a new shape.
  tools: [],
  characters: [],
  frame: 0,                  // frame counter, used for per-frame aura stamps
  hornT: 0,                  // Rally Horn: a free perfect rally
  idolT: 0,                  // Cursed Idol: timed score bonus
  idolMul: 1,
  effects: [],
  pickups: [],
  chests: [],

  time: 0,
  score: 0,
  exp: 0,                    // toward the next level, reset on each level up
  expToNext: 0,
  level: 1,
  rallying: false,
  cohesionRadius: CFG.aydin.flock.cohesionRadius,
  scatterTimer: 0,

  recruitTimer: 0,
  ambientTimer: 0,
  _attractGoal: null,

  shake: 0,
  hitFlash: 0,               // red vignette pulse when an aydin is lost
  gainFlash: 0,
  flash: 0,                  // white full-screen pop (evolutions, flashbang)
  freeze: 0,                 // freeze-frame seconds; see the note in update()
  stampedeT: 0,
  secondWindUsed: false,

  // Derived from the upgrades a player owns. Rebuilt whole, never patched --
  // see the header of js/upgrades.js for why.
  buffs: null,

  // Values entities read every frame that upgrades are allowed to change.
  // Recomputed only when an upgrade is taken, so the hot loop reads a plain
  // number instead of walking the upgrade list.
  tuning: {
    panicTime: CFG.aydin.panicTime,
    cohesionStrength: 1,
    rallySlow: CFG.commander.rallySlow,
  },

  // Multipliers that later systems (upgrades, modifiers, events) write into.
  // Nothing in step 1 changes them; they exist so that when those systems land
  // they never have to touch the movement code.
  mods: {
    commanderSpeed: 1,
    aydinSpeed: 1,
    gohidSpeed: 1,
    scoreMul: 1,
    recruitMul: 1,
    expMul: 1,
  },

  stats: null,

  /* ------------------------------------------------------------------ init */

  init() {
    Game.aydinGrid = new SpatialGrid(64, CFG.world.width, CFG.world.height);
    Game.gohidGrid = new SpatialGrid(128, CFG.world.width, CFG.world.height);
    Particles.init();
    Game.reset();
  },

  reset() {
    Game.commander = new Commander(CFG.world.width / 2, CFG.world.height / 2);
    Game.aydins.length = 0;
    Game.gohids.length = 0;
    Game.pending.length = 0;
    Particles.clear();

    Game.time = 0;
    Game.score = 0;
    Game.exp = 0;
    Game.level = 1;
    Game.expToNext = Game.expForLevel(1);
    Game.rallying = false;
    Game.cohesionRadius = CFG.aydin.flock.cohesionRadius;
    Game.scatterTimer = 0;
    Game.recruitTimer = CFG.recruit.interval;
    Game.ambientTimer = CFG.gohid.ambient.interval;
    Game.shake = 0;
    Game.hitFlash = 0;
    Game.gainFlash = 0;
    Game.flash = 0;
    Game.freeze = 0;
    Game.stampedeT = 0;
    Game.secondWindUsed = false;
    Upgrades.reset();
    Tools.reset();
    Characters.reset();
    Events.reset();
    Pickups.reset();
    Game.hornT = 0;
    Game.idolT = 0;
    Game.idolMul = 1;
    Game.tools = Tools.active;
    Game.characters = Characters.active;

    Game.stats = {
      peakHerd: 0, lost: 0, created: 0, banished: 0,
      scatters: 0, time: 0, score: 0, level: 1,
      charactersSeen: 0, charactersLost: 0, recovered: 0,
      pickups: 0, chests: 0, events: 0,
    };

    // The per-run modifier is rolled BEFORE the herd is placed, because two of
    // them change what the starting board even is.
    const mod = Events.rollModifier();

    // Starting herd, ringed around the commander so the first second reads as
    // "this is yours to protect" rather than "collect these".
    const c = Game.commander;
    const startHerd = (mod && mod.startAydins) || CFG.recruit.startingHerd;
    for (let i = 0; i < startHerd; i++) {
      const a = (Math.PI * 2 * i) / startHerd;
      const r = U.rand(60, 130) * (startHerd > 20 ? 1.8 : 1);
      const ay = new Aydin(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, false);
      ay.invuln = 0;
      Game.aydins.push(ay);
    }
    const startGohids = (mod && mod.startGohids) || CFG.gohid.starting;
    for (let i = 0; i < startGohids; i++) Game.spawnAmbientGohid();
    Game.stats.peakHerd = Game.aydins.length;

    // Fold the multipliers now that the modifier is known. Without this,
    // Game.mods keeps the PREVIOUS run's values until something else happens
    // to recompute -- Game.start() did, but Game.attract() did not, so the
    // menu ran with whatever the last run left behind.
    Game.recomputeMods();
  },

  start() {
    Game.reset();
    Game.state = 'playing';
    Audio2.start();
    Game.recomputeMods();
    if (Events.modifier) {
      UI.banner(Events.modifier.name, 'event', Events.modifier.desc);
    }
  },

  /* ---------------------------------------------------------------- update */

  update(dt) {
    Input.update();

    // A pausing screen stops the world completely. The alternative -- dimming
    // the view while the herd is still being eaten behind it -- is the reason
    // this is checked here rather than inside each screen.
    if (typeof UI !== 'undefined' && UI.paused) {
      Game.shake = Math.max(0, Game.shake - dt * 24);
      return;
    }

    const attract = Game.state === 'attract';
    if (attract) Game._attractDrive(dt);
    else if (Game.state !== 'playing') {
      Particles.update(dt);
      Game.shake = Math.max(0, Game.shake - dt * 24);
      return;
    }

    // Freeze-frame: an evolution stops the world for a moment so the player
    // registers what just happened. Nothing moves while it runs.
    if (Game.freeze > 0) {
      Game.freeze -= dt;
      Game.flash = Math.max(0, Game.flash - dt * 3);
      return;
    }

    Game.time += dt;
    Game.frame++;
    if (Game.stampedeT > 0) Game.stampedeT -= dt;
    if (Game.hornT > 0) Game.hornT -= dt;
    if (Game.idolT > 0) {
      Game.idolT -= dt;
      if (Game.idolT <= 0) Game.recomputeMods();   // bonus expired
    }
    if (!attract) {
      Events.update(dt);
      Pickups.update(dt);
    }
    Game._updateRally(dt);

    // --- grids: one consistent snapshot for every steering decision --------
    Game.aydinGrid.clear();
    Game.gohidGrid.clear();
    for (let i = 0; i < Game.aydins.length; i++) {
      if (Game.aydins[i].alive) Game.aydinGrid.insert(Game.aydins[i]);
    }
    for (let i = 0; i < Game.gohids.length; i++) {
      const g = Game.gohids[i];
      if (g.alive && !g.leaving) Game.gohidGrid.insert(g);
    }

    // Characters query the grids and stamp the herd, so they run after the
    // grids are rebuilt and before anything moves.
    if (!attract) Characters.update(dt);

    // --- move -------------------------------------------------------------
    Game.commander.update(dt, Game);
    for (let i = 0; i < Game.aydins.length; i++) {
      if (Game.aydins[i].alive) Game.aydins[i].update(dt, Game);
    }
    for (let i = 0; i < Game.gohids.length; i++) {
      if (Game.gohids[i].alive) Game.gohids[i].update(dt, Game);
    }

    // --- resolve ----------------------------------------------------------
    Game._resolveCaptures(dt);
    Game._resolveCommanderTouch();
    Game._updatePending(dt);
    Game._updateSpawning(dt);

    if (Game.scatterTimer > 0) Game.scatterTimer -= dt;

    // --- score and exp ----------------------------------------------------
    // Both scale with herd size, which is the whole tension: a bigger herd
    // scores faster and levels faster, and is also more to lose.
    const herd = Game.aydins.length;
    if (!attract) {
      Game.score += herd * CFG.score.perAydinPerSecond * Game.mods.scoreMul * dt;
      Game.exp += herd * CFG.exp.perAydinPerSecond * Game.mods.expMul
                * Characters.expMul() * dt;
      if (herd > Game.stats.peakHerd) Game.stats.peakHerd = herd;

      // while(), not if(): a huge herd can cross more than one level in a frame.
      while (Game.exp >= Game.expToNext) {
        Game.exp -= Game.expToNext;
        Game._levelUp();
      }
    }

    Tools.update(dt);

    Particles.update(dt);
    Game.shake = Math.max(0, Game.shake - dt * 24);
    Game.hitFlash = Math.max(0, Game.hitFlash - dt * 3.5);
    Game.gainFlash = Math.max(0, Game.gainFlash - dt * 4);
    Game.flash = Math.max(0, Game.flash - dt * 3);

    Game._compact();

    if (attract) {
      // The menu background must never end. Keep it populated and keep the
      // gohid count in the range where the scene stays legible.
      if (Game.aydins.length < 14) Game.recruit();
      if (Game.gohids.length > 6) Game.gohids.pop();
    } else if (Game.aydins.length === 0) {
      Game._die();
    }
  },

  /* ---------------------------------------------------------- attract mode */

  /* The menu background is the real simulation with an AI commander, not a
   * canned animation -- so it always looks exactly like the game does, and
   * costs one steering function instead of a separate renderer. */
  attract() {
    Game.reset();
    Game.state = 'attract';
    Game._attractGoal = null;
    UI.clearBanners();
  },

  _attractDrive(dt) {
    const c = Game.commander;
    const pad = 400;
    if (!Game._attractGoal ||
        U.dist(c.x, c.y, Game._attractGoal.x, Game._attractGoal.y) < 160) {
      Game._attractGoal = {
        x: U.rand(pad, CFG.world.width - pad),
        y: U.rand(pad, CFG.world.height - pad),
      };
    }
    const a = U.angleTo(c.x, c.y, Game._attractGoal.x, Game._attractGoal.y);
    Input.mx = Math.cos(a);
    Input.my = Math.sin(a);
    // An occasional rally so the menu shows off the herd snapping together.
    Input.rally = (Game.time % 9) > 7.2;
  },

  /* Fold the upgrade buffs into the multiplier bag entities read. Called
   * whenever an upgrade is taken -- never per frame. */
  recomputeMods() {
    const b = Game.buffs;
    if (!b) return;

    // Start from the upgrade buffs, then multiply in the run modifier and
    // every running event. Folding from scratch is what lets two overlapping
    // events expire independently without leaving a multiplier behind.
    const ev = Events.fold({});
    const mul = (k, base) => base * (ev[k] == null ? 1 : ev[k]);

    Game.mods.commanderSpeed = mul('commanderSpeed', b.commanderSpeed);
    Game.mods.aydinSpeed = mul('aydinSpeed', b.aydinSpeed * Tools.aydinSpeedAura());
    Game.mods.recruitMul = mul('recruitMul', b.recruitMul);
    Game.mods.expMul = mul('expMul', b.expMul);
    Game.mods.gohidSpeed = mul('gohidSpeed', 1);
    Game.mods.scoreMul = mul('scoreMul', 1)
                       * (Game.idolT > 0 ? Game.idolMul : 1);

    Game.tuning.panicTime = CFG.aydin.panicTime * b.panicTimeMul;
    Game.tuning.cohesionStrength = b.cohesionStrength;

    // Iron Herd removes the rally speed penalty outright; Long Legs chips away
    // at it. Both express the same idea, so they share one number.
    const relief = Upgrades.hasEvolution('ironHerd') ? 1 : b.rallySlowRelief;
    const penalty = 1 - CFG.commander.rallySlow;
    Game.tuning.rallySlow = 1 - penalty * (1 - relief);

    Game.tools = Tools.active;
  },

  /* ----------------------------------------------------------- progression */

  /* Cost of going from `level` to `level + 1`. */
  expForLevel(level) {
    return CFG.exp.curveBase * Math.pow(CFG.exp.curveGrowth, level - 1);
  },

  _levelUp() {
    Game.level++;
    Game.expToNext = Game.expForLevel(Game.level);
    Game.stats.level = Game.level;
    Audio2.levelUp();

    const cards = Upgrades.offer(CFG.cards.count);
    if (!cards.length) {
      // Everything is maxed. Three blank cards would be worse than saying
      // nothing, so the level still lands, just without a choice.
      UI.banner('LEVEL ' + Game.level, 'level');
      return;
    }
    UI.showLevelUp(cards, (card) => {
      Upgrades.take(card.id);
      Audio2.chest();
    });
  },

  /* ----------------------------------------------------------------- rally */

  _updateRally(dt) {
    const wasRallying = Game.rallying;
    // The Rally Horn is a free perfect rally: tight and protected, and without
    // the speed cost, which is what makes it worth picking up rather than just
    // holding the button.
    Game.rallying = Input.rally || Game.hornT > 0;

    const F = CFG.aydin.flock;
    const b = Game.buffs;
    const piper = Tools.cohesionRadiusMul();
    const target = (Game.rallying
      ? F.cohesionRadiusRally * (b ? b.rallyRadiusMul : 1)
      : F.cohesionRadius) * piper * Characters.cohesionMul();
    Game.cohesionRadius = U.damp(Game.cohesionRadius, target,
                                 1 / CFG.rally.snapTime, dt);

    if (Game.rallying && !wasRallying) {
      // The snap has to feel physical: a ring of dust collapsing inward, a
      // short punchy sound, and a touch of shake. The player presses this
      // thousands of times a run, so it carries a lot of the game's feel.
      const c = Game.commander;
      Particles.implode(c.x, c.y, CFG.rally.ringDust, F.cohesionRadius * 0.55, {
        speed: 300, life: 0.34, size: 3, colour: CFG.palette.dust,
      });
      Audio2.rallySnap();
      Game.shake = Math.max(Game.shake, 3);
    } else if (!Game.rallying && wasRallying) {
      Audio2.rallyRelease();
    }
    Input.consumeRallyPressed();
    Input.consumeRallyReleased();
  },

  /* --------------------------------------------------------------- capture */

  /* THE core loop. An aydin caught here is removed from the score AND queued
   * as a new hunter, at the exact spot the player lost it. */
  _resolveCaptures(dt) {
    const out = [];
    for (let i = 0; i < Game.gohids.length; i++) {
      const g = Game.gohids[i];
      if (!g.alive || g.leaving || g.grabCd > 0) continue;
      if (!g.canGrab) continue;              // howlers and herders never grab
      if (Events.flag('calling')) continue;  // they are coming for you instead

      const reach = g.grabRadius;
      const cand = Game.aydinGrid.query(g.x, g.y, reach, out);
      let grabbed = 0;
      for (let j = 0; j < cand.length; j++) {
        const a = cand[j];
        if (!a.alive || a.invuln > 0) continue;
        if (U.dist2(g.x, g.y, a.x, a.y) > reach * reach) continue;
        // Cheapest check first: a flat dice roll, then a positional test,
        // then the escort scan.
        if (Game.buffs && Game.buffs.missChance > 0
            && Math.random() < Game.buffs.missChance) {
          g.grabCd = CFG.gohid.grabCooldown;
          break;
        }
        if (Game._vanguardProtected(a)) {
          g.grabCd = CFG.gohid.grabCooldown;
          break;
        }
        if (Tools.intercept(g)) {
          g.grabCd = CFG.gohid.grabCooldown;
          break;
        }
        if (Game._rallyProtected(a)) {
          // The grab is spent either way, so a protected herd genuinely stalls
          // the gohid rather than letting it retry every frame until it wins.
          g.grabCd = CFG.gohid.grabCooldown;
          Particles.burst(a.x, a.y, 4, {
            speed: 70, life: 0.25, size: 2, colour: '#ffe8a8', drag: 5,
          });
          break;
        }
        // The Shield blocks one capture anywhere in the herd, not just its own.
        if (Characters.consumeShield()) {
          g.grabCd = CFG.gohid.grabCooldown;
          Particles.burst(a.x, a.y, 12, {
            speed: 150, life: 0.4, size: 3, colour: '#8ab6ff',
          });
          break;
        }
        Game._capture(a, g);
        // A brute takes two before its cooldown starts.
        if (++grabbed >= g.grabCount) break;
      }
    }
  },

  /* Rally's payoff. Only aydins actually gathered around the commander are
   * covered -- a straggler that has not made it into the ball is still lost,
   * which is what keeps rally a timing decision instead of a toggle. */
  _rallyProtected(a) {
    if (!Game.rallying) return false;
    const r = CFG.aydin.flock.cohesionRadiusRally * CFG.rally.protectRadiusMul;
    if (U.dist2(a.x, a.y, Game.commander.x, Game.commander.y) > r * r) return false;
    return Math.random() < CFG.rally.captureResist;
  },

  /* Vanguard: the leading edge of the herd cannot be grabbed. "Leading" is
   * measured along the commander's heading, so it protects the aydins running
   * ahead of you into danger, which is the point of the upgrade. */
  _vanguardProtected(a) {
    const share = Game.buffs ? Game.buffs.vanguard : 0;
    if (share <= 0) return false;
    const c = Game.commander;
    const len = Math.hypot(c.vx, c.vy);
    if (len < 1) return false;
    const hx = c.vx / len, hy = c.vy / len;
    // Projecting onto the heading gives a 0..1 rank without sorting the whole
    // herd every frame.
    const proj = (a.x - c.x) * hx + (a.y - c.y) * hy;
    const reach = Math.max(60, Game.cohesionRadius);
    const rank = U.clamp(proj / reach, 0, 1);
    return rank >= (1 - share);
  },

  _capture(aydin, gohid) {
    aydin.alive = false;
    gohid.grabCd = CFG.gohid.grabCooldown;
    gohid.sinceCatch = 0;
    Game.stats.lost++;

    Particles.burst(aydin.x, aydin.y, 12, {
      speed: 150, life: 0.45, size: 3, colour: CFG.palette.blood, drag: 4,
    });
    Particles.burst(aydin.x, aydin.y, 6, {
      speed: 80, life: 0.6, size: 2, colour: '#e7d9c1', drag: 3,
    });

    Audio2.capture();
    Game.shake = Math.max(Game.shake, CFG.fx.shake.capture);
    Game.hitFlash = 1;

    // Stampede turns the loss into a chance to escape.
    if (Game.buffs && Game.buffs.stampede > 0) {
      Game.stampedeT = CFG.upgrades.stampede.duration;
    }

    // The medic may pull one back before the loss lands.
    if (Characters.tryRecover(aydin.x, aydin.y)) Game.stats.recovered++;

    // The consequence: a new hunter, born where you lost one. Thin Ice makes
    // it two.
    const n = Events.captureSpawnCount();
    for (let i = 0; i < n; i++) {
      Game.queueGohid(aydin.x + U.rand(-18, 18), aydin.y + U.rand(-18, 18));
    }

    Game._checkSecondWind();
  },

  /* Once per run, a collapsing herd gets three back. It fires on the way down
   * rather than at zero, so it rescues a run instead of undoing a death that
   * has already happened. */
  _checkSecondWind() {
    if (!Game.buffs || !Game.buffs.secondWind || Game.secondWindUsed) return;
    if (Game.aydins.length >= CFG.upgrades.secondWind.threshold) return;
    Game.secondWindUsed = true;
    const c = Game.commander;
    for (let i = 0; i < CFG.upgrades.secondWind.revive; i++) {
      const a = (Math.PI * 2 * i) / CFG.upgrades.secondWind.revive;
      Game.aydins.push(new Aydin(c.x + Math.cos(a) * 40,
                                 c.y + Math.sin(a) * 40, false));
    }
    UI.banner('SECOND WIND', 'level');
    Audio2.levelUp();
  },

  /* ------------------------------------------------- commander gets touched */

  _resolveCommanderTouch() {
    const c = Game.commander;
    if (c.touchCd > 0) return;
    const r = CFG.commander.radius + CFG.gohid.radius;
    const out = [];
    const near = Game.gohidGrid.query(c.x, c.y, r, out);
    for (let i = 0; i < near.length; i++) {
      const g = near[i];
      if (!g.alive || g.leaving) continue;
      if (U.dist2(c.x, c.y, g.x, g.y) > r * r) continue;
      Game._scatter(g);
      break;
    }
  },

  _scatter(g) {
    const c = Game.commander;
    Game.scatterTimer = CFG.aydin.scatter.duration
                      * (Game.buffs ? Game.buffs.scatterMul : 1);
    Game.stats.scatters++;
    c.knock(g.x, g.y);
    Audio2.scatter();
    Game.shake = Math.max(Game.shake, CFG.fx.shake.scatter);
    Particles.burst(c.x, c.y, 26, {
      speed: 240, life: 0.5, size: 3, colour: CFG.palette.dust, drag: 2.5,
    });
  },

  /* --------------------------------------------------------------- spawning */

  /* A queued gohid does not exist yet: for spawnTelegraph seconds it is only an
   * expanding ring and a rising tone. That delay is what makes a new gohid read
   * as the player's own consequence instead of as random noise. */
  queueGohid(x, y) {
    Game.pending.push({ x: x, y: y, t: 0 });
    Audio2.gohidSpawn();
  },

  _updatePending(dt) {
    for (let i = Game.pending.length - 1; i >= 0; i--) {
      const p = Game.pending[i];
      p.t += dt;
      if (p.t >= CFG.gohid.spawnTelegraph) {
        const born = new Gohid(p.x, p.y);
        Variants.apply(born, Variants.roll());
        Game.gohids.push(born);
        Game.stats.created++;
        Game.shake = Math.max(Game.shake, CFG.fx.shake.gohidSpawn);
        Particles.burst(p.x, p.y, 16, {
          speed: 210, life: 0.5, size: 4, colour: CFG.palette.gohidTint, drag: 3,
        });
        Game.pending.splice(i, 1);
      }
    }
  },

  spawnAmbientGohid() {
    const c = Game.commander;
    const p = U.edgePointNear(c.x, c.y, 900, 1500);
    const g = new Gohid(p.x, p.y);
    Variants.apply(g, Variants.roll());
    Game.gohids.push(g);
    Game.stats.created++;
  },

  /* Remove a gohid for good. Everything that banishes one goes through here,
   * so the splitter's parting gift cannot be forgotten by a new caller. */
  banishGohid(g) {
    if (!g || !g.alive || g.leaving) return;
    g.beginLeaving();
    Audio2.banish();
    Particles.burst(g.x, g.y, 12, {
      speed: 140, life: 0.45, size: 3, colour: '#cfd6b8',
    });
    if (typeof Variants !== 'undefined') Variants.onBanish(g);
  },

  _updateSpawning(dt) {
    const R = CFG.recruit;

    // Recruit interval shortens as the run goes on: more herd, more score,
    // more to lose.
    const ramp = Math.min(1, Game.time / R.rampTime);
    const interval = U.lerp(R.interval, R.intervalMin, ramp) / Game.mods.recruitMul;

    Game.recruitTimer -= dt;
    if (Game.recruitTimer <= 0) {
      Game.recruitTimer += interval;
      if (!Events.flag('noRecruits')) Game.recruit();
    }

    const A = CFG.gohid.ambient;
    const aRamp = Math.min(1, Game.time / A.rampTime);
    Game.ambientTimer -= dt;
    if (Game.ambientTimer <= 0) {
      Game.ambientTimer += U.lerp(A.interval, A.intervalMin, aRamp);
      Game.spawnAmbientGohid();
    }
  },

  recruit() {
    const c = Game.commander;
    const p = U.edgePointNear(c.x, c.y, CFG.recruit.spawnDistMin, CFG.recruit.spawnDistMax);
    Game.aydins.push(new Aydin(p.x, p.y, true));
    Audio2.recruit();
    Game.gainFlash = 1;
  },

  /* --------------------------------------------------------------- cleanup */

  /* Swap-remove compaction once per frame. splice() inside the update loop
   * would be O(n^2) at the herd sizes this game is built around. */
  _compact() {
    let n = 0;
    const A = Game.aydins;
    for (let i = 0; i < A.length; i++) if (A[i].alive) A[n++] = A[i];
    A.length = n;

    n = 0;
    const G = Game.gohids;
    for (let i = 0; i < G.length; i++) {
      if (G[i].alive) G[n++] = G[i];
      else Game.stats.banished++;
    }
    G.length = n;
  },

  _die() {
    Game.state = 'dead';
    Game.stats.time = Game.time;
    Game.stats.score = Math.floor(Game.score);
    Audio2.gameOver();
    Game.shake = 14;

    Game.stats.level = Game.level;
    // Save owns persistence; recordRun reports whether this beat the stored
    // best BEFORE overwriting it, which the results screen needs.
    if (typeof Save !== 'undefined' && Save.data) {
      Game.stats.isBest = Save.recordRun(Game.stats);
      Game.stats.best = Save.data.best;
    } else {
      Game.stats.isBest = false;
      Game.stats.best = Game.stats.score;
    }
  },
};
