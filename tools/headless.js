/* =============================================================================
 * tools/headless.js  --  run the simulation with no browser.
 *
 *   node tools/headless.js            assertions only
 *   node tools/headless.js --balance  plus a balance table
 *
 * Loads the real config.js, utils.js, spatial.js, particles.js, entities.js and
 * game.js into a vm sandbox and stubs only the things that genuinely need a
 * DOM (audio, input, canvas). Nothing about the flocking, hunting, capture or
 * spawning logic is re-implemented here -- if this passes, it passed against
 * the same code the browser runs.
 *
 * Two reasons this exists rather than testing only by hand in a browser:
 *
 * 1. The spec says to tune by playing, which means running the same minute of
 *    play over and over with one number changed. A headless run does five
 *    simulated minutes in well under a second, so a balance sweep is cheap.
 *
 * 2. Invariants like "the commander does not move when no key is held" are
 *    almost impossible to confirm by eye in a live browser -- a hidden tab or
 *    a stray synthetic event from an automation harness looks identical to a
 *    real bug.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ sandbox */

const sandbox = {
  console,
  Math,
  Date,
  JSON,
  performance: { now: () => Date.now() },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

// Audio and input are the only game dependencies that need the browser.
// Input is driven directly by tests; audio is a no-op recorder.
sandbox.Audio2 = new Proxy({ events: {} }, {
  get(t, k) {
    if (k === 'events') return t.events;
    return () => { t.events[k] = (t.events[k] || 0) + 1; };
  },
});
sandbox.Input = {
  mx: 0, my: 0, rally: false, rallyPressed: false, rallyReleased: false,
  keys: {}, stick: { active: false }, rallyTouchId: null,
  update() {},
  consumeRallyPressed() { const v = this.rallyPressed; this.rallyPressed = false; return v; },
  consumeRallyReleased() { const v = this.rallyReleased; this.rallyReleased = false; return v; },
};

// game.js announces level-ups through UI and asks it whether a pausing screen
// is open. Neither concerns the simulation, so both are stubbed rather than
// loaded -- keeping game.js free of DOM knowledge is what lets it run here.
sandbox.UI = {
  paused: false,
  banners: [],
  banner(text) { this.banners.push(text); },
  clearBanners() { this.banners.length = 0; },
  show() {}, hide() {}, showChest() {},
  // A level-up in the browser opens a modal and waits. Here it resolves
  // immediately, taking the first card offered -- a player who always picks
  // something is a far better model of a real run than one who never levels,
  // and it exercises the whole take/rebuild/sync path on every balance sweep.
  // --no-upgrades models the opposite extreme.
  showLevelUp(cards, onPick) {
    if (SKIP_UPGRADES || !cards.length || !onPick) return;
    onPick(cards[0]);
  },
};
const SKIP_UPGRADES = process.argv.includes('--no-upgrades');

// tools.js reads the viewport for the flashbang's "everything on screen"
// radius and draws with sprites; neither concerns the simulation.
sandbox.Render = { w: 1280, h: 720, zoom: 1 };
sandbox.Sprites = { tinted: () => null, silhouette: () => null, base: {} };

vm.createContext(sandbox);

for (const f of ['js/config.js', 'js/utils.js', 'js/spatial.js',
                 'js/particles.js', 'js/entities.js', 'js/upgrades.js',
                 'js/tools.js', 'js/game.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}

// config.js and friends declare CFG/Game/... with `const`, which in a vm
// context lands in the shared global LEXICAL scope rather than as a property
// of the sandbox object -- so they are invisible via `sandbox.Game`. Evaluate
// an expression inside the context to get hold of them.
const { CFG, Game, U } = vm.runInContext('({ CFG, Game, U })', sandbox);
const Input = sandbox.Input;
const GohidClass = vm.runInContext('Gohid', sandbox);
const Upgrades = vm.runInContext('Upgrades', sandbox);
const Tools = vm.runInContext('Tools', sandbox);
Upgrades.init();
const AydinClass = vm.runInContext('Aydin', sandbox);

/* --set a.b.c=value overrides any config value before the sim runs, so a
 * balance sweep never means editing config.js and remembering to put it back.
 *   node tools/headless.js --balance --set recruit.intervalMin=0.9
 */
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== '--set') continue;
  const [dotted, raw] = String(process.argv[i + 1] || '').split('=');
  if (!dotted || raw === undefined) continue;
  const parts = dotted.split('.');
  let node = CFG;
  for (let j = 0; j < parts.length - 1; j++) node = node[parts[j]];
  const leaf = parts[parts.length - 1];
  if (node === undefined || !(leaf in node)) {
    console.error('  !! unknown config path: ' + dotted);
    process.exit(2);
  }
  node[leaf] = isNaN(Number(raw)) ? raw : Number(raw);
  console.log('  set ' + dotted + ' = ' + node[leaf]);
}

const QUIET = process.argv.includes('--quiet');
const _log = console.log;
if (QUIET) console.log = () => {};

/* -------------------------------------------------------------- test runner */

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok    ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* Advance the simulation at a fixed step. Fixed dt keeps runs reproducible;
 * 1/60 matches the frame budget the game is tuned against. */
function run(seconds, dt) {
  const step = dt || 1 / 60;
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) Game.update(step);
}

