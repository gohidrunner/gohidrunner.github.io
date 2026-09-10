/* Per-tool impact: run an identical scripted player with exactly one tool
 * maxed, and compare against the same player with nothing. Anything scoring
 * BELOW the baseline is actively harmful, which for a roguelite upgrade is a
 * bug rather than a balance nudge. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

function load() {
  const sb = { console, Math, Date, JSON, performance: { now: () => Date.now() } };
  sb.window = sb; sb.globalThis = sb;
  sb.Audio2 = new Proxy({}, { get: () => () => {} });
  sb.Render = { w: 1280, h: 720, zoom: 1 };
  sb.Sprites = { tinted: () => null, silhouette: () => null, base: {} };
  sb.UI = { paused: false, banner() {}, clearBanners() {}, show() {}, hide() {},
            showChest() {}, showLevelUp() {} };
  sb.Input = { mx: 0, my: 0, rally: false, keys: {}, stick: { active: false },
               rallyTouchId: null, update() {},
               consumeRallyPressed() { return false },
               consumeRallyReleased() { return false } };
  vm.createContext(sb);
  for (const f of ['js/config.js', 'js/utils.js', 'js/spatial.js', 'js/particles.js',
                   'js/entities.js', 'js/upgrades.js', 'js/tools.js', 'js/game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  }
  const { CFG, Game } = vm.runInContext('({CFG,Game})', sb);
  const Upgrades = vm.runInContext('Upgrades', sb);
  Upgrades.init();
  return { CFG, Game, Upgrades, Input: sb.Input };
}

function runOnce(grantId, seconds) {
  const { CFG, Game, Upgrades, Input } = load();
  Game.init(); Game.state = 'playing'; Game.reset();
  if (grantId) for (let i = 0; i < 5; i++) Upgrades.take(grantId);
  const step = 1 / 60;
  let t = 0;
  for (let i = 0; i < 60 * seconds; i++) {
    const c = Game.commander;
    let fx = 0, fy = 0, th = 0;
    for (const g of Game.gohids) {
      const dx = c.x - g.x, dy = c.y - g.y, d = Math.hypot(dx, dy);
      if (d > 620 || d === 0) continue;
      const w = 1 - d / 620; fx += dx / d * w; fy += dy / d * w;
      if (w > th) th = w;
    }
    fx += (CFG.world.width / 2 - c.x) / (CFG.world.width / 2) * 0.55;
    fy += (CFG.world.height / 2 - c.y) / (CFG.world.height / 2) * 0.55;
    const l = Math.hypot(fx, fy) || 1;
    Input.mx = fx / l; Input.my = fy / l;
    Input.rally = th > 0.42 && (t % 1.2) < 0.5;
    Game.update(step); t += step;
    if (Game.state !== 'playing') break;
  }
  return { score: Game.score, aydins: Game.aydins.length, gohids: Game.gohids.length };
}

function avg(grantId, runs, seconds) {
  let s = 0, a = 0;
  for (let i = 0; i < runs; i++) {
    const r = runOnce(grantId, seconds);
    s += r.score; a += r.aydins;
  }
  return { score: s / runs, aydins: a / runs };
}

const RUNS = Number(process.argv[2] || 5);
const SECS = Number(process.argv[3] || 150);

const base = avg(null, RUNS, SECS);
console.log('baseline (no upgrades):  score ' + Math.round(base.score)
            + '   herd ' + base.aydins.toFixed(0) + '\n');

const { Upgrades } = load();
const rows = [];
for (const u of Upgrades.list) {
  const r = avg(u.id, RUNS, SECS);
  rows.push({ id: u.id, kind: u.kind, score: r.score, aydins: r.aydins,
              delta: (r.score - base.score) / base.score });
}
rows.sort((a, b) => a.delta - b.delta);
console.log('  upgrade          kind      score   herd    vs baseline');
for (const r of rows) {
  const pctv = (r.delta * 100);
  const flag = pctv < -8 ? '   <-- HARMFUL' : '';
  console.log('  ' + r.id.padEnd(16) + r.kind.padEnd(9)
    + String(Math.round(r.score)).padStart(7)
    + String(Math.round(r.aydins)).padStart(7)
    + (pctv >= 0 ? '   +' : '   ') + pctv.toFixed(1) + '%' + flag);
}
