# Run From Gohid — working notes

Browser game. Top-down pixel art, open map. You are the **Commander** of a herd
of **Aydins**; **Gohids** hunt them. Every living aydin scores every second, and
every aydin caught becomes another gohid. The herd is the score and the bomb.

**No build step.** `index.html` opens straight off the disk — plain
`<script src>` tags, no bundler, no npm.

Current state: **phase 1 (core loop) and the phase-2 UI pass are done.**
Progression, tools, character aydins, gohid variants, events, pickups, chests,
arenas and achievements are not built yet — the UI has their shells.

---

## Running it

```bash
python tools/serve.py 8765      # then open http://localhost:8765
```

Use `tools/serve.py`, **not** `python -m http.server` — see *The stale cache*
in the bug log. Opening `index.html` straight off the filesystem also works;
see *Why sprites and the font are base64*.

```bash
node tools/headless.js                    # 24 assertions, no browser
node tools/headless.js --balance          # balance table over 5 simulated min
node tools/headless.js --balance --minutes 12 --repeat 8
node tools/headless.js --balance --set recruit.intervalMin=0.9
python gen_assets.py                      # re-embed sprites into js/assets.js
python gen_font.py                        # rebuild the pixel font + css/font.css
```

`gen_assets.py` only DRAWS assets that are missing. Two of the three sprites
are hand-supplied photographs and an earlier version overwrote them
unconditionally; pass `--force` only if you really mean to redraw.

---

## Files, and why the load order is what it is

Scripts are plain classic scripts sharing one global scope. Order in
`index.html` is load-bearing — each file may only use what is already defined.

| File | Does | Depends on |
|---|---|---|
| `js/config.js` | **Every tunable number and asset path.** | nothing — deliberately |
| `js/assets.js` | GENERATED. Sprites as base64 data URIs. | nothing |
| `js/utils.js` | Maths, RNG, quantise, safe `localStorage`, formatting | CFG |
| `js/spatial.js` | Uniform grid for neighbour queries | utils |
| `js/sprites.js` | Load, normalise, tint, cache, procedural fallbacks | CFG, utils |
| `js/audio.js` | Procedural WebAudio, one method per event | CFG |
| `js/particles.js` | Fixed-size square-particle pool | CFG, utils |
| `js/save.js` | Persisted profile: best, lifetime, unlocks, settings | CFG, utils |
| `js/input.js` | Keyboard + floating touch stick → `mx/my` + `rally` | CFG, audio |
| `js/entities.js` | `Commander`, `Aydin`, `Gohid` | all of the above |
| `js/game.js` | World state, update order, capture, spawning, exp | entities, grid |
| `js/render.js` | Camera, zoom, culled floor, depth-sorted sprites | game, sprites |
| `js/minimap.js` | Its own canvas on its own clock | game, render |
| `js/ui.js` | Screens, modals, banners | game, save, hud |
| `js/hud.js` | Binds HUD nodes, writes them in place | game, sprites |
| `js/main.js` | Boot, canvas sizing, frame loop, death → results | everything — last |

`config.js` depends on nothing so that rebalancing never means opening a logic
file. `main.js` is last because it boots everything.

`tools/headless.js` loads config/utils/spatial/particles/entities/game into a
`vm` sandbox and stubs only audio, input and UI. It runs the *real* game code,
so a passing suite means the browser is running the same logic.

---

## Decisions worth not re-litigating

**Steering is `(desiredVelocity - currentVelocity) * responsiveness`,** not
accumulate-forces-then-damp. Force-and-damp has a terminal speed of
`force/damping`, so retuning any number silently changes top speed. The whole
game rests on one relationship — commander 300 > aydin 290 > gohid 250 — and it
has to survive rebalancing. `tools/headless.js` asserts that ordering.

**Spatial grid from day one.** Hundreds of aydins against dozens of gohids is
the core loop; all-pairs does not survive it. Queries fill caller-owned scratch
buffers and cells are emptied with `length = 0` — a GC hitch reads to the player
as exactly the stutter the grid exists to prevent. A test checks the grid's
`nearest()` against brute force, because a fast wrong answer is worse than a
slow right one.

**Tinting is hand-rolled, never canvas `filter`.** Filters fringe transparent
edges, very visible at this sprite size. `sprites.js` blends only where
alpha > 0 and caches per colour. One sprite per creature, recoloured at runtime.

**Each sprite's base canvas is built at the size it is DRAWN at**
(`CFG.<entity>.sprite`), not at one shared resolution. A single global
`pixelSize` forces a second resample at draw time — a 48px base drawn at 34px
is downscaled again with smoothing off, throwing away the detail the larger
base was for *and* making sprites shimmer while moving. Resampling also picks
its filter by direction: **average when shrinking** a photo, **nearest when
enlarging** pixel art. Getting that backwards is what made the 32px commander
look blurry at a 48px base.

**Why sprites and the font are base64.** A `file://` page that draws a PNG into
a canvas *taints* it, and a tainted canvas throws on `getImageData` — the one
call every tint depends on. Chrome separately blocks `@font-face` files over
`file://` as a CORS failure. Data URIs are same-origin, so both work with no
server. The PNGs in `assets/` stay the source of truth; **re-run
`python gen_assets.py` after editing any of them** or the change will not
appear.