function newRun() {
  Input.mx = 0; Input.my = 0; Input.rally = false;
  Game.init();
  Game.state = 'playing';
  Game.reset();
}

/* ------------------------------------------------------------------- tests */

console.log('\n-- movement ------------------------------------------------');

newRun();
{
  // Gohids are removed so this isolates drift. With them in play a stationary
  // commander gets walked into repeatedly, and each knockback shifts him about
  // 43px -- which over a few idle minutes looks exactly like a movement bug
  // but is the mechanic working as designed.
  Game.gohids.length = 0;
  Game.pending.length = 0;
  const x0 = Game.commander.x, y0 = Game.commander.y;
  run(10);
  const moved = Math.hypot(Game.commander.x - x0, Game.commander.y - y0);
  check('commander is perfectly stationary with no input and no gohids',
        moved < 0.001, 'moved ' + moved.toFixed(3) + 'px');
}

newRun();
{
  // ...and confirm the knockback path is what moves him otherwise.
  const g = Game.gohids[0];
  const c = Game.commander;
  g.x = c.x; g.y = c.y - 5;
  const x0 = c.x, y0 = c.y;
  run(0.5);
  const moved = Math.hypot(c.x - x0, c.y - y0);
  check('a gohid touching the commander scatters the herd and knocks him back',
        Game.stats.scatters === 1 && moved > 5,
        'scatters=' + Game.stats.scatters + ' moved=' + moved.toFixed(1));
}

newRun();
{
  // Held right for 1s should cover almost exactly the configured speed.
  Input.mx = 1; Input.my = 0;
  const x0 = Game.commander.x;
  run(1);
  const d = Game.commander.x - x0;
  check('commander speed matches config (' + CFG.commander.speed + ')',
        Math.abs(d - CFG.commander.speed) < 2, 'moved ' + d.toFixed(1));
}

newRun();
{
  Input.mx = 1; Input.rally = true;
  const x0 = Game.commander.x;
  run(1);
  const d = Game.commander.x - x0;
  const want = CFG.commander.speed * CFG.commander.rallySlow;
  check('rally slows the commander to ' + want, Math.abs(d - want) < 2,
        'moved ' + d.toFixed(1));
}

console.log('\n-- the core speed relationship -----------------------------');
{
  const c = CFG.commander.speed;
  const a = CFG.aydin.speed;
  const g = CFG.gohid.speed;
  const panic = a * CFG.aydin.panicSpeedMul;
  check('commander(' + c + ') > aydin(' + a + ')', c > a);
  check('aydin(' + a + ') > gohid(' + g + ')', a > g);
  check('gohid(' + g + ') catches a NON-panicking straggler only by cutting in',
        g < a);
  // A panicking aydin outruns a gohid in a straight line, so captures come
  // from being cornered or cut off, never from a fair chase. If this flips,
  // panicking becomes a death sentence and rally stops mattering.
  check('panicking aydin(' + panic.toFixed(0) + ') outruns gohid(' + g + ')', panic > g);
}

