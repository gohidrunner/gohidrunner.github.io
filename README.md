# Run From Gohid

Top-down pixel-art herding game. You are the **Commander** of a herd of
**Aydins**; **Gohids** hunt them. Every living aydin scores every second, and
every aydin caught becomes another gohid — so the herd is both your score and
your bomb.

**No build step.** Plain `<script src>` tags, no bundler, no npm.

---

## Playing it

**WASD / arrows** to move, **hold Space** to rally.
On a phone: drag anywhere to move, hold the bottom-right to rally.

Open `index.html` straight off the disk, or serve it:

```bash
python tools/serve.py 8765
```

Use `tools/serve.py` rather than `python -m http.server`: it sends `no-store`
(so an edited file is never served stale) and it is threaded (the music streams
several megabytes over long-lived connections, which block a single-threaded
server and hang the whole page).

---

## Hosting on GitHub Pages

The game is fully static and every path in it is relative, so it works as a
**user site** (`you.github.io`) or a **project site**
(`you.github.io/gohidrunner/`) with no changes. Both were tested.

```bash
git remote add origin https://github.com/<you>/gohidrunner.git
git push -u origin master
```

Then in the repository: **Settings → Pages → Build and deployment → Deploy from
a branch**, branch `master`, folder `/ (root)`. The site appears at
`https://<you>.github.io/gohidrunner/` within a minute or two.

Things that are already handled, and are easy to break:

- **`.nojekyll`** is committed. Without it GitHub runs the files through Jekyll,
  which silently ignores anything beginning with an underscore.
- **All paths are relative.** A single leading `/` would work on a user site and
  break on a project site.
- **Case matters.** GitHub Pages is case-sensitive; Windows is not, so a
  mismatch works locally and 404s once deployed.
- **Music files are files, not base64.** ~6 MB total, well within limits.
- Sprites and the font *are* base64, so the game also works from `file://` —
  see CLAUDE.md for why that was necessary.

---

## Regenerating assets

```bash
python gen_assets.py     # re-embed sprites into js/assets.js
python gen_font.py       # rebuild the pixel font and css/font.css
```

`assets/gohid.png` and `assets/aydin.png` are photographs. `gen_assets.py` only
*draws* assets that are missing — pass `--force` only if you really mean to
overwrite them. **Re-run `gen_assets.py` after editing any sprite**, or the
change will not appear: the game prefers the embedded copy.

---

## Tests

```bash
node tools/headless.js              # 118 assertions, no browser
node tools/headless.js --balance    # balance table over simulated minutes
node tools/tooltest.js 10 110       # per-upgrade worth vs a no-upgrade run
```

The harness loads the real game files into a `vm` sandbox and stubs only the
browser, so a passing suite means the browser is running the same logic.

`CLAUDE.md` carries the architecture, the decisions worth not re-litigating,
and an honest log of what broke and why.
