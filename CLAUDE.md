# Run From Gohid — working notes

Browser game. Top-down pixel art, open map. You are the **Commander** of a herd
of **Aydins**; **Gohids** hunt them. Every living aydin scores every second, and
every aydin caught becomes another gohid. The herd is the score and the bomb.

**No build step.** `index.html` opens straight off the disk — plain
`<script src>` tags, no bundler, no npm.

Current state: **feature-complete and playable.** Core loop, UI, music,
levelling/passives/tools, character aydins + gohid variants,
events/pickups/chests/modifiers, arenas + achievements + collection, mobile,
and GitHub Pages hosting. The step 7 cosmetic polish pass was dropped by
request.

---

## Running it

```bash
python tools/serve.py 8765      # then open http://localhost:8765
```

Use `tools/serve.py`, **not** `python -m http.server` — see *The stale cache*
in the bug log. Opening `index.html` straight off the filesystem also works;
see *Why sprites and the font are base64*.

```bash
node tools/headless.js                    # 118 assertions, no browser
node tools/headless.js --no-upgrades      # model a player who never levels
node tools/headless.js --balance          # balance table over 5 simulated min
node tools/headless.js --balance --minutes 12 --repeat 8
node tools/headless.js --balance --set recruit.intervalMin=0.9
node tools/tooltest.js 10 110             # per-upgrade worth vs a no-upgrade run
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
| `js/music.js` | Background tracks. HTMLAudio, **not** WebAudio | CFG, save |
| `js/input.js` | Keyboard + floating touch stick → `mx/my` + `rally` | CFG, audio |
| `js/entities.js` | `Commander`, `Aydin`, `Gohid` | all of the above |
| `js/upgrades.js` | The shared passive+tool level map, buffs, evolutions | entities |
| `js/tools.js` | Auto-firing tools, world zones, escorts | upgrades |
| `js/variants.js` | Gohid kinds: data plus one behaviour switch | entities |
| `js/characters.js` | The named aydins and their abilities | entities, tools |
| `js/events.js` | Timed events and the per-run modifier — data, not pushes | CFG |
| `js/pickups.js` | Ground items and chests | upgrades, tools |
| `js/arenas.js` | The five maps: palette plus one twist each | CFG, save |
| `js/achievements.js` | Persisted trophies, mostly config thresholds | save, game |
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

**One registry for passives AND tools** (`js/upgrades.js`). They differ only
by a `kind` field, so the card modal, Collection screen, level pips and
evolution check never branch on which sort of thing they hold.

**The buffs bag is rebuilt from scratch, never incremented.** Upgrades, per-run
modifiers and timed events all want to scale the same handful of numbers. If
each wrote a delta into the live value they could not be removed
independently, and an event that ended would leave its multiplier behind
forever. Rebuilding is O(upgrades taken), runs once per level-up, and cannot
drift — there is a test for its idempotence.

**Character abilities PULL, they do not push.** Nothing in `characters.js`
reaches into the game loop to change a number. Each ability either runs on its
own timer or exposes a query the relevant system calls at its own point of use
— `cohesionMul()`, `expMul()`, `consumeShield()`, `tryRecover()`. That keeps a
character's effect removable the instant it dies with no state to unwind, which
is the same problem the buffs bag solves for upgrades.

**A character aydin is an ordinary `Aydin` with a `character` field.** It
flocks, panics and dies exactly like the rest of the herd — that is the point.
The player protects something specific that behaves just like the crowd it is
hiding in. It gets a tint, a badge and a HUD portrait, nothing else.

**A gohid variant is DATA plus at most one case in `Variants.behave()`.** Same
sprite, runtime tint, badge glyph. Badges are not decoration: at 44px several
of the variant tints sit close together, and a colourblind player has nothing
else to distinguish a runner from a herder.

**Everything that removes a gohid goes through `Game.banishGohid()`,** so the
splitter's parting gift cannot be forgotten by a future caller. The Warden and
Honour Guard both route through it.

**Music is HTMLAudio, not WebAudio, and that is deliberate.** `decodeAudioData`
needs the file fetched first and `fetch` is blocked on a `file://` page; and
routing an `<audio>` element through `createMediaElementSource` taints the
graph for a `file://` source and can output silence. So crossfades move
`.volume` on a timer. Music files stay as FILES rather than base64 — sprites
and the font are inlined so the page can read their *pixels*, but music only
needs playing, and inlining 5MB would mean parsing 6.7MB of base64 before the
first frame.