console.log('\n-- rally ---------------------------------------------------');

newRun();
{
  run(1);
  const loose = Game.cohesionRadius;
  Input.rally = true;
  run(1);
  const tight = Game.cohesionRadius;
  check('cohesion radius collapses on rally',
        loose > 250 && tight < 95, loose.toFixed(0) + ' -> ' + tight.toFixed(0));
}

/* How tightly a CALM herd packs, rallied vs not, from an identical start.
 *
 * The first version of this ran the herd for 1s rallied and then 3s released
 * and compared the two. That failed about once in thirty runs (108px rallied
 * vs 104px loose) because it was measuring wander noise: cohesion only pulls
 * once an aydin is outside the radius, so a herd that begins near the
 * commander stays near it whether or not rally is held, and idle jitter
 * decides the winner. Both arms now start from the same deterministic ring,
 * well outside the loose radius, and run for the same duration. */
function calmHerdScenario(rally) {
  newRun();
  Game.gohids.length = 0;          // no panic, no captures -- cohesion only
  Game.pending.length = 0;
  const c = Game.commander;
  Game.aydins.forEach((a, i) => {
    const ang = (Math.PI * 2 * i) / Game.aydins.length;
    a.x = c.x + Math.cos(ang) * 340;
    a.y = c.y + Math.sin(ang) * 340;
    a.vx = 0; a.vy = 0;
    a.invuln = 0;
  });
  Input.rally = rally;
  run(2.5);
  Input.rally = false;
  let s = 0;
  for (const a of Game.aydins) s += Math.hypot(a.x - c.x, a.y - c.y);
  return s / Math.max(1, Game.aydins.length);
}

{
  const rallied = calmHerdScenario(true);
  const released = calmHerdScenario(false);
  check('rally packs a calm herd tighter than not rallying',
        rallied < released * 0.7,
        'rallied ' + rallied.toFixed(0) + 'px vs released ' + released.toFixed(0) + 'px');
}

/* Rally under real pressure, measured as an A/B against the identical
 * scenario with rally released. An absolute "must reach N px" threshold is
 * meaningless here -- a ring of gohids pushing outward sets its own
 * equilibrium -- but rallied vs not-rallied in the same setup is exactly the
 * question the player is asking when they press the button. Layout is
 * deterministic so the two arms are genuinely comparable. */
function panickedHerdScenario(rally) {
  newRun();
  const c = Game.commander;
  Game.aydins.forEach((a, i) => {
    const ang = (Math.PI * 2 * i) / Game.aydins.length;
    const r = 380 + (i % 5) * 65;
    a.x = c.x + Math.cos(ang) * r;
    a.y = c.y + Math.sin(ang) * r;
    a.vx = 0; a.vy = 0;
    a.panic = CFG.aydin.panicTime;
    a.invuln = 0;
  });
  // Ring the herd with gohids so panic is re-applied every single frame.
  Game.gohids.length = 0;
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI * 2 * i) / 10;
    Game.gohids.push(new GohidClass(c.x + Math.cos(ang) * 470,
                                    c.y + Math.sin(ang) * 470));
  }
  const spread = () => {
    let s = 0;
    for (const a of Game.aydins) s += Math.hypot(a.x - c.x, a.y - c.y);
    return s / Math.max(1, Game.aydins.length);
  };
  const before = spread();
  Input.rally = rally;
  run(2.5);
  const after = spread();
  Input.rally = false;
  return { before: before, after: after };
}

