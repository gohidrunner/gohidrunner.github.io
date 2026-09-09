#!/usr/bin/env python3
"""
gen_assets.py -- Run From Gohid sprite generator.

Writes 32x32 pixel-art PNGs next to itself (assets/ relative to THIS file,
not the shell's cwd) so it can be run from anywhere.

Sprites are authored from ImageDraw primitives at native 32x32 -- PIL does not
antialias, so every edge lands on a whole pixel. Outlines are derived
automatically by dilating the alpha mask, which keeps silhouettes consistent
between sprites and means editing a shape never means re-tracing its outline.

Bodies are deliberately light and low-saturation: every sprite is recoloured at
runtime by an alpha-safe tint, and a light base is the only thing that takes a
tint legibly.
"""

import base64
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
S = 32  # native sprite size
LF = chr(10)

# ---------------------------------------------------------------- palettes
AYDIN = {
    "outline": (58, 42, 34, 255),
    "wool_hi": (250, 243, 229, 255),
    "wool":    (231, 217, 193, 255),
    "wool_sh": (198, 180, 150, 255),
    "face":    (124, 94, 72, 255),
    "face_sh": (92, 68, 52, 255),
    "horn":    (198, 170, 120, 255),
    "horn_sh": (156, 130, 88, 255),
    "leg":     (92, 68, 52, 255),
    "eye":     (255, 255, 255, 255),
    "pupil":   (26, 18, 16, 255),
}

CMDR = {
    "outline": (26, 30, 42, 255),
    "cloak_hi": (86, 132, 160, 255),
    "cloak":    (58, 96, 122, 255),
    "cloak_sh": (38, 66, 88, 255),
    "skin":     (226, 178, 140, 255),
    "skin_sh":  (188, 142, 108, 255),
    "hat":      (44, 58, 86, 255),
    "hat_hi":   (62, 78, 110, 255),
    "staff":    (132, 96, 60, 255),
    "staff_hi": (168, 128, 84, 255),
    "sash":     (212, 148, 60, 255),
    "eye":      (26, 18, 16, 255),
}


def new_layer():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))


def add_outline(layer, colour):
    """Dilate the layer's alpha by 1px in 8 directions, keep only the ring."""
    alpha = layer.split()[3]
    grown = Image.new("L", (S, S), 0)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1),
                   (-1, -1), (1, -1), (-1, 1), (1, 1)):
        shifted = Image.new("L", (S, S), 0)
        shifted.paste(alpha, (dx, dy))
        grown = Image.composite(shifted, grown, shifted.point(lambda v: 255 if v > 128 else 0))
    ring = Image.new("RGBA", (S, S), colour)
    ring.putalpha(grown.point(lambda v: 255 if v > 128 else 0))
    out = Image.alpha_composite(ring, layer)
    return out


def make_aydin():
    """A stocky woolly herd animal, front-on, readable at 28px."""
    p = AYDIN
    l = new_layer()
    d = ImageDraw.Draw(l)

    # horns -- two short curved nubs, drawn before the head so the head overlaps
    for side in (-1, 1):
        cx = 16 + side * 4
        d.rectangle([cx - 1 + (0 if side < 0 else 0), 4, cx, 8], fill=p["horn"])
        d.rectangle([cx - 1 + side, 2, cx + side, 5], fill=p["horn"])
        d.point((cx + side, 2), fill=p["horn_sh"])

    # ears
    d.ellipse([5, 10, 12, 15], fill=p["wool_sh"])
    d.ellipse([19, 10, 26, 15], fill=p["wool_sh"])

    # woolly body -- an ellipse plus bumps along the top arc for a fluffy edge
    d.ellipse([2, 14, 29, 27], fill=p["wool"])
    for bx, by, br in ((4, 15, 4), (9, 12, 5), (22, 12, 5), (27, 15, 4),
                       (15, 12, 5), (6, 20, 4), (25, 20, 4)):
        d.ellipse([bx - br, by - br, bx + br, by + br], fill=p["wool"])
    # wool shading: lower band darker, upper-left highlight
    d.ellipse([4, 21, 28, 28], fill=p["wool_sh"])
    d.ellipse([5, 15, 14, 21], fill=p["wool_hi"])

    # head, in front of the wool
    d.ellipse([11, 7, 20, 18], fill=p["face"])
    d.ellipse([12, 13, 19, 19], fill=p["face_sh"])   # muzzle
    d.rectangle([13, 8, 18, 10], fill=p["face_sh"])  # brow

    # eyes -- 2x2 whites with a 1px pupil, kept off the mirror line
    for ex in (12, 17):
        d.rectangle([ex, 11, ex + 1, 12], fill=p["eye"])
        d.point((ex + (1 if ex == 12 else 0), 12), fill=p["pupil"])

    # legs
    for lx in (6, 12, 18, 24):
        d.rectangle([lx, 26, lx + 1, 30], fill=p["leg"])

    return add_outline(l, p["outline"])


