/* =============================================================================
 * entities.js  --  Commander, Aydin, Gohid.
 *
 * Steering model, used by every moving thing here:
 *
 *     steer = (desiredVelocity - currentVelocity) * responsiveness
 *
 * rather than "accumulate forces, then damp". The force-and-damp model has a
 * terminal speed of force/damping, so every time a number is retuned the top
 * speed silently changes with it. With a desired-velocity model the configured
 * speed IS the speed the entity reaches, and responsiveness only controls how
 * sharply it turns. That matters here because the whole game rests on one
 * speed relationship -- commander 300 > aydin 290 > gohid 250 > nothing -- and
 * that relationship has to survive rebalancing.
 * ========================================================================== */
'use strict';

/* Module-level scratch buffers. Every query fills one of these instead of
 * allocating; see the note at the top of spatial.js. */
const _scratchA = [];
const _scratchB = [];

/* --------------------------------------------------------------- Commander */

class Commander {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.kx = 0; this.ky = 0;        // knockback, decays independently
    this.face = 1;
    this.bob = Math.random() * 10;
    this.touchCd = 0;
  }

  update(dt, game) {
    const C = CFG.commander;
    // rallySlow comes from tuning, not config: Long Legs and the Iron Herd
    // evolution both reduce the rally speed penalty.
    // A Rally Horn rally is free: the herd tightens but the commander keeps
    // full speed, which is the whole point of the pickup.
    const paying = game.rallying && game.hornT <= 0;
    const speed = C.speed * (paying ? game.tuning.rallySlow : 1)
                * game.mods.commanderSpeed;

    this.vx = Input.mx * speed;
    this.vy = Input.my * speed;

    if (this.vx !== 0) this.face = this.vx > 0 ? 1 : -1;

    // Knockback is applied on top of, not blended into, player control -- the
    // player never loses steering, they just get shoved.
    const decay = Math.exp(-C.knockbackDecay * dt);
    this.kx *= decay;
    this.ky *= decay;

    // Frozen Lake: the commander accelerates toward the input instead of
    // simply being set to it, so stopping and turning both take distance.
    const slide = (typeof Arenas !== 'undefined') ? Arenas.slide() : 0;
    if (slide > 0) {
      this.sx = U.damp(this.sx || 0, this.vx, slide, dt);
      this.sy = U.damp(this.sy || 0, this.vy, slide, dt);
      this.vx = this.sx;
      this.vy = this.sy;
    }

    this.x += (this.vx + this.kx) * dt;
    this.y += (this.vy + this.ky) * dt;

    const pad = CFG.world.edgePad;
    this.x = U.clamp(this.x, pad, CFG.world.width - pad);
    this.y = U.clamp(this.y, pad, CFG.world.height - pad);

    if (this.touchCd > 0) this.touchCd -= dt;
    if (Input.mx || Input.my) this.bob += dt * CFG.fx.bobSpeed;
  }

  knock(fromX, fromY) {
    const a = U.angleTo(fromX, fromY, this.x, this.y);
    this.kx += Math.cos(a) * CFG.commander.knockback;
    this.ky += Math.sin(a) * CFG.commander.knockback;
    this.touchCd = CFG.commander.touchCooldown;
  }
}

/* ------------------------------------------------------------------- Aydin */