{
  const on = panickedHerdScenario(true);
  const off = panickedHerdScenario(false);
  check('rally gathers a herd that is PANICKING, not just a calm one',
        on.after < on.before * 0.7,
        on.before.toFixed(0) + 'px -> ' + on.after.toFixed(0) + 'px');
  check('rally beats not-rallying under identical pressure',
        on.after < off.after * 0.8,
        'rallied ' + on.after.toFixed(0) + 'px vs released ' + off.after.toFixed(0) + 'px');
}

console.log('\n-- scatter -------------------------------------------------');

/* Fraction of the timeline the herd spends in the outward-flee scatter state
 * when a gohid is touching the commander CONTINUOUSLY.
 *
 * Deterministic on purpose. Measuring this inside a normal fight was flaky --
 * there, how often you get touched depends on how often a gohid happens to
 * reach you, so the cooldown is not the binding constraint and two runs of the
 * same config differ by 10+ points. Pinning a gohid to the commander makes the
 * cooldown the only thing deciding the answer, which is exactly what is under
 * test. Grabs are disabled so the herd survives to be measured -- an earlier
 * version of this test reported 97% while actually measuring a wiped-out herd
 * whose scatterTimer had frozen after the run ended.
 */
function scatterDutyCycle(cooldown) {
  const savedCd = CFG.commander.touchCooldown;
  const savedGrab = CFG.gohid.grabRadius;
  CFG.commander.touchCooldown = cooldown;
  CFG.gohid.grabRadius = 0;
  newRun();
  const c = Game.commander;
  const g = Game.gohids[0];
  let scattered = 0, frames = 0;
  const step = 1 / 60;
  for (let i = 0; i < 60 * 20; i++) {
    g.x = c.x; g.y = c.y;           // glued on: a touch is offered every frame
    Game.update(step);
    if (Game.state !== 'playing') break;
    frames++;
    if (Game.scatterTimer > 0) scattered++;
  }
  CFG.commander.touchCooldown = savedCd;
  CFG.gohid.grabRadius = savedGrab;
  return frames ? scattered / frames : 1;
}

{
  check('touch cooldown outlasts the scatter it triggers',
        CFG.commander.touchCooldown > CFG.aydin.scatter.duration,
        'cooldown ' + CFG.commander.touchCooldown + 's vs scatter '
        + CFG.aydin.scatter.duration + 's');

  // A scatter can never occupy more than duration/cooldown of the timeline.
  // The failure this guards against is not "scatter happens often", it is
  // "scatter never STOPS" -- it overrides cohesion and rally both, so a herd
  // stuck in it leaves the player holding a button that provably does nothing.
  const bound = CFG.aydin.scatter.duration / CFG.commander.touchCooldown;
  const now = scatterDutyCycle(CFG.commander.touchCooldown);
  check('scatter cannot become the herd default under constant contact',
        now <= bound + 0.03,
        Math.round(now * 100) + '% of frames (bound ' + Math.round(bound * 100) + '%)');

  // Prove the measurement sees the bug it exists for: at the originally
  // shipped 1.0s cooldown -- shorter than the 1.5s scatter -- scatters chain
  // end to end and the herd never leaves the state.
  const broken = scatterDutyCycle(1.0);
  check('a cooldown shorter than the scatter pins the herd in it permanently',
        broken > 0.97 && now < 0.7,
        'at 1.0s: ' + Math.round(broken * 100) + '%  vs at '
        + CFG.commander.touchCooldown + 's: ' + Math.round(now * 100) + '%');
}

console.log('\n-- upgrades ------------------------------------------------');

