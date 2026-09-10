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

    // CROPPING IS OFF, and should stay off unless there is a real reason.
    // This was [0.10, 0.02, 0.80, 0.72], read as [x, y, w, h] fractions, which
    // threw away 10% from each side and the entire bottom 28% of the source --
    // it beheaded the character. If a crop is ever wanted again it must be
    // derived from the image's own alpha bounding box, never hardcoded
    // fractions, and it must never cut into the subject.
    gohidCrop: null,

    // Each sprite's base canvas is built at the size it is actually DRAWN at
    // (CFG.<entity>.sprite), not at one shared resolution.
    //
    // A single global pixelSize forces a second resample at draw time: a 48px
    // base drawn at 34px is downscaled again with smoothing disabled, which
    // both throws away the detail the larger base was for AND makes the sprite
    // shimmer as it moves. Matching the two means drawImage is 1:1 and every
    // sprite is as sharp as its source allows.
    //
    // Variants that draw larger (the Brute) upscale from this base with
    // nearest-neighbour, which reads as the same creature rendered chunkier --
    // the correct look here rather than a defect.
    supersample: 1,
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

    // The camera zooms OUT on small viewports so roughly the same amount of
    // world stays visible. Without this a phone shows 375 world units across
    // against a desktop's 1280, so a herd of fifty is almost entirely
    // off-screen and the game stops being about reading a crowd -- measured
    // on a 375x812 viewport, 3 of 49 aydins were visible.
    //
    // Floored rather than fully compensating: at true parity a phone would
    // render 44px sprites at 13px, which trades one legibility problem for
    // another. 0.6 is the compromise, and it is a config number so it can be
    // argued with.
    minVisibleWorld: 900,  // world units to try to fit across the width
    zoomMin: 0.6,
    zoomMax: 1,
  },

  /* ------------------------------------------------------------- commander */
  commander: {
    speed:         300,
    radius:        14,
    sprite:        40,   // draw size in world units AND base canvas resolution
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
    sprite:       34,    // also the base canvas resolution -- see assets.supersample
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
    sprite:      44,     // also the base canvas resolution; the gohid is the
                         // face the player reads under pressure, so it is the
                         // largest of the three
    grabRadius:  26,
    turnRate:    7,      // steering responsiveness
    spawnTelegraph: 1.5, // expanding ring + rising tone before it exists
    grabCooldown: 0.35,  // stops one gohid clearing a clump in a single frame
    // Gohids shoulder each other apart. separationStrength has to be within
    // reach of `speed`, or it loses: the seek term pulls at the full 250
    // toward whichever aydin is nearest, so at 90 the push-apart was outgunned
    // ~3:1 and a pack converging on one straggler collapsed into a literal
    // stack of overlapping sprites. Measured over 150s on a crowded board,
    // counting gohid pairs closer than 20px:
    //     22 / 90   -> 37 overlapping pairs   (a pile of faces)
    //     26 / 170  ->  0
    //     30 / 320  ->  0, but noticeably reshapes the pack into a dragnet
    // 26/170 is the smallest change that fixes it.
    separation:   26,
    separationStrength: 170,
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

  /* ------------------------------------------------------------ progression */
  score: {
    perAydinPerSecond: 1,
  },

  exp: {
    perAydinPerSecond: 0.6,
    // DEVIATION FROM SPEC: the spec says curveBase 20. Measured, that gives a
    // level-up every 2.6-4.5s for the first ten levels -- a card modal that
    // pauses the game every three seconds, which is unplayable. Exp scales
    // with herd size (0.6/aydin/sec), so ~30 aydins already earn 18 exp/sec
    // against a 20-exp first level.
    //   base  20 -> levels at 3,5,8,11,14,17,20,24,28,32s   (level 29 by 5min)
    //   base  60 -> levels at 7,13,18,24,30,36,43,51,59,69s (level 16 by 5min)
    //   base 120 -> levels at 12,21,30,39,48,57,66,78,91s   (level 14 by 5min)
    // 120 gives a level every 9-18s, which is a normal roguelite cadence and
    // still reaches level 30 in a long run. Flagged in CLAUDE.md for review.
    curveBase:  120,     // exp needed for level 2
    curveGrowth: 1.18,   // each level costs this much more than the last
    cardsPerLevel: 3,
  },

  /* ------------------------------------------------------------- upgrades
   * Per-level numbers for every passive. The registry in js/upgrades.js holds
   * names, descriptions and icons; every quantity lives here so rebalancing
   * never means opening logic. All are "per level" unless noted.
   * --------------------------------------------------------------------- */
  upgrades: {
    boots:      { perLevel: 0.07 },   // commander speed
    whistle:    { perLevel: 0.18 },   // cohesion strength
    grazing:    { perLevel: 0.05 },   // aydin speed
    // Measured at +62% score against a no-upgrade baseline at 0.14 -- roughly
    // three times the next best upgrade (decoyDummy, +22%). Recruit rate is
    // the dominant lever in the whole economy, so a percentage buff to it is
    // worth far more than the same percentage anywhere else.
    beacon:     { perLevel: 0.055 },  // recruit rate
    slippery:   { perLevel: 0.08 },   // gohids miss this often
    wideRally:  { perLevel: 0.16 },   // rally radius
    ironNerve:  { perLevel: 0.14 },   // panic duration cut
    amulet:     { perLevel: 0.12 },   // exp multiplier
    clover:     { perLevel: 0.15 },   // luck: better cards and chests
    coldAura:   { radius: 250, perLevel: 0.09 },
    longLegs:   { perLevel: 0.22 },   // fraction of the rally speed cost removed
    secondWind: { threshold: 5, revive: 3 },   // once per run
    sharpEyes:  { perLevel: 0.45 },   // pickup magnet range
    thickHide:  { perLevel: 0.13 },   // scatter duration cut
    vanguard:   { perLevel: 0.11 },   // share of the herd's leading edge immune
    fastHands:  { perLevel: 0.10 },   // tool cooldown cut
    bigHeart:   { perLevel: 0.16 },   // character aydin spawn rate
    stampede:   { perLevel: 0.09, duration: 3 },  // herd speed after a capture
  },

  /* ---------------------------------------------------------------- tools
   * `kind` routes behaviour in js/tools.js: cast fires on a cooldown, aura is
   * continuous, orbit maintains escorts, passive just sets a buff. Adding a
   * tool should be a table entry, an icon and one case in the fire switch.
   * --------------------------------------------------------------------- */
  tools: {
    smokeBomb:   { kind: 'cast',  cooldown: 7.0, radius: 150, duration: 3.0,
                   radiusPerLevel: 22, durationPerLevel: 0.35 },
    netTrap:     { kind: 'cast',  cooldown: 6.0, duration: 2.5, range: 520,
                   durationPerLevel: 0.35, targetsPerLevel: 0.5 },
    flashbang:   { kind: 'cast',  cooldown: 22.0, duration: 2.2,
                   durationPerLevel: 0.4 },
    decoyDummy:  { kind: 'cast',  cooldown: 12.0, duration: 5.0, pull: 700,
                   durationPerLevel: 0.6 },
    barricade:   { kind: 'cast',  cooldown: 9.0, duration: 8.0, length: 120,
                   push: 260, lengthPerLevel: 24 },
    slingshot:   { kind: 'cast',  cooldown: 4.0, knockback: 400, range: 560,
                   knockPerLevel: 45 },
    tunnel:      { kind: 'cast',  cooldown: 18.0, distance: 600,
                   distancePerLevel: 40 },
    bola:        { kind: 'cast',  cooldown: 8.0, duration: 3.0, slow: 0.55,
                   range: 520, durationPerLevel: 0.35 },
    firecracker: { kind: 'cast',  cooldown: 10.0, radius: 320, flee: 3.0,
                   radiusPerLevel: 40 },

    piedPiper:   { kind: 'aura',  radiusMul: 0.90, perLevel: 0.045 },
    dustCloud:   { kind: 'aura',  radius: 190, slow: 0.30,
                   radiusPerLevel: 24, slowPerLevel: 0.035 },
    warDrum:     { kind: 'aura',  speed: 0.12, perLevel: 0.025 },
    lantern:     { kind: 'aura',  radius: 700, radiusPerLevel: 90 },

    outriders:   { kind: 'orbit', count: 2, countPerLevel: 0.5, radius: 96,
                   speed: 1.5, respawn: 8.0 },
    shepherds:   { kind: 'passive', charBoost: 0.25, perLevel: 0.0 },
  },

  /* ------------------------------------------------------------ evolutions
   * Both ingredients at max level fuse automatically. `needs` entries are
   * upgrade ids; `needsCharacter` waits on a living character aydin.
   * --------------------------------------------------------------------- */
  evolutions: {
    blackout:    { from: ['smokeBomb', 'dustCloud'] },
    snareWeb:    { from: ['netTrap', 'bola'], radius: 240 },
    ironHerd:    { from: ['piedPiper', 'whistle'] },
    phantomHerd: { from: ['decoyDummy'], needsCharacter: 'trickster', fakes: 5 },
    honourGuard: { from: ['outriders', 'vanguard'], count: 6 },
  },

  /* --------------------------------------------------------- level-up cards */
  cards: {
    count: 3,
    // Luck shifts weight toward tools and evolutions rather than raw stats,
    // so a lucky roll feels different rather than merely better.
    baseToolWeight: 1.0,
    basePassiveWeight: 1.0,
    luckToolBonus: 0.35,
  },

  /* ----------------------------------------------------------- characters
   * Character aydins. Rare, named, and each with one passive ability -- the
   * point is to give the player something SPECIFIC to protect instead of one
   * anonymous blob, so losing one has to hurt.
   *
   * Abilities scale by CFG.tools.shepherds.charBoost when Shepherd's Mark is
   * owned; that multiplier is applied in js/characters.js, not baked in here.
   * --------------------------------------------------------------------- */
  characters: {
    interval:     35,     // seconds between arrivals
    intervalMin:  22,     // floor as the run goes on
    rampTime:    300,
    spawnDist:   340,     // arrives this far from the commander
    invuln:        2.5,   // longer than a normal recruit; it arrives announced

    shield:    { blocks: 1 },
    medic:     { chance: 0.35 },
    trickster: { every: 8, pull: 700, duration: 4 },
    bard:      { radius: 300, speed: 0.18 },
    banner:    { cohesionCut: 0.25 },
    scout:     { magnet: 3 },
    trapper:   { every: 0.35, radius: 46, slow: 0.45, duration: 2, life: 6 },
    warden:    { every: 20 },
    hound:     { strayDist: 400, push: 260 },
    elder:     { exp: 0.40 },
  },

  /* ------------------------------------------------------------- variants
   * Gohid variants, unlocked by elapsed run time so the threat keeps changing.
   * `weight` is the relative chance of being picked once unlocked.
   *
   * Every variant is the SAME sprite with a tint and a badge -- no new art.
   * --------------------------------------------------------------------- */
  variants: {
    // Unlock times in seconds. The baseline is always available.
    gohid:   { after:   0, weight: 10, tint: '#e0435a', tintAmt: 0.62, badge: '',
               speedMul: 1.00, sizeMul: 1.00 },
    runner:  { after:  60, weight:  6, tint: '#ff7a4a', tintAmt: 0.60, badge: '>',
               speedMul: 1.32, sizeMul: 0.88, grabRadius: 16 },
    brute:   { after: 110, weight:  3, tint: '#8f1f34', tintAmt: 0.66, badge: '#',
               speedMul: 0.72, sizeMul: 1.45, grabCount: 2 },
    howler:  { after: 150, weight:  3, tint: '#b96ad6', tintAmt: 0.58, badge: '~',
               speedMul: 0.92, sizeMul: 1.10, canGrab: false,
               every: 6, radius: 500 },
    herder:  { after: 200, weight:  3, tint: '#d69a4a', tintAmt: 0.58, badge: '<',
               speedMul: 1.05, sizeMul: 1.05, canGrab: false,
               push: 300, radius: 260 },
    stalker: { after: 240, weight:  4, tint: '#6f7fa8', tintAmt: 0.55, badge: '.',
               speedMul: 1.18, sizeMul: 0.95, revealAt: 250, hiddenAlpha: 0.30 },
    hunter:  { after: 300, weight:  2, tint: '#ff3b6b', tintAmt: 0.70, badge: '!',
               speedMul: 1.12, sizeMul: 1.00 },
    splitter:{ after: 360, weight:  2, tint: '#7ee081', tintAmt: 0.55, badge: '+',
               speedMul: 0.95, sizeMul: 1.15, splitInto: 'runner', splitCount: 2 },
  },

  /* --------------------------------------------------------------- minimap */
  minimap: {
    size:       148,     // css px, square
    sizeMobile:  92,     // 148 swallowed 40% of a 375px-wide screen
    dotHerd:      2,
    dotGohid:     3,
    dotCommander: 4,
    refreshHz:   20,     // redrawn on its own clock, not every frame
  },

  /* -------------------------------------------------------------- banners */
  banner: {
    duration: 2.6,
    popSteps: 5,
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

  /* ------------------------------------------------------------------ music
   * Songs are FILES, not base64. Sprites and the font are inlined so a
   * file:// page can read their pixels; music only needs to be played, and an
   * <audio> element plays a local file happily. Inlining 5MB of audio would
   * also mean parsing 6.7MB of base64 before the first frame.
   *
   * `src` lists candidates in preference order and the first that loads wins.
   * welcome-to-the-game is Opus in an MP4 container, which this browser plays
   * but Firefox and Safari may not, so a lossless Ogg remux sits in front of
   * it. Nothing is re-encoded; both files are the original audio.
   *
   * For Safari an AAC version would be needed:
   *   ffmpeg -i welcome-to-the-game.m4a -c:a aac -b:a 192k out.m4a
   * -------------------------------------------------------------------- */
  music: {
    enabled: true,
    volume: 0.45,
    fade: 1.4,           // seconds to cross between tracks
    duckWhilePaused: 0.4, // multiplier while a pausing screen is open
    duckFade: 0.3,       // ducking is quick; a 1.4s dip on every level-up drags

    tracks: {
      menu: {
        title: 'Welcome to the Game',
        src: ['assets/music/welcome-to-the-game.ogg',
              'assets/music/welcome-to-the-game.m4a'],
      },
      run: {
        title: 'Welcome to the 2nd Game',
        src: ['assets/music/welcome-to-the-2nd-game.mp3'],
      },
    },
  },

  /* ---------------------------------------------------------------- palette
   * These MUST stay in step with the CSS custom properties in css/style.css.
   * The canvas cannot read CSS variables, so the handful of colours needed for
   * world and minimap drawing are duplicated here -- the CSS is the reference,
   * this is the copy.
   *
   * The whole game reads off one idea: warm gold is yours, red is coming for
   * you, cool blue is safe. Never tint a gohid warm or an aydin red.
   * ------------------------------------------------------------------------ */
  palette: {
    ink:        '#0d0b14',
    panel:      '#1b1726',
    panelLt:    '#2a2438',
    border:     '#4a3f63',
    text:       '#ece6f5',
    textDim:    '#9a8fb5',
    aydin:      '#ffcc6a',
    aydinGlow:  '#ffe9b0',
    gohid:      '#e0435a',
    gohidDark:  '#8f1f34',
    rally:      '#8ab6ff',
    score:      '#ffd76a',
    exp:        '#5ad1c4',
    good:       '#7ee081',
    bad:        '#ff5c5c',

    // World tinting. The gohid tint is strong on purpose: both photos are
    // dark-haired head-and-shoulders cutouts, and at 40px they read almost
    // identically unless the threat is pushed hard toward red.
    gohidTint:      '#e0435a',
    gohidTintAmt:   0.62,
    aydinTint:      null,
    commanderTint:  null,
    dust:           '#d8cba8',
    blood:          '#8f1f34',

    // Open Steppe floor. Each arena overrides these in js/arenas.js.
    // Kept close together on purpose: a wider delta reads as a chessboard
    // rather than ground. The texture comes from the decor pass, not the tiles.
    steppeFloorA: '#3f4f31',
    steppeFloorB: '#3c4b2e',
    steppeDecor:  '#2f3b24',
    steppeDecor2: '#465734',

    // World furniture, kept here rather than inline in render.js so an arena
    // can restyle the whole scene by swapping palette entries.
    world: {
      void:       '#0d0b14',   // outside the arena bounds
      edge:       '#4a3f63',   // the arena boundary itself
      shadow:     'rgba(13,11,20,0.32)',
      herdRing:   '#cfc4e6',   // cohesion radius, idle
      rallyRing:  '#8ab6ff',   // cohesion radius, rallying
      invulnFlash:'#ffffff',
      panicTint:  '#ff9aa6',
      panicAmt:   0.34,
      hitFlash:   '#e0435a',
      stick:      '#ece6f5',
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