**Events never push; systems pull.** An event is data: a duration, a bag of
multipliers, and some flags. The scheduler only starts and stops them and asks
the game to refold. Multipliers fold in `Game.recomputeMods()`; anything that
is not a multiplier is a FLAG asked for at the point of use —
`Events.flag('silence')` in the gohid update, `Events.flag('thinIce')` in the
capture path. Two overlapping events therefore expire independently with no
bookkeeping.

**Any call that clears state must leave the folded multipliers consistent.**
`Game.reset()` and `Events.reset()` both call `Game.recomputeMods()` for this
reason. Skipping it leaves `Game.mods` holding a previous run's values, which
is invisible until something reads a speed that is quietly 20% wrong. It
produced a 1-in-5 test flake before both were fixed.

**An arena is data with the same shape as an event.** Its twist is expressed as
`mods` / `vision` / flags, so it folds through `Game.recomputeMods()` and
`Events.visionRadius()` with no arena-specific plumbing in the game loop. Only
two need real behaviour: Ruins pushes entities out of its walls, and Frozen
Lake accelerates the commander instead of setting his velocity. Walls are
generated from the run rather than stored.

**Where two vision limits meet, the tighter wins.** Fog inside the Night Forest
must not come out as a relief because the two cancelled.

**Most achievements are a config line** — `stat` names a field on `Game.stats`,
`min` is the bar. Only the handful that cannot be said that way get a `test`
function. They are checked once a second, not per frame: twenty comparisons is
cheap but it is pure waste sixty times a second for conditions that move at
human speed.

**Every settings toggle must actually reach something.** Four of them --
screen shake, colourblind badges, performance mode and touch controls -- were
saved to the profile and read by nothing at all, so the settings screen was a
row of switches wired to air. `UI.applySettings()` is now the single place that
pushes stored settings into the systems that act on them, and it is called at
boot and after every change. If a setting is added, it goes there too.

**The minimap is sized off the SHORTER viewport dimension.** A width-only
breakpoint gave a landscape phone (812x375) the full desktop minimap, which ate
43% of the screen height. One rule against `min(w, h)` covers portrait,
landscape and desktop.

**Status effects refresh, they do not stack.** An aura calls `applySlow` every
frame it contains a gohid; adding durations would leave anything that walked
through a dust cloud slowed for the rest of the run.

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

**Stunning a gohid made the game HARDER.** *(fixed)*
`Gohid.update` returned early when stunned or rooted, and both the boredom
timer and the boredom CHECK sat below that return. Boredom removes the large
majority of gohids a run ever creates, so every stun, root and freeze quietly
suppressed the main way the board clears. Measured per-upgrade against a
no-upgrade baseline, Flashbang scored **-19%** — an upgrade that actively hurt
the player. Both the timer and the check now sit above the disabled gate, and
Flashbang measures **+12.7%**. There is a regression test, because nothing
about this was visible on screen: the tool looked like it was working.

**Beacon was worth three of anything else.** *(tuned)*
Recruit rate is the dominant lever in the whole economy, so a percentage buff
to it is worth far more than the same percentage anywhere else: at
`perLevel 0.14` it measured **+62%** against a field where the next best was
+22%. Reduced to 0.055, which lands it at +23.5%.

