/* =============================================================================
 * config.js  --  every tunable number and asset path in the game.
 *
 * LOADS FIRST. Depends on nothing. Nothing here may reference game code.
 * Rebalancing the game must never mean opening a logic file, so if a number
 * matters to how the game feels, it belongs in here, grouped by the system
 * that reads it.
 * ========================================================================== */
'use strict';

const CFG = {

  /* ---------------------------------------------------------------- assets */
  assets: {
    // Every path here also has a procedural canvas fallback in sprites.js,
    // so a missing file degrades to a drawn shape instead of crashing.
    gohid:     'assets/gohid.png',
    aydin:     'assets/aydin.png',
    commander: 'assets/commander.png',

    // gohid.png is a head-and-shoulders photo cutout; at sprite size the
    // shirt is dead weight, so crop to the face before pixelating.
    // Fractions of the source image: [x, y, w, h].
    gohidCrop: [0.10, 0.02, 0.80, 0.72],

    // All sprites are normalised to this square before use, so photo and
    // hand-drawn art share one pixel grid.
    pixelSize: 32,
  },

  /* ----------------------------------------------------------------- world */
  world: {
    width:  4000,
    height: 3000,
    tile:   64,          // floor tile size, world units
    edgePad: 40,         // keeps entities off the exact boundary
  },

  /* --------------------------------------------------------------- display */
  display: {
    maxDprTouch:  1.5,   // capping DPR on phones is the single biggest fps win
    maxDprDesktop: 2,
    cameraLerp:   0.12,  // camera follow smoothing per frame at 60fps
    cameraLookahead: 0.18, // shifts the view along the commander's velocity
    zoom: 1,
  },

  /* ------------------------------------------------------------- commander */
  commander: {
    speed:         300,
    radius:        14,
    sprite:        34,   // draw size in world units
    rallySlow:     0.75, // speed multiplier while rallying (25% slower)
    knockback:     260,  // impulse when a gohid touches the commander
    knockbackDecay: 6,   // per second
    // INVARIANT: this MUST exceed aydin.scatter.duration, with margin.
    // Below that, a second touch lands while the herd is still scattering and
    // the scatters overlap end to end. Once gohids are dense enough to touch
    // you every second or so, the herd then sits in a permanent outward-flee
    // state that overrides cohesion AND rally -- a spiral with no counterplay,
    // where the button the player reaches for provably does nothing. Measured
    // at 1.0s with ~35 gohids: 59% of all frames were spent scattered.
    // tools/headless.js asserts this relationship.
    touchCooldown: 2.4,
  },

  /* ----------------------------------------------------------------- aydin */
  aydin: {
    speed:        290,   // slightly under the commander, so the herd strings out
    radius:       10,
    sprite:       26,
    panicSpeedMul: 1.30,
    panicTime:    1.1,   // seconds a panic lasts after leaving gohid range
    spawnInvuln:  1.5,   // flashes white, cannot be caught
    joinSpeedMul: 1.6,   // sprint speed while running in from the map edge

    flock: {
      cohesionRadius:      260,
      cohesionRadiusRally:  90,
      cohesionStrength:     2.6,
      rallyStrength:        6.0,
      separation:           26,
      separationStrength:  120,
      fleeRadius:          200,
      fleeStrength:        420,
      maxSteer:           1400,  // acceleration cap, world units / s^2
      damping:               6,  // velocity settling; keeps the flock from
                                 // oscillating around the commander
      wander:               18,  // idle jitter so a still herd isn't frozen

      // How strongly rally overrides panic, 0..1.
      // Panic ignoring cohesion is what makes a herd tear apart while running
      // -- that is the intent and it stays. But a threatened herd is panicking
      // BY DEFINITION, so at 0 the rally button does nothing in the only
      // situation anyone ever presses it, and the skill ceiling of the game
      // collapses. This is the blend that makes rally the answer to panic:
      // rallied aydins still dodge around a gohid, they just come home while
      // doing it. Lower = panic wins and the herd shreds; 1 = rally is a hard
      // override and panic stops mattering at all.
      rallyPanicCohesion:  0.75,
    },

    scatter: {
      duration: 1.5,     // commander touched: cohesion off, everyone flees out
      strength: 520,
    },
  },

  /* ----------------------------------------------------------------- gohid */
  gohid: {
    speed:       250,    // slower than you, faster than a panicking straggler
    radius:      13,
    sprite:      34,
    grabRadius:  26,
    turnRate:    7,      // steering responsiveness
    spawnTelegraph: 1.5, // expanding ring + rising tone before it exists
    grabCooldown: 0.35,  // stops one gohid clearing a clump in a single frame
    separation:   22,    // gohids shoulder each other apart so they don't stack
    separationStrength: 90,
    retargetInterval: 0.25,

    // Captures are the ONLY way the spec creates gohids, which means a player
    // who never loses an aydin faces the two they started with for the whole
    // run and the game has no pressure curve at all. A slow ambient trickle
    // from the map edge supplies the baseline threat; captures then accelerate
    // it far faster. Set ambient.interval very high to return to pure
    // capture-driven spawning.  [flagged for playtest -- see CLAUDE.md]
    starting: 2,
    ambient: {
      interval:    14,
      intervalMin:  5,
      rampTime:   300,
    },

    boredom: {
      time: 25,          // seconds without a catch before it wanders off
      minGohids: 12,     // ...but only while the board is genuinely crowded
      leaveSpeedMul: 1.4,
    },
  },

  /* ------------------------------------------------------------- recruiting */
  recruit: {
    interval:     1.2,   // seconds between recruits at the start
    intervalMin:  0.45,  // floor as difficulty ramps
    rampTime:     240,   // seconds to reach the floor
    startingHerd: 12,
    spawnDistMin: 420,   // recruits enter from off-screen and run to the herd
    spawnDistMax: 700,
  },

  /* ------------------------------------------------------------------ rally */
  rally: {
    snapTime:    0.18,   // how fast the cohesion radius interpolates
    ringDust:    18,     // dust particles on the snap
    desaturate:  0.18,   // world desaturation while rallying, 0..1

    // "Almost nothing gets caught" -- the actual payoff of rallying, and the
    // reason it is a decision rather than a downside. Without this, rally is
    // pure cost: 25% slower AND the herd packed into a dense blob that is
    // easier to grab from, which measurably made never touching the button
    // the strongest way to play. The cost stays exactly as designed (slow,
    // unable to spread out to dodge, and gohids gathering around you while
    // you sit still) -- this is the benefit those costs are paid for.
    captureResist:    0.85,  // fraction of grabs that fail on a rallied aydin
    protectRadiusMul: 1.35,  // must be within rallyRadius * this to count
  },

  /* ------------------------------------------------------------------ score */
  score: {
    perAydinPerSecond: 1,
  },

  /* ------------------------------------------------------------------ input */
  input: {
    deadzone:       0.18,
    joystickRadius: 70,   // virtual stick travel, css px
    joystickDead:   8,
  },

  /* ---------------------------------------------------------------- effects */
  fx: {
    maxParticles: 700,
    shake: {
      capture: 5,
      gohidSpawn: 7,
      scatter: 11,
    },
    // Animation is quantised into this many steps so movement reads as
    // limited-frame pixel art rather than smooth tweening.
    animSteps: 4,
    bobSpeed: 7,
    bobAmount: 2,
  },

  /* ------------------------------------------------------------------ audio */
  audio: {
    enabled: true,
    volume: 0.5,
  },

  /* ---------------------------------------------------------------- palette */
  palette: {
    steppeFloorA: '#6f7f4a',
    steppeFloorB: '#677844',
    steppeDecor:  '#5c6b3e',
    steppeDecor2: '#7d8d56',
    aydinTint:    null,      // null = leave the base sprite untinted
    gohidTint:    '#c65a4a',
    commanderTint: null,
    dust:         '#d8cba8',
    blood:        '#8e3b34',
    ui: {
      aydin: '#ffd98a',
      gohid: '#ff6a5a',
      text:  '#f4ecd8',
    },
  },

  /* ------------------------------------------------------------- persistence */
  storage: {
    key: 'runfromgohid.save.v1',
  },

  /* ------------------------------------------------------------------ debug */
  debug: {
    showGrid: false,
    showFlockVectors: false,
    showFps: true,
  },
};