{
  // The registry is hand-written data, and a typo in it produces a card that
  // renders blank or an effect that silently never applies. These checks are
  // cheap and catch exactly that.
  const ids = Object.create(null);
  let dupes = 0, badDesc = 0, badIcon = 0, badApply = 0;
  for (const u of Upgrades.list) {
    if (ids[u.id]) dupes++;
    ids[u.id] = true;
    if (typeof u.icon !== 'function') badIcon++;
    if (typeof u.apply !== 'function') badApply++;
    for (let lv = 0; lv <= u.max; lv++) {
      try {
        const d = u.desc(lv);
        if (typeof d !== 'string' || !d.length) badDesc++;
      } catch (e) { badDesc++; }
    }
  }
  check('every upgrade id is unique', dupes === 0, dupes + ' duplicates');
  check('every upgrade describes itself at every level', badDesc === 0,
        badDesc + ' bad descriptions');
  check('every upgrade has an icon and an apply', badIcon === 0 && badApply === 0);

  // Every tool in the registry must have numbers, and every set of numbers
  // must have a registry entry -- otherwise one of them is dead weight.
  let missingCfg = 0;
  const registryTools = Object.create(null);
  for (const u of Upgrades.list) {
    if (u.kind !== 'tool') continue;
    registryTools[u.id] = true;
    if (!CFG.tools[u.id]) missingCfg++;
  }
  let orphanCfg = 0;
  for (const id in CFG.tools) if (!registryTools[id]) orphanCfg++;
  check('every tool has config numbers and vice versa',
        missingCfg === 0 && orphanCfg === 0,
        missingCfg + ' without config, ' + orphanCfg + ' without a registry entry');
}

{
  newRun();
  // Buffs are rebuilt from scratch, so taking the same upgrade must land on
  // exactly the configured value rather than accumulating rounding or drift.
  Upgrades.take('boots');
  Upgrades.take('boots');
  Upgrades.take('boots');
  const want = 1 + CFG.upgrades.boots.perLevel * 3;
  check('a passive applies exactly its configured value',
        Math.abs(Game.buffs.commanderSpeed - want) < 1e-9,
        Game.buffs.commanderSpeed.toFixed(4) + ' vs ' + want.toFixed(4));

  // Rebuilding twice must be identical -- the whole point of rebuilding from
  // scratch instead of incrementing a live value.
  const before = Game.buffs.commanderSpeed;
  Upgrades.rebuild();
  Upgrades.rebuild();
  check('rebuilding the buff bag is idempotent',
        Game.buffs.commanderSpeed === before);

  check('an upgrade cannot exceed its max level', (() => {
    for (let i = 0; i < 20; i++) Upgrades.take('boots');
    return Upgrades.levelOf('boots') === Upgrades.byId.boots.max;
  })(), 'boots at ' + Upgrades.levelOf('boots'));
}

{
  newRun();
  // A maxed upgrade must never be offered again, or the player is handed a
  // card that does nothing.
  for (let i = 0; i < 5; i++) Upgrades.take('boots');
  let offeredMaxed = 0, dupeInOffer = 0;
  for (let trial = 0; trial < 200; trial++) {
    const cards = Upgrades.offer(3);
    const seen = Object.create(null);
    for (const c of cards) {
      if (c.id === 'boots') offeredMaxed++;
      if (seen[c.id]) dupeInOffer++;
      seen[c.id] = true;
    }
  }
  check('a maxed upgrade is never offered', offeredMaxed === 0,
        offeredMaxed + ' offers over 200 draws');
  check('one draw never offers the same card twice', dupeInOffer === 0,
        dupeInOffer + ' duplicates');
}

{
  newRun();
  Upgrades.take('smokeBomb');
  const t = Tools.active.filter((x) => x.id === 'smokeBomb')[0];
  check('taking a tool puts it in the active list', !!t && t.level === 1);
  check('the tool tray sees it through Game.tools',
        Game.tools === Tools.active && Game.tools.length === 1);

  const base = t ? t.cooldown : 0;
  for (let i = 0; i < 3; i++) Upgrades.take('fastHands');
  Tools.sync();
  const after = Tools.active.filter((x) => x.id === 'smokeBomb')[0].cooldown;
  check('cooldown reduction reaches the tool', after < base,
        base.toFixed(2) + 's -> ' + after.toFixed(2) + 's');
}