**Character aydins die about half the time, and the Hunter is not why.**
Measured over 3 runs of 4 minutes with the scripted player: **58%** of
characters lost with hunters enabled, **50%** with them disabled — the variant
that exists specifically to kill them contributes only 8 percentage points.
They mostly die because they are ordinary aydins in a dangerous crowd, which is
the intent. Worth re-checking if the loss rate ever looks wrong: the instinct
is to blame the Hunter, and the instinct is wrong.

**Two flakes with the same root cause, worth recognising on sight.** Both were
"a multiplier did not come back to where it started". Neither was a bug in the
event system: in both cases something had cleared state without refolding, so
the *baseline* the test captured was stale rather than the result being wrong.
If a mods-related test ever flakes again, suspect the baseline first.

**A canvas has no layers, so `destination-out` erases the scene.** The
limited-vision overlay filled the screen dark and punched a hole with
`destination-out`, which removed the GAME along with the overlay -- the hole
came out blacker than its surround. Masks like this must be built on an
offscreen canvas and drawn over the top. It shipped broken through two steps
because vision is used by exactly one arena and one 1-in-6 run modifier, and
neither had appeared in a screenshot.

**A dev server for this game must be threaded.** The `<audio>` elements hold
long-lived connections while streaming several megabytes of music, and a
single-threaded server hands them its only worker; every other request then
hangs and the page looks like a dead port. `tools/serve.py` uses
`ThreadingHTTPServer`.

### Measuring an upgrade's worth

`node tools/tooltest.js [runs] [seconds]` grants exactly one upgrade at max, runs a scripted
player, and compares against the same player with nothing. Two things make the
output trustworthy:

- **Fast Hands is a built-in control.** It only reduces tool cooldowns, and the
  test grants no tools, so its true effect is exactly zero. Whatever it
  measures is the noise floor — **±11% at 10 runs of 110s**. Only deltas above
  roughly 15% mean anything, and a "harmful" reading below that is noise. Two
  upgrades were nearly rebalanced on the strength of such a reading.
- Anything genuinely below the baseline is a bug, not a tuning nudge. A
  roguelite upgrade that loses you the run is broken by definition.

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

**Beacon's per-level value cut from 0.14 to 0.055** — see the bug log.

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
3. ~~Levelling, passives, tools~~ **done** — 18 passives, 15 tools, 5
   evolutions, all numbers in config. Measured net-positive: the same scripted
   player scores 13,948 with upgrades against 9,367 without, at half the losses
4. ~~Character aydins and gohid variants~~ **done** — 10 characters with one
   ability each, 8 variants unlocked by run time, all from the same sprite
5. ~~Events, pickups, chests, modifiers~~ **done** — 7 pickups, 3 chest tiers
   weighted by luck, 7 timed events, 6 per-run modifiers
6. ~~Arenas, achievements, collection~~ **done** — 5 arenas unlocked by
   lifetime score, 20 trophies with hidden ones, Collection lists owned
   passives, tools, characters and live Active Effects
7. ~~Polish~~ — cosmetic polish dropped by request. Mobile was done: floating
   stick, rally in the bottom-right corner, a TOOLS button standing in for the
   hidden tray, portrait/landscape layouts verified with no overlaps, and the
   camera zooms out on small viewports so the herd is readable.

`Game.mods` is the multiplier bag upgrades/modifiers/events write into, and
`Game.characters/effects/pickups/chests` are declared empty so the UI can
iterate them unconditionally. Adding those systems should be filling an array,
not teaching the UI a new shape. `Game.tools` now points at `Tools.active`.

Adding an upgrade is a table entry in `js/upgrades.js` plus its numbers in
`CFG.upgrades`. Adding a tool is a table entry, an icon, and one case in the
fire switch in `js/tools.js`.

## Still untested

- **A real phone.** Touch is verified by dispatching real TouchEvents through
  the true input path in emulated 375x812 and 812x375 viewports -- the floating
  stick, steering and the rally zone all respond -- but never on hardware.
- **Audio has never been listened to.** It is synthesised blind — every sound
  is plausible on paper and completely unverified by ear.