class Aydin {
  constructor(x, y, joining) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.alive = true;
    this.joining = !!joining;        // sprinting in from the map edge
    this.panic = 0;                  // seconds of panic remaining
    this.invuln = CFG.aydin.spawnInvuln;
    this.face = 1;
    this.bob = Math.random() * 10;   // desynchronised so the herd never pulses
    this.wanderA = Math.random() * Math.PI * 2;
    this.character = null;           // set when this is a named aydin
    // Aura speed is written by Characters._applyAuras once per frame and read
    // below. The stamp means the herd is walked once, not reset and re-walked.
    this.auraSpeed = 1;
    this.auraStamp = -1;
  }

  update(dt, game) {
    const A = CFG.aydin, F = A.flock;
    const cmd = game.commander;

    if (this.invuln > 0) this.invuln -= dt;
    if (this.panic > 0) this.panic -= dt;

    const dxC = cmd.x - this.x, dyC = cmd.y - this.y;
    const dC = Math.sqrt(dxC * dxC + dyC * dyC) || 1;

    // ---- flee: any gohid inside fleeRadius panics this aydin -------------
    let fleeX = 0, fleeY = 0, threat = 0;
    const gohids = game.gohidGrid.query(this.x, this.y, F.fleeRadius, _scratchB);
    for (let i = 0; i < gohids.length; i++) {
      const g = gohids[i];
      const dx = this.x - g.x, dy = this.y - g.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > F.fleeRadius * F.fleeRadius || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const w = 1 - d / F.fleeRadius;
      fleeX += (dx / d) * w;
      fleeY += (dy / d) * w;
      if (w > threat) threat = w;
    }
    if (threat > 0) this.panic = game.tuning.panicTime;

    // ---- separation: keep the herd a crowd, not a single stacked sprite ---
    let sepX = 0, sepY = 0;
    const near = game.aydinGrid.query(this.x, this.y, F.separation, _scratchA);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === this) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > F.separation * F.separation || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const w = 1 - d / F.separation;
      sepX += (dx / d) * w;
      sepY += (dy / d) * w;
    }

    const panicking = this.panic > 0;
    // Stampede: the whole herd runs faster for a few seconds after any
    // capture, turning a loss into a chance to break away.
    const stampede = (game.stampedeT > 0 && game.buffs)
                   ? (1 + game.buffs.stampede) : 1;
    const aura = (this.auraStamp === game.frame) ? this.auraSpeed : 1;
    const maxSpeed = A.speed * game.mods.aydinSpeed * stampede * aura
                   * (panicking ? A.panicSpeedMul : 1)
                   * (this.joining ? A.joinSpeedMul : 1);

    // ---- desired velocity ------------------------------------------------
    let dvx = 0, dvy = 0;

    if (this.joining) {
      // Recruits ignore everything and run for the herd until they arrive.
      dvx = (dxC / dC) * maxSpeed;
      dvy = (dyC / dC) * maxSpeed;
      if (dC < F.cohesionRadius * 0.7) this.joining = false;

    } else if (game.scatterTimer > 0) {
      // Commander was touched: everyone bolts outward, cohesion off. This is
      // what makes a single careless brush cascade into a real disaster.
      dvx = (-dxC / dC) * maxSpeed;
      dvy = (-dyC / dC) * maxSpeed;

    } else if (panicking) {
      // Panicking aydins ignore cohesion -- this is precisely how a herd tears
      // itself apart while you are running, and it has to be allowed to happen.
      const fl = Math.sqrt(fleeX * fleeX + fleeY * fleeY) || 1;
      let dirX = fleeX / fl, dirY = fleeY / fl;

      // ...except while rallying. Without this blend the two verbs contradict
      // each other: anything close enough to be worth rallying is already
      // panicking, so pure flee means the rally button visibly does nothing in
      // the exact moment the player reaches for it. Blending lets a rallied
      // aydin still break around the gohid while heading home.
      if (game.rallying) {
        const w = F.rallyPanicCohesion;
        dirX = dirX * (1 - w) + (dxC / dC) * w;
        dirY = dirY * (1 - w) + (dyC / dC) * w;
        const bl = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        dirX /= bl; dirY /= bl;
      }
      dvx = dirX * maxSpeed;
      dvy = dirY * maxSpeed;

    } else {
      // Cohesion: only pulls once outside the current radius, so a calm herd
      // spreads out and grazes instead of piling onto the commander.
      const radius = game.cohesionRadius;
      const over = dC - radius;
      if (over > 0) {
        const t = Math.min(1, over / 60);
        dvx = (dxC / dC) * maxSpeed * t;
        dvy = (dyC / dC) * maxSpeed * t;
      } else {
        this.wanderA += U.rand(-2.5, 2.5) * dt;
        dvx = Math.cos(this.wanderA) * F.wander;
        dvy = Math.sin(this.wanderA) * F.wander;
      }
    }

    // Separation rides on top of whatever the aydin was already trying to do.
    dvx += sepX * F.separationStrength;
    dvy += sepY * F.separationStrength;

    // ---- integrate -------------------------------------------------------
    // Rallied aydins turn sharply, panicking or not -- a rallied aydin now has
    // somewhere to be, so excluding panic here would leave it heading home at
    // the loose wandering responsiveness and undo most of the blend above.
    const k = ((game.rallying && !this.joining && game.scatterTimer <= 0)
            ? F.rallyStrength : F.cohesionStrength)
            * game.tuning.cohesionStrength;
    let ax = (dvx - this.vx) * k;
    let ay = (dvy - this.vy) * k;
    const al = Math.sqrt(ax * ax + ay * ay);
    if (al > F.maxSteer) { ax = ax / al * F.maxSteer; ay = ay / al * F.maxSteer; }

    this.vx += ax * dt;
    this.vy += ay * dt;

    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (sp > maxSpeed) { this.vx = this.vx / sp * maxSpeed; this.vy = this.vy / sp * maxSpeed; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const pad = CFG.world.edgePad;
    this.x = U.clamp(this.x, pad, CFG.world.width - pad);
    this.y = U.clamp(this.y, pad, CFG.world.height - pad);

    if (this.vx > 4) this.face = 1; else if (this.vx < -4) this.face = -1;
    this.bob += dt * (CFG.fx.bobSpeed * (0.4 + sp / A.speed));
  }
}

