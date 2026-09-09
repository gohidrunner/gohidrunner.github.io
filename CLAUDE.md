# Run From Gohid — working notes

Browser game. Top-down pixel art, open map. You are the **Commander** of a herd
of **Aydins**; **Gohids** hunt them. Every living aydin scores every second, and
every aydin caught becomes another gohid. The herd is the score and the bomb.

**No build step.** `index.html` opens straight off the disk — plain
`<script src>` tags, no bundler, no npm.

Current state: **build step 1 complete** (commander + flock + gohids + capture +
spiral + score). Steps 2–7 not started.

---

## Running it

```bash
python -m http.server 8765     # then open http://localhost:8765
```

Opening `index.html` directly from the filesystem also works — see *Why sprites
are base64* below for why that needed doing deliberately.

```bash
node tools/headless.js                    # 24 assertions, no browser
node tools/headless.js --balance          # balance table over 5 simulated min
node tools/headless.js --balance --minutes 12 --repeat 8
node tools/headless.js --balance --set recruit.intervalMin=0.9
python gen_assets.py                      # regenerate sprites + js/assets.js
```

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
| `js/sprites.js` | Load, pixel-normalise, tint, cache, fallbacks | CFG, utils |
| `js/audio.js` | Procedural WebAudio, one method per event | CFG |
| `js/particles.js` | Fixed-size square-particle pool | CFG, utils |
| `js/input.js` | Keyboard + floating touch stick → `mx/my` + `rally` | CFG, audio |
| `js/entities.js` | `Commander`, `Aydin`, `Gohid` | all of the above |
| `js/game.js` | World state, update order, capture, spawning | entities, grid |
| `js/render.js` | Camera, culled floor, depth-sorted sprites, overlays | game, sprites |
| `js/hud.js` | DOM HUD, written in place | game |
| `js/main.js` | Boot, canvas sizing, frame loop, screens | everything — last |

`config.js` depends on nothing so that rebalancing never means opening a logic
file. `main.js` is last because it boots everything.

`tools/headless.js` loads config/utils/spatial/particles/entities/game into a
`vm` sandbox and stubs only audio and input. It runs the *real* game code, so a
passing suite means the browser is running the same logic.

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
edges, which is very visible on a 32px sprite. `sprites.js` blends only where
alpha > 0 and caches per colour. One sprite per creature, recoloured at runtime.

**Why sprites are base64 (`js/assets.js`).** A `file://` page that draws a PNG
into a canvas *taints* it, and a tainted canvas throws on `getImageData` — the
one call every tint depends on. Loading from a data URI keeps the canvas clean,
so the game genuinely opens off the disk with no server. The PNGs in `assets/`
stay the source of truth; **re-run `python gen_assets.py` after editing any of
them** or the change will not appear.

**`gohid.png` is reused from the disserhugger project** — it was the player
sprite there, and the same face being the thing you flee from here is the joke.
It is a photo, so it is cropped to the face (`CFG.assets.gohidCrop`) and
area-averaged down to 32px, then drawn with smoothing off. Nearest-neighbour
subsampling a photo straight to 32px turns a face into noise; averaging first
and hard-scaling on draw is what makes it read as pixel art.

**HUD nodes are written in place.** Never `innerHTML` during a frame, and values
are compared before writing so a steady herd count does not dirty the DOM 60
times a second.

**Defensive measures in `main.js`** — each for a failure that only appears on
real devices: the frame body is wrapped in `try/catch` (an uncaught throw inside
`requestAnimationFrame` kills the loop *permanently*); canvas size is **polled**,
not listened for (mobile browsers resize the visual viewport without reliably
firing `resize`); `contextlost`/`contextrestored` are handled; DPR is capped at
1.5 on touch.

---

## Bug log

**Rally did nothing in the only situation anyone presses it.** *(fixed)*
The spec says panicking aydins ignore cohesion — correct, and that is how a herd
tears apart. But a threatened herd is panicking *by definition*, so pure flee
meant rally was a dead button exactly when reached for. Measured live: 33 of 63
aydins panicking, 36 beyond 1000px, and pressing rally made average spread
*worse* (692px → 999px). Fixed with `flock.rallyPanicCohesion` (0.75): rallied
aydins still break around a gohid but head home while doing it. Rallied aydins
also now get the snappier rally responsiveness — previously excluded while
panicking, which undid most of the blend.

**Scatter chained into a permanent state.** *(fixed)*
`commander.touchCooldown` was 1.0s while `aydin.scatter.duration` was 1.5s, so a
second touch landed while the herd was still scattering and the scatters
overlapped end to end. Once gohids were dense enough to touch you every second,
the herd sat permanently in outward-flee, which overrides cohesion *and* rally —
a spiral with no counterplay. Measured at 59% of frames scattered with ~35
gohids, and 100% under constant contact. Cooldown raised to 2.4s.
**Invariant: `touchCooldown` must exceed `scatter.duration`,** asserted in the
test suite.