{
  newRun();
  // Evolutions fuse only when BOTH ingredients are maxed.
  const evo = CFG.evolutions.snareWeb.from;
  for (let i = 0; i < 5; i++) Upgrades.take(evo[0]);
  check('one maxed ingredient does not evolve', !Upgrades.hasEvolution('snareWeb'));
  for (let i = 0; i < 5; i++) Upgrades.take(evo[1]);
  check('both maxed ingredients fuse automatically',
        Upgrades.hasEvolution('snareWeb'));
  check('the fusion freezes the frame briefly', Game.freeze > 0,
        'freeze ' + Game.freeze.toFixed(2) + 's');
}

{
  newRun();
  // Slippery is a flat miss chance; at 100% nothing can ever be caught.
  CFG.upgrades.slippery.perLevel = 0.2;      // 5 levels -> 1.0
  for (let i = 0; i < 5; i++) Upgrades.take('slippery');
  const c = Game.commander;
  Game.gohids.length = 0;
  for (let i = 0; i < 6; i++) {
    const g = new GohidClass(c.x, c.y + 200);
    Game.gohids.push(g);
  }
  Game.aydins.forEach((a) => { a.invuln = 0; a.x = c.x; a.y = c.y + 200; });
  const before = Game.aydins.length;
  run(3);
  check('a 100% miss chance means nothing is ever captured',
        Game.stats.lost === 0, Game.stats.lost + ' lost');
  CFG.upgrades.slippery.perLevel = 0.08;     // restore
}

{
  newRun();
  // Second Wind fires once and only once.
  Upgrades.take('secondWind');
  while (Game.aydins.length > 2) Game.aydins.pop();
  Game._checkSecondWind();
  const afterFirst = Game.aydins.length;
  check('second wind revives the herd once',
        afterFirst === 2 + CFG.upgrades.secondWind.revive,
        'herd ' + afterFirst);
  while (Game.aydins.length > 2) Game.aydins.pop();
  Game._checkSecondWind();
  check('second wind cannot fire twice in a run', Game.aydins.length === 2,
        'herd ' + Game.aydins.length);
}

{
  newRun();
  // Every tool must be castable without throwing. Firing each one directly is
  // the only way to be sure a switch case has no typo in it -- a broken tool
  // would otherwise only surface when it happened to come up as a card.
  let threw = [];
  for (const u of Upgrades.list) {
    if (u.kind !== 'tool') continue;
    try {
      newRun();
      Upgrades.take(u.id);
      const t = Tools.active.filter((x) => x.id === u.id)[0];
      if (!t) { threw.push(u.id + '(inactive)'); continue; }
      for (let i = 0; i < 60 * 30; i++) Game.update(1 / 60);
    } catch (e) {
      threw.push(u.id + ': ' + e.message);
    }
  }
  check('every tool runs for 30s without throwing', threw.length === 0,
        threw.join(', '));
}

{
  // A gohid held in place and catching nothing must still get bored. Boredom
  // removes most of the gohids a run ever creates, so if a status effect
  // pauses it, every stun and root quietly makes the board WORSE -- which is
  // exactly what happened: Flashbang measured at -19% score against a
  // no-upgrade baseline before this was fixed.
  newRun();
  const c = Game.commander;
  Game.gohids.length = 0;
  for (let i = 0; i < CFG.gohid.boredom.minGohids + 6; i++) {
    Game.gohids.push(new GohidClass(c.x + 900 + i * 12, c.y + 900));
  }
  const watched = Game.gohids[0];
  const step = 1 / 60;
  for (let i = 0; i < 60 * (CFG.gohid.boredom.time + 3); i++) {
    watched.applyRoot(0.5);        // keep it pinned for the whole window
    Game.update(step);
    if (Game.state !== 'playing') break;
  }
  check('a rooted gohid still gets bored and leaves',
        watched.leaving || !watched.alive,
        'sinceCatch ' + watched.sinceCatch.toFixed(1) + 's');
}

console.log('\n-- the spiral ----------------------------------------------');

