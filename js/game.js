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

  time: 0,
  score: 0,
  rallying: false,
  cohesionRadius: CFG.aydin.flock.cohesionRadius,
  scatterTimer: 0,

  recruitTimer: 0,
  ambientTimer: 0,

  shake: 0,
  hitFlash: 0,               // red vignette pulse when an aydin is lost
  gainFlash: 0,

  // Multipliers that later systems (upgrades, modifiers, events) write into.
  // Nothing in step 1 changes them; they exist so that when those systems land
  // they never have to touch the movement code.
  mods: {
    commanderSpeed: 1,
    aydinSpeed: 1,
    gohidSpeed: 1,
    scoreMul: 1,
    recruitMul: 1,
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
    Game.rallying = false;
    Game.cohesionRadius = CFG.aydin.flock.cohesionRadius;
    Game.scatterTimer = 0;
    Game.recruitTimer = CFG.recruit.interval;
    Game.ambientTimer = CFG.gohid.ambient.interval;
    Game.shake = 0;
    Game.hitFlash = 0;
    Game.gainFlash = 0;

    Game.stats = {
      peakHerd: 0, lost: 0, created: 0, banished: 0,
      scatters: 0, time: 0, score: 0,
    };

    // Starting herd, ringed around the commander so the first second reads as
    // "this is yours to protect" rather than "collect these".
    const c = Game.commander;
    for (let i = 0; i < CFG.recruit.startingHerd; i++) {
      const a = (Math.PI * 2 * i) / CFG.recruit.startingHerd;
      const r = U.rand(60, 130);
      const ay = new Aydin(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, false);
      ay.invuln = 0;
      Game.aydins.push(ay);
    }
    for (let i = 0; i < CFG.gohid.starting; i++) Game.spawnAmbientGohid();
    Game.stats.peakHerd = Game.aydins.length;
  },

  start() {
    Game.reset();
    Game.state = 'playing';
    Audio2.start();
  },

  /* ---------------------------------------------------------------- update */

  update(dt) {
    Input.update();
    if (Game.state !== 'playing') {
      Particles.update(dt);
      Game.shake = Math.max(0, Game.shake - dt * 24);
      return;
    }

    Game.time += dt;
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

    // --- score ------------------------------------------------------------
    const herd = Game.aydins.length;
    Game.score += herd * CFG.score.perAydinPerSecond * Game.mods.scoreMul * dt;
    if (herd > Game.stats.peakHerd) Game.stats.peakHerd = herd;

    Particles.update(dt);
    Game.shake = Math.max(0, Game.shake - dt * 24);
    Game.hitFlash = Math.max(0, Game.hitFlash - dt * 3.5);
    Game.gainFlash = Math.max(0, Game.gainFlash - dt * 4);

    Game._compact();

    if (Game.aydins.length === 0) Game._die();
  },

  /* ----------------------------------------------------------------- rally */

  _updateRally(dt) {
    const wasRallying = Game.rallying;
    Game.rallying = Input.rally;

    const F = CFG.aydin.flock;
    const target = Game.rallying ? F.cohesionRadiusRally : F.cohesionRadius;
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
    const G = CFG.gohid;
    const out = [];
    for (let i = 0; i < Game.gohids.length; i++) {
      const g = Game.gohids[i];
      if (!g.alive || g.leaving || g.grabCd > 0) continue;

      const cand = Game.aydinGrid.query(g.x, g.y, G.grabRadius, out);
      for (let j = 0; j < cand.length; j++) {
        const a = cand[j];
        if (!a.alive || a.invuln > 0) continue;
        if (U.dist2(g.x, g.y, a.x, a.y) > G.grabRadius * G.grabRadius) continue;
        if (Game._rallyProtected(a)) {
          // The grab is spent either way, so a protected herd genuinely stalls
          // the gohid rather than letting it retry every frame until it wins.
          g.grabCd = CFG.gohid.grabCooldown;
          Particles.burst(a.x, a.y, 4, {
            speed: 70, life: 0.25, size: 2, colour: '#ffe8a8', drag: 5,
          });
          break;
        }
        Game._capture(a, g);
        break;                       // one grab per gohid per cooldown
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

    // The consequence: a new hunter, born where you lost one.
    Game.queueGohid(aydin.x, aydin.y);
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
    Game.scatterTimer = CFG.aydin.scatter.duration;
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
        Game.gohids.push(new Gohid(p.x, p.y));
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
    Game.gohids.push(new Gohid(p.x, p.y));
    Game.stats.created++;
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
      Game.recruit();
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

    const best = U.storeGet(CFG.storage.key, { best: 0 });
    Game.stats.isBest = Game.stats.score > (best.best || 0);
    if (Game.stats.isBest) {
      best.best = Game.stats.score;
      U.storeSet(CFG.storage.key, best);
    }
    Game.stats.best = best.best || 0;
  },
};