def make_commander():
    """Taller cloaked figure with a staff -- silhouette must not read as a herd animal."""
    p = CMDR
    l = new_layer()
    d = ImageDraw.Draw(l)

    # staff, behind the body
    d.rectangle([24, 5, 25, 30], fill=p["staff"])
    d.rectangle([24, 5, 24, 30], fill=p["staff_hi"])
    d.ellipse([22, 2, 27, 7], fill=p["staff_hi"])
    d.ellipse([23, 3, 26, 6], fill=p["staff"])

    # cloak -- trapezoid from shoulders down to a wide hem
    d.polygon([(11, 13), (20, 13), (25, 29), (6, 29)], fill=p["cloak"])
    d.polygon([(11, 13), (15, 13), (13, 29), (6, 29)], fill=p["cloak_hi"])
    d.polygon([(19, 14), (20, 13), (25, 29), (21, 29)], fill=p["cloak_sh"])
    d.rectangle([6, 29, 25, 30], fill=p["cloak_sh"])   # hem

    # sash
    d.polygon([(11, 17), (20, 15), (20, 17), (11, 19)], fill=p["sash"])

    # head + hood
    d.ellipse([11, 4, 20, 14], fill=p["skin"])
    d.ellipse([11, 3, 20, 9], fill=p["hat"])          # hood brim
    d.rectangle([10, 8, 21, 9], fill=p["hat"])
    d.ellipse([12, 3, 18, 7], fill=p["hat_hi"])
    d.rectangle([18, 9, 20, 13], fill=p["skin_sh"])   # cheek shadow

    # eyes
    d.point((13, 11), fill=p["eye"])
    d.point((17, 11), fill=p["eye"])

    return add_outline(l, p["outline"])


def embed(names):
    """Write js/assets.js with every sprite inlined as a base64 data URI.

    This exists so index.html can be opened straight off the disk. Drawing a
    file:// image into a canvas taints it, and a tainted canvas throws on
    getImageData -- which is the one call every runtime tint depends on. A
    data: URI is same-origin, so the canvas stays clean and tinting works with
    no local server. The PNGs on disk remain the source of truth; re-run this
    script after editing any of them.
    """
    out = [
        "/* GENERATED BY gen_assets.py -- DO NOT EDIT BY HAND.",
        " * Sprites inlined as data URIs so file:// does not taint the canvas.",
        " * Re-run: python gen_assets.py */",
        "'use strict';",
        "const EMBEDDED = {",
    ]
    for name in names:
        path = os.path.join(ASSETS, name + ".png")
        if not os.path.exists(path):
            continue
        with open(path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        out.append("  " + name + ": 'data:image/png;base64," + b64 + "',")
    out.append("};")
    out.append("")
    dest = os.path.join(HERE, "js", "assets.js")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8", newline=LF) as fh:
        fh.write(LF.join(out))
    print("wrote", dest)


def preview(img, path, scale=8):
    img.resize((S * scale, S * scale), Image.NEAREST).save(path)


def main():
    """Generate only MISSING art, then always re-embed whatever is on disk.

    The drawn sprites here are fallbacks, not the source of truth. Two of the
    three assets are now hand-supplied photographs, and an earlier version of
    this script unconditionally overwrote aydin.png -- running it would have
    silently destroyed the real artwork. Existing files are therefore never
    touched without --force.
    """
    import sys
    force = "--force" in sys.argv
    os.makedirs(ASSETS, exist_ok=True)

    drawable = {"aydin.png": make_aydin, "commander.png": make_commander}
    for name, build in drawable.items():
        out = os.path.join(ASSETS, name)
        if os.path.exists(out) and not force:
            print("keep    ", out, "(already exists -- --force to redraw)")
            continue
        build().save(out)
        print("drew    ", out)

    for name in ("gohid.png", "aydin.png", "commander.png"):
        out = os.path.join(ASSETS, name)
        if not os.path.exists(out):
            print("MISSING ", out, "-- the game will fall back to procedural art")

    contact_sheet()
    embed(["gohid", "aydin", "commander"])


def contact_sheet():
    """All three sprites through the real normalise pipeline, side by side at
    each candidate pixelSize, so they can be compared before choosing one."""
    names = ["gohid", "aydin", "commander"]
    sizes = [32, 48, 64]
    pad = 8
    cell = max(sizes)
    sheet = Image.new("RGBA",
                      (len(names) * (cell + pad) + pad,
                       len(sizes) * (cell + pad) + pad),
                      (24, 20, 32, 255))
    for row, S in enumerate(sizes):
        for col, name in enumerate(names):
            path = os.path.join(ASSETS, name + ".png")
            if not os.path.exists(path):
                continue
            img = normalise(Image.open(path).convert("RGBA"), S)
            x = pad + col * (cell + pad) + (cell - S) // 2
            y = pad + row * (cell + pad) + (cell - S) // 2
            sheet.paste(img, (x, y), img)
    scale = 5
    sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)          .save(os.path.join(HERE, "_preview_sizes.png"))
    print("wrote    _preview_sizes.png  (rows: 32 / 48 / 64 px)")


def normalise(img, S):
    """Mirror of Sprites._normalise in js/sprites.js: letterbox into a square,
    area-average down to S, then hard-threshold alpha at 110. Kept in step with
    that function so the preview shows what the game will actually draw."""
    sw, sh = img.size
    side = max(sw, sh)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - sw) // 2, (side - sh) // 2))
    out = canvas.resize((S, S), Image.LANCZOS)
    px = out.load()
    for y in range(S):
        for x in range(S):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a > 110 else 0)
    return out


if __name__ == "__main__":
    main()