newRun();
{
  const before = Game.gohids.length;
  const a = Game.aydins[0];
  const g = Game.gohids[0];
  // Put a gohid on top of an aydin and let the grab land.
  a.invuln = 0;
  g.x = a.x; g.y = a.y; g.grabCd = 0;
  const herdBefore = Game.aydins.length;
  run(0.05);
  check('a capture removes an aydin', Game.aydins.length < herdBefore,
        herdBefore + ' -> ' + Game.aydins.length);
  check('a capture queues a new gohid after a telegraph',
        Game.pending.length > 0 || Game.gohids.length > before);
  const pendingAt = Game.pending.length;
  run(CFG.gohid.spawnTelegraph + 0.2);
  check('the telegraphed gohid actually arrives',
        Game.gohids.length > before, before + ' -> ' + Game.gohids.length);
  check('telegraph delay is honoured', pendingAt > 0);
}

console.log('\n-- invulnerability -----------------------------------------');

newRun();
{
  Game.recruit();
  const fresh = Game.aydins[Game.aydins.length - 1];
  const g = Game.gohids[0];
  g.x = fresh.x; g.y = fresh.y; g.grabCd = 0;
  run(0.05);
  check('a newly recruited aydin cannot be taken', fresh.alive);
}

console.log('\n-- grid vs brute force -------------------------------------');