**The font is generated, not downloaded** (`gen_font.py`). 95 glyphs from 5x7
bitmaps defined in the script, 1.9KB. No network dependency and no third-party
licence to carry.

**HUD nodes are written in place.** Never `innerHTML` during a frame, and
values are compared before writing so a steady herd count does not dirty the
DOM 60 times a second. The tool tray rebuilds only when the *set* of tools
changes; per frame only the cooldown sweep is touched.

**`UI.paused` is read by the game loop, not by each screen.** The failure mode
otherwise is a screen that dims the world while the herd keeps being eaten
behind it.

**The menu background is the real simulation** (`Game.attract()`) with an AI
commander, not a canned animation — so it always looks exactly like the game,
and costs one steering function rather than a separate renderer.

**Defensive measures in `main.js`** — each for a failure that only appears on
real devices: the frame body is wrapped in `try/catch` (an uncaught throw
inside `requestAnimationFrame` kills the loop *permanently*); canvas size is
**polled**, not listened for (mobile browsers resize the visual viewport
without reliably firing `resize`); `contextlost`/`contextrestored` are handled;
DPR is capped at 1.5 on touch.

---

## Bug log

**Rally did nothing in the only situation anyone presses it.** *(fixed)*
The spec says panicking aydins ignore cohesion — correct, and that is how a
herd tears apart. But a threatened herd is panicking *by definition*, so pure
flee meant rally was a dead button exactly when reached for. Measured live: 33
of 63 aydins panicking, 36 beyond 1000px, and pressing rally made average
spread *worse* (692px → 999px). Fixed with `flock.rallyPanicCohesion` (0.75).

**Scatter chained into a permanent state.** *(fixed)*
`commander.touchCooldown` was 1.0s while `aydin.scatter.duration` was 1.5s, so
scatters overlapped end to end and the herd sat permanently in outward-flee,
which overrides cohesion *and* rally. Measured at 59% of frames scattered with
~35 gohids, and 100% under constant contact. Cooldown raised to 2.4s.
**Invariant: `touchCooldown` must exceed `scatter.duration`,** asserted in the
suite.

**Rally was all cost and no benefit.** *(partly fixed — see open questions)*
Added `rally.captureResist` (0.85) inside `rallyRadius * protectRadiusMul`.

**Canvas painted only part of itself at DPR > 1.** *(fixed)*
`Render.draw` reset the transform to identity then filled `w*h` CSS pixels onto
a `(w*dpr)*(h*dpr)` backing store, leaving black bands right and bottom.
Invisible at DPR 1, which is why it took emulating a phone to see it.

**The gohid sprite was beheaded.** *(fixed)*
`CFG.assets.gohidCrop` was `[0.10, 0.02, 0.80, 0.72]`, read as `[x,y,w,h]`
fractions — it discarded 10% from each side and the entire bottom 28% of the
source. Now `null`. If a crop is ever wanted again it must come from the
image's own alpha bounding box, never hardcoded fractions.

**The game rendered art the repo no longer contained.** *(fixed)*
`assets/aydin.png` was replaced with a photograph, but `js/assets.js` still
held the previously generated sheep, and `sprites.js` prefers the embedded
copy. Everything looked fine and was wrong. Re-embedded from disk.

**The HUD stayed hidden for the whole run.** *(fixed)*
`UI.hide()` decides HUD visibility from `Game.state`, and `_verb('play')`
called it *before* `Game.start()` flipped the state — so it always evaluated
`'attract' === 'playing'` and hid the HUD. Start the run, then hide the screen.

**Gohids collapsed into a single stack of overlapping sprites.** *(fixed)*
`separationStrength` was 90 against a seek term pulling at the full speed of
250, so a pack converging on one straggler was outgunned ~3:1. Measured over
150s on a crowded board, counting gohid pairs closer than 20px:
`22/90 → 37 pairs`, `26/170 → 0`, `30/320 → 0 but reshapes the pack into a
dragnet`. Settled on 26/170, the smallest change that fixes it.

**A phone could see almost none of its own herd.** *(fixed)*
The camera rendered 1:1, so a 375px-wide viewport showed 375 world units
against a desktop's 1280 — **3 of 49 aydins were on screen**. The game is about
reading a crowd, so `CFG.display.minVisibleWorld`/`zoomMin` now zoom the camera
out on small viewports; the same measurement afterwards was 49 of 54. Zoom is
snapped to 1/20ths, because a continuously varying scale resamples every sprite
edge slightly differently and makes the whole scene crawl.

### Two traps that cost real time — read these before debugging in the browser

**The stale cache.** `python -m http.server` sends no cache directives, so the
browser reused `js/config.js` across full reloads *and* across a
`location.reload()`. A measurement taken against it produced a confident, wrong
conclusion about gohid separation — the numbers on screen came from code that
had already been edited. `tools/serve.py` now sends `no-store`. If a tab still
holds an old copy from before that change:

```js
const urls=[...document.querySelectorAll('script[src]')].map(s=>s.src)
  .concat([...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href));
await Promise.all(urls.map(u=>fetch(u,{cache:'reload'})));
location.reload();
```

**Always verify a config value in the page before trusting a measurement.**

**`Game.update()` calls `Input.update()`.** Setting `Input.mx/my` from a script
and then calling `Game.update()` does nothing — the first thing it does is
recompute `mx/my` from the real keyboard, which is empty. Scripted playtests
that did this were silently measuring an **idle** run, which looks like a
brutally hard game rather than a broken test. Neuter it for the duration:

```js
const real = Input.update; Input.update = function(){};
/* ... drive the sim ... */
Input.update = real;
```

**Two tests that lied, worth remembering as a pattern:**
- The scatter test counted frames *after the herd was wiped out*. `Game.update`
  returns early when dead, so `scatterTimer` froze and every later frame
  counted as scattered — it reported 97% while measuring a corpse.
- "Commander is stationary with no input" originally passed via an `||` escape
  hatch whenever a scatter occurred, so it asserted nothing.

**Not a bug:** the commander visibly drifting with no input. Gohids walk into a
stationary commander and each knockback shifts him ~43px. It is the mechanic.

**Also not a bug:** the game appearing frozen in an automated browser pane. A
hidden pane pauses `requestAnimationFrame`. Drive `Game.update` directly.

**Watch item:** one flaky test failure was seen once and never reproduced in 28
consecutive runs afterwards. Probably a race with an in-flight config rewrite
rather than a real flake, but worth remembering if it recurs.

---

## Deviations from the spec, flagged for review

**Exp curve base raised from 20 to 120.** The spec's `curveBase: 20` was
measured to give a level-up every **2.6–4.5 seconds** for the first ten levels —
a card modal that pauses the game every three seconds. Exp scales with herd
size (0.6/aydin/sec), so ~30 aydins already earn 18 exp/sec against a 20-exp
first level. Measured first-ten level-up times:

| base | level-ups at (s) | level by 5 min |
|---|---|---|
| 20 | 3, 5, 8, 11, 14, 17, 20, 24, 28, 32 | 29 |
| 60 | 7, 13, 18, 24, 30, 36, 43, 51, 59, 69 | 16 |
| **120** | **12, 21, 30, 39, 48, 57, 66, 78, 91, 106** | **14** |

120 gives a level every 9–18s and still reaches level 30 in a long run.

**Ambient gohid spawns were added** (`CFG.gohid.ambient`). The spec creates
gohids *only* from captures, which means a player who never loses an aydin
faces the two they started with for the entire run and there is no pressure
curve. Set `ambient.interval` very high to return to pure capture-driven
spawning.

**Camera zoom on small viewports** — not in the spec, but without it a phone
cannot see its own herd. See the bug log.

**Open design question: rally still does not pay for itself at scale.**
A 48-run sweep (12 runs x 4 rally policies, 5 simulated minutes) said never
touching the button is the strongest play. The cause is geometric: protection
covers `cohesionRadiusRally * protectRadiusMul` = **122px**, but a herd needs
roughly `sqrt(n * sep^2 * sqrt(3)/2 / pi)` to physically pack — 137px at 100
aydins, 193px at 200. Past ~80 aydins the ball cannot fit inside its own
protection (47% outside at 150, 60% at 200) while the 25% speed cost applies
100% of the time. Rally is strong early and strictly bad late — inverted from
being the skill ceiling. The likely fix is to scale the rally radius with herd
size, which changes a number the spec states explicitly, so it is a design
call.

**Open balance question: the run may not be losable.** With the spec's numbers,
12 simulated minutes of *zero input* never empties the herd. The recruit floor
(`recruit.intervalMin` 0.45s ≈ 2.2 aydins/sec) regenerates faster than any
capture rate, and boredom removes ~90% of the gohids ever created. Raising
`recruit.intervalMin` to ~0.9 and `boredom.minGohids` to ~24 makes idle play
visibly lose ground.

---

## Build order

1. ~~Commander + flock + gohids + capture + spiral + score~~ **done**
2. ~~UI pass: palette, font, HUD, minimap, menu, pause, results~~ **done**
3. Levelling, passives, tools — *exp and levels run; the 3-card modal renders
   from data but no upgrade tables exist yet, so `_levelUp` only banners*
4. Character aydins and gohid variants
5. Chests, pickups, events, arenas, modifiers
6. Achievements, collection, results — *results done; collection and trophies
   are shells reading from empty lists*
7. Polish: audio, particles, banners, mobile

`Game.mods` is the multiplier bag upgrades/modifiers/events write into, and
`Game.tools/characters/effects/pickups/chests` are declared empty so the UI can
iterate them unconditionally. Adding those systems should be filling an array,
not teaching the UI a new shape.

## Still untested

- **A real phone.** Touch controls and the mobile viewport are written for and
  verified only in an emulated 375x812 viewport, never on hardware.
- **Audio has never been listened to.** It is synthesised blind — every sound
  is plausible on paper and completely unverified by ear.