**Rally was all cost and no benefit.** *(partly fixed — see open questions)*
The spec says rally means "almost nothing gets caught", but only the tightening
was implemented — so rally cost 25% speed *and* packed the herd into a dense,
easier-to-grab blob. The balance harness showed never touching the button beat
using it. Added `rally.captureResist` (0.85) for aydins inside
`rallyRadius * protectRadiusMul`. The costs stay exactly as designed; this is
the benefit they are paid for. Stragglers outside the ball are still lost, which
keeps rally a timing decision rather than a toggle.

**Canvas painted only part of itself at DPR > 1.** *(fixed)*
`Render.draw` reset the transform to the identity and then filled `w * h` CSS
pixels onto a `(w*dpr) * (h*dpr)` backing store, leaving unpainted black bands
down the right and bottom edges. Completely invisible on desktop at DPR 1,
which is exactly why it took emulating a phone to see it — the touch cap makes
DPR 1.5 there. `Render.draw` now re-applies the DPR scale (`Render.dpr`, set by
`Main.resize`) instead of resetting to identity.

**Mobile control hint read "/ arrows to move . to rally".** *(fixed)*
The coarse-pointer media query hid `.hint b`, which removed the bold words but
left the punctuation between them. The desktop and touch hints are now separate
spans that swap as whole units.

**Two tests that lied, worth remembering as a pattern:**
- The scatter test counted frames *after the herd was wiped out*. `Game.update`
  returns early when dead, so `scatterTimer` froze at its last value and every
  later frame counted as scattered — it reported 97% while measuring a corpse.
  It now breaks out on death and never counts dead frames.
- "Commander is stationary with no input" originally passed via an `||` escape
  hatch whenever a scatter occurred, so it asserted nothing. Gohids now get
  removed to isolate the case, with a separate test for the knockback path.

**Not a bug:** the commander visibly drifting with no input. Gohids walk into a
stationary commander and each knockback shifts him ~43px; over a few idle
minutes that looks exactly like a movement bug. It is the mechanic working.

**Also not a bug:** the game appearing frozen in an automated browser pane. A
hidden pane pauses `requestAnimationFrame`. Drive `Game.update` directly to
inspect a running state.

---

## Deviations from the spec, flagged for review

**Ambient gohid spawns were added** (`CFG.gohid.ambient`). The spec creates
gohids *only* from captures, which means a player who never loses an aydin faces
the two they started with for the entire run and there is no pressure curve at
all. A slow trickle from the map edge supplies a baseline; captures still
accelerate it far faster. Set `ambient.interval` very high to return to pure
capture-driven spawning.

**Open design question: rally still does not pay for itself at scale.**
Even after adding `captureResist`, a 48-run sweep (12 runs x 4 rally policies,
5 simulated minutes) says never touching the button is the strongest play:

| policy | aydins | gohids | score |
|---|---|---|---|
| never rally | 99 | 83 | 22195 |
| pulse when threatened | 80 | 74 | 17870 |
| idle (no input at all) | 81 | 87 | 17591 |
| hold whenever threatened | 26 | 74 | 9552 |

The cause is geometric, not a tuning slip. Protection covers
`cohesionRadiusRally * protectRadiusMul` = **122px**, but a herd needs roughly
`sqrt(n * sep^2 * sqrt(3)/2 / pi)` to physically pack at its separation
distance — 137px at 100 aydins, 193px at 200. So past ~80 aydins the ball
cannot fit inside its own protection: at 150 aydins 47% of the herd is outside
it, at 200 aydins 60% — while the 25% speed cost applies to 100% of the time.
Rally is therefore strong early and strictly bad late, which is exactly
inverted from being the skill ceiling.

The likely fix is to scale the rally radius with herd size (a ball has to be
big enough to hold the herd) rather than holding it at a flat 90. That changes
a number the spec states explicitly, so it is left for a design decision.

**Open balance question: the run may not be losable.** With the spec's numbers,
12 simulated minutes of *zero input* never reaches an empty herd. The recruit
floor (`recruit.intervalMin` 0.45s ≈ 2.2 aydins/sec) regenerates faster than any
capture rate, and boredom removes ~90% of the gohids ever created, capping the
threat. Raising `recruit.intervalMin` to ~0.9 and `boredom.minGohids` to ~24
makes idle play visibly lose ground. Left at the spec's values pending a
decision — this is a design call, not an implementation detail.

---

## Build order

1. ~~Commander + flock + gohids + capture + spiral + score~~ **done**
2. HUD and minimap — *HUD exists (counts, score, timer, rally pill); minimap not started*
3. Levelling, passives, tools
4. Character aydins and gohid variants
5. Chests, pickups, events, arenas, modifiers
6. Achievements, collection, results — *results screen exists in basic form*
7. Polish: audio, particles, banners, mobile — *core audio and particles exist;
   floating touch stick implemented but **not yet tested on a real phone***

`Game.mods` already exists as the multiplier bag that upgrades, modifiers and
events will write into, so those systems never have to touch movement code.

## Still untested

- **A real phone.** Touch controls and the mobile viewport issues are written
  for but unverified on hardware.
- Audio has not been listened to — it is synthesised blind.