/* ------------------------------------------------------------------- Gohid */

class Gohid {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.alive = true;
    this.target = null;
    this.retarget = Math.random() * CFG.gohid.retargetInterval;
    this.sinceCatch = 0;             // drives boredom
    this.grabCd = 0;
    this.leaving = false;
    this.face = 1;
    this.bob = Math.random() * 10;
    this.spawnFlash = 0.35;

    // Status effects, all simple countdown timers. Tools set them; this class
    // is the only thing that reads them, so a new tool never has to know how
    // movement works -- it just calls the applier below.
    this.stunT = 0;    // cannot act at all
    this.rootT = 0;    // cannot move, still turns
    this.blindT = 0;   // moves, but wanders instead of hunting
    this.slowT = 0;
    this.slowAmt = 0;
    this.blindA = Math.random() * Math.PI * 2;

    // Variant defaults; Variants.apply() overwrites these at spawn.
    this.variant = 'gohid';
    this.speedMul = 1;
    this.sizeMul = 1;
    this.grabRadius = CFG.gohid.grabRadius;
    this.grabCount = 1;
    this.canGrab = true;
    this.revealed = true;
    this.vt = 0;
  }

  /* Refresh rather than stack. Auras call this every frame they contain a
   * gohid, so adding durations would make a gohid that walked through a dust
   * cloud slow for the rest of the run. */
  applySlow(amount, duration) {
    if (amount >= this.slowAmt) this.slowAmt = amount;
    if (duration > this.slowT) this.slowT = duration;
  }

  applyStun(duration) { if (duration > this.stunT) this.stunT = duration; }
  applyRoot(duration) { if (duration > this.rootT) this.rootT = duration; }
  applyBlind(duration) { if (duration > this.blindT) this.blindT = duration; }

  get disabled() { return this.stunT > 0 || this.rootT > 0; }

  update(dt, game) {
    const G = CFG.gohid;
    if (this.grabCd > 0) this.grabCd -= dt;
    if (this.spawnFlash > 0) this.spawnFlash -= dt;

    // The Silence stops every gohid dead. Read here rather than pushed by the
    // event scheduler, so it costs nothing when no event is running.
    if (typeof Events !== 'undefined' && Events.flag('silence')) {
      this.vx = 0; this.vy = 0;
      return;
    }

    if (this.stunT > 0) this.stunT -= dt;
    if (this.rootT > 0) this.rootT -= dt;
    if (this.blindT > 0) this.blindT -= dt;
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowAmt = 0; }

    // Stunned or rooted: hold position entirely. Timers above still run, so a
    // gohid always recovers.
    // Boredom accrues even while disabled. Returning before this meant a
    // stunned or rooted gohid had its boredom timer PAUSED -- and since
    // boredom is what removes the large majority of gohids ever created,
    // disabling one quietly suppressed the main way the board clears. It made
    // Flashbang measure as a net-harmful upgrade (-19% score against a
    // no-upgrade baseline), which is the opposite of what stunning should do.
    // A gohid held in place and catching nothing should get bored faster, if
    // anything, not slower.
    if (!this.leaving) {
      this.sinceCatch += dt;

      // Boredom is a relief valve, not a freebie: it only fires while the
      // board is already crowded, so it can never make an early run easier.
      //
      // Both the timer and this CHECK sit above the disabled early-return.
      // With either below it, a stunned or rooted gohid never gives up, and
      // since boredom removes the large majority of gohids a run creates,
      // every stun and root quietly suppressed the main way the board clears.
      // Flashbang measured at -19% score against a no-upgrade baseline.
      if (this.sinceCatch > G.boredom.time
          && game.gohids.length > G.boredom.minGohids) {
        this.beginLeaving();
        Audio2.banish();
        Particles.burst(this.x, this.y, 10, {
          speed: 90, life: 0.5, size: 3, colour: '#cfd6b8',
        });
        return;
      }
    }

    // Still held: it has given up nothing, but it cannot act either.
    if (this.disabled) { this.vx = 0; this.vy = 0; return; }

    let speed = G.speed * game.mods.gohidSpeed * this.speedMul;
    if (this.slowT > 0) speed *= (1 - this.slowAmt);

    // Variant behaviour runs after the status gate above, so a stunned howler
    // cannot howl and a rooted herder cannot push.
    if (typeof Variants !== 'undefined') Variants.behave(this, dt, game);

    if (this.leaving) {
      // Walk to the nearest edge and be deleted on arrival.
      const s = speed * G.boredom.leaveSpeedMul;
      const l = Math.sqrt(this.vx * this.vx + this.vy * this.vy) || 1;
      this.x += (this.vx / l) * s * dt;
      this.y += (this.vy / l) * s * dt;
      if (this.x < -80 || this.x > CFG.world.width + 80 ||
          this.y < -80 || this.y > CFG.world.height + 80) this.alive = false;
      return;
    }

    // ---- target ----------------------------------------------------------
    this.retarget -= dt;
    if (this.lure && this.lure.dead) this.lure = null;
    if (this.retarget <= 0 || !this.target || !this.target.alive) {
      this.retarget = G.retargetInterval;
      // Hunters beeline for the named aydins and ignore the crowd entirely.
      const preferred = (typeof Variants !== 'undefined')
        ? Variants.preferredTarget(this, game) : null;
      this.target = preferred || game.aydinGrid.nearest(this.x, this.y, 3000,
        (a) => a.alive && a.invuln <= 0);
    }

    let dvx = 0, dvy = 0;
    if (this.blindT > 0) {
      // Blinded: still moving, but no longer toward anything. This is what
      // makes smoke a genuine escape rather than a slow.
      this.blindA += U.rand(-3, 3) * dt;
      dvx = Math.cos(this.blindA) * speed * 0.55;
      dvy = Math.sin(this.blindA) * speed * 0.55;
    } else if (this.lure) {
      // A decoy outranks the herd for as long as it lasts.
      const dx = this.lure.x - this.x, dy = this.lure.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dvx = (dx / d) * speed;
      dvy = (dy / d) * speed;
    } else if (typeof Events !== 'undefined' && Events.flag('calling')) {
      // They want YOU instead of the herd -- total relief, and the only time
      // the commander is the thing being chased.
      const dx = game.commander.x - this.x, dy = game.commander.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dvx = (dx / d) * speed;
      dvy = (dy / d) * speed;
    } else if (this.target) {
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dvx = (dx / d) * speed;
      dvy = (dy / d) * speed;
    }

    // Gohids shoulder each other apart, so a pack reads as several distinct
    // threats closing in rather than one sprite with a stack of clones on it.
    const others = game.gohidGrid.query(this.x, this.y, G.separation, _scratchA);
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === this) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > G.separation * G.separation || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const w = (1 - d / G.separation) * G.separationStrength;
      dvx += (dx / d) * w;
      dvy += (dy / d) * w;
    }

    let ax = (dvx - this.vx) * G.turnRate;
    let ay = (dvy - this.vy) * G.turnRate;
    this.vx += ax * dt;
    this.vy += ay * dt;

    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (sp > speed) { this.vx = this.vx / sp * speed; this.vy = this.vy / sp * speed; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const pad = CFG.world.edgePad;
    this.x = U.clamp(this.x, pad, CFG.world.width - pad);
    this.y = U.clamp(this.y, pad, CFG.world.height - pad);

    if (this.vx > 4) this.face = 1; else if (this.vx < -4) this.face = -1;
    this.bob += dt * (CFG.fx.bobSpeed * (0.4 + sp / G.speed));
  }

  beginLeaving() {
    this.leaving = true;
    // Aim at whichever edge is closest.
    const W = CFG.world.width, H = CFG.world.height;
    const d = [this.x, W - this.x, this.y, H - this.y];
    const m = Math.min(d[0], d[1], d[2], d[3]);
    this.vx = 0; this.vy = 0;
    if (m === d[0]) this.vx = -1;
    else if (m === d[1]) this.vx = 1;
    else if (m === d[2]) this.vy = -1;
    else this.vy = 1;
  }
}