newRun();
{
  run(20);
  // The grid is an optimisation, so it must agree with the naive answer.
  let mismatches = 0;
  for (const g of Game.gohids) {
    const viaGrid = Game.aydinGrid.nearest(g.x, g.y, 3000, (a) => a.alive && a.invuln <= 0);
    let best = null, bestD = Infinity;
    for (const a of Game.aydins) {
      if (!a.alive || a.invuln > 0) continue;
      const d = Math.hypot(a.x - g.x, a.y - g.y);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (viaGrid !== best) mismatches++;
  }
  check('spatial grid nearest() agrees with brute force',
        mismatches === 0, mismatches + ' mismatches over ' + Game.gohids.length + ' gohids');
}

console.log('\n-- world bounds --------------------------------------------');

newRun();
{
  Input.mx = -1; Input.my = -1;
  run(30);
  const c = Game.commander;
  const inside = c.x >= CFG.world.edgePad - 0.5 && c.y >= CFG.world.edgePad - 0.5;
  check('commander is held inside the world', inside,
        c.x.toFixed(0) + ',' + c.y.toFixed(0));
  let out = 0;
  for (const a of Game.aydins) {
    if (a.x < 0 || a.x > CFG.world.width || a.y < 0 || a.y > CFG.world.height) out++;
  }
  check('no aydin escapes the world', out === 0, out + ' outside');
}

console.log('\n-- death ---------------------------------------------------');

newRun();
{
  Game.aydins.length = 0;
  run(1 / 60);
  check('losing the last aydin ends the run', Game.state === 'dead', Game.state);
}

/* ------------------------------------------------------------ balance sweep */

if (QUIET) console.log = _log;

if (process.argv.includes('--balance')) {
  console.log('\n-- balance -------------------------------------------------');
  console.log('  Idle player: no input at all. This is the floor -- if an idle');
  console.log('  run survives comfortably, the game has no pressure.\n');

  /* Shared steering: run from the weighted centre of nearby gohids and drift
   * back toward the middle of the map when clear. Returns the threat level so
   * each profile can decide its own rally policy off the same information. */
  function steer() {
    const c = Game.commander;
    let fx = 0, fy = 0, threat = 0;
    for (const g of Game.gohids) {
      const dx = c.x - g.x, dy = c.y - g.y;
      const d = Math.hypot(dx, dy);
      if (d > 620 || d === 0) continue;
      const w = 1 - d / 620;
      fx += (dx / d) * w; fy += (dy / d) * w;
      if (w > threat) threat = w;
    }
    fx += (CFG.world.width / 2 - c.x) / (CFG.world.width / 2) * 0.9;
    fy += (CFG.world.height / 2 - c.y) / (CFG.world.height / 2) * 0.9;
    const l = Math.hypot(fx, fy) || 1;
    Input.mx = fx / l; Input.my = fy / l;
    return threat;
  }

  const profiles = {
    idle:   () => { Input.mx = 0; Input.my = 0; Input.rally = false; },
    // A model of skilled play: steer away from the weighted centre of nearby
    // gohids, drift back toward the middle of the map when clear, and pulse
    // rally only while actually threatened. If this profile does not clearly
    // outperform `idle`, then skill is not being rewarded and the two verbs
    // are not carrying the game -- which is the single most important thing
    // to know about step 1.
    // Three ways of using the rally button, against identical pressure. The
    // design claims pulsing is the skilled play and that holding gets you
    // surrounded; these profiles are how that claim gets checked rather than
    // assumed. Steering is identical in all three -- only the rally policy
    // differs, so any gap between them is the button, not the driving.
    never:  (t) => { steer(); Input.rally = false; },
    holder: (t) => { const th = steer(); Input.rally = th > 0.25 && th < 0.72; },
    pulser: (t) => {
      const th = steer();
      // Tighten only when something is genuinely closing, and in short bursts:
      // on for ~0.5s, off for ~0.7s, so the herd never sits still and bunched.
      Input.rally = th > 0.42 && (t % 1.2) < 0.5;
    },
  };

  /* --repeat N averages the endpoint across N runs. A single run swings by
   * tens of aydins on luck alone, so comparing two rally policies on one run
   * each compares noise. */
  const repeatIdx = process.argv.indexOf('--repeat');
  const REPEAT = repeatIdx >= 0 ? Math.max(1, Number(process.argv[repeatIdx + 1])) : 1;
  const horizon = (() => {
    const i = process.argv.indexOf('--minutes');
    return i >= 0 ? Math.round(Number(process.argv[i + 1]) * 60) : 300;
  })();
  const step = 1 / 60;

  if (REPEAT > 1) {
    console.log('  ' + REPEAT + ' runs per profile, ' + (horizon / 60)
                + ' simulated minutes each. Mean of the final state.\n');
    console.log('    profile     aydins   gohids     score    deaths');
    for (const [name, drive] of Object.entries(profiles)) {
      let sa = 0, sg = 0, ss = 0, deaths = 0;
      for (let r = 0; r < REPEAT; r++) {
        newRun();
        let t = 0;
        while (t < horizon && Game.state === 'playing') {
          drive(t); Game.update(step); t += step;
        }
        if (Game.state !== 'playing') deaths++;
        sa += Game.aydins.length; sg += Game.gohids.length; ss += Game.score;
      }
      console.log('   ' + name.padEnd(10)
        + String(Math.round(sa / REPEAT)).padStart(8)
        + String(Math.round(sg / REPEAT)).padStart(9)
        + String(Math.round(ss / REPEAT)).padStart(10)
        + String(deaths).padStart(10));
    }
    console.log('');
  } else
  for (const [name, drive] of Object.entries(profiles)) {
    newRun();
    console.log('  ' + name);
    console.log('    time   aydins  gohids   score   lost  created  banished');
    const step = 1 / 60;
    let t = 0;
    const horizon = (() => {
      const i = process.argv.indexOf('--minutes');
      return i >= 0 ? Math.round(Number(process.argv[i + 1]) * 60) : 300;
    })();
    const stride = Math.max(30, Math.round(horizon / 10 / 30) * 30);
    for (let mark = stride; mark <= horizon; mark += stride) {
      while (t < mark) {
        drive(t);
        Game.update(step);
        t += step;
        if (Game.state !== 'playing') break;
      }
      const row = [
        String(mark).padStart(6),
        String(Game.aydins.length).padStart(8),
        String(Game.gohids.length).padStart(8),
        String(Math.round(Game.score)).padStart(8),
        String(Game.stats.lost).padStart(7),
        String(Game.stats.created).padStart(9),
        String(Game.stats.banished).padStart(10),
      ].join('');
      console.log('   ' + row + (Game.state !== 'playing' ? '   DEAD' : ''));
      if (Game.state !== 'playing') break;
    }
    console.log('');
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
