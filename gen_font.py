#!/usr/bin/env python3
"""
gen_font.py -- builds assets/pixel.woff2, the game's UI font.

The font is GENERATED, not downloaded. The game has to work offline from
file://, so a Google Fonts <link> is out; and vendoring someone else's binary
means carrying their licence around. Every glyph here is a 5x7 bitmap defined
below and converted into square outlines, so the font is fully ours, tiny, and
reproducible from source.

Each "on" pixel becomes one closed square contour. Squares that touch share an
edge, which fills correctly under the non-zero winding rule as long as every
contour is wound the same way -- they all are, being emitted by the same loop.

Metrics: 1000 units/em, 100 units per pixel. Baseline sits under row 6, so
rows 0-6 are the cap band (700 units) and rows 7-8 are the descender (-200).
Advance is 6 pixels: 5 of glyph, 1 of built-in spacing.

    python gen_font.py
"""

import base64
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")

PX = 100          # font units per bitmap pixel
COLS = 5
BASELINE_ROW = 6  # rows 0..6 above the baseline, 7..8 below
ADVANCE = 6 * PX
UPM = 1000
LF = chr(10)

# Every glyph is rows of 5 characters; '#' is an on pixel. Trailing empty rows
# may be omitted. Rows beyond index 6 descend below the baseline.
G = {
    " ": [],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],

    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["###..", "#..#.", "#...#", "#...#", "#...#", "#..#.", "###.."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],

    "a": [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
    "b": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
    "c": [".....", ".....", ".###.", "#....", "#....", "#....", ".###."],
    "d": ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
    "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
    "f": ["..##.", ".#...", ".#...", "###..", ".#...", ".#...", ".#..."],
    "g": [".....", ".....", ".####", "#...#", "#...#", "#...#", ".####",
          "....#", ".###."],
    "h": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "i": ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
    "j": ["...#.", ".....", "..##.", "...#.", "...#.", "...#.", "...#.",
          "#..#.", ".##.."],
    "k": ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
    "l": [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "m": [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
    "n": [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
    "p": [".....", ".....", "####.", "#...#", "#...#", "#...#", "####.",
          "#....", "#...."],
    "q": [".....", ".....", ".####", "#...#", "#...#", "#...#", ".####",
          "....#", "....#"],
    "r": [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
    "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
    "t": [".#...", ".#...", "###..", ".#...", ".#...", ".#..#", "..##."],
    "u": [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
    "v": [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "w": [".....", ".....", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
    "x": [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    "y": [".....", ".....", "#...#", "#...#", "#...#", ".####", "....#",
          "....#", ".###."],
    "z": [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],

    "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
    '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
    "#": [".#.#.", "#####", ".#.#.", ".#.#.", "#####", ".#.#.", "....."],
    "%": ["##..#", "##.#.", "..#..", ".#...", "#.##.", "#..##", "....."],
    "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
    "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
    "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
    ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
    "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
    "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
    ",": [".....", ".....", ".....", ".....", ".....", "..#..", "..#..",
          ".#..."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    ".": [".....", ".....", ".....", ".....", ".....", ".....", "..#.."],
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
    ":": [".....", "..#..", "..#..", ".....", "..#..", "..#..", "....."],
    ";": [".....", "..#..", "..#..", ".....", "..#..", "..#..", ".#..."],
    "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
    "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
    ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
    "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
    "[": [".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."],
    "]": [".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."],
    "^": ["..#..", ".#.#.", "#...#", ".....", ".....", ".....", "....."],
    "_": [".....", ".....", ".....", ".....", ".....", ".....", ".....",
          "#####"],
    "|": ["..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "~": [".....", ".....", ".##.#", "#.##.", ".....", ".....", "....."],
    # Multiplication sign and middle dot: the UI shows "x3" score multipliers
    # and uses a separator dot between menu items.
    "×": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
    "·": [".....", ".....", ".....", "..#..", ".....", ".....", "....."],
    # Arrows for the level-up cards ("Lv 2 -> 3").
    "→": [".....", "..#..", "...#.", "#####", "...#.", "..#..", "....."],
    "←": [".....", "..#..", ".#...", "#####", ".#...", "..#..", "....."],
}


def glyph_name(ch):
    if ch == " ":
        return "space"
    if ch.isalnum() and ord(ch) < 128:
        return ch if ch.isalpha() else "num" + ch
    return "uni%04X" % ord(ch)


def build_glyph(rows):
    """One square contour per on-pixel."""
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            if cell != "#":
                continue
            x0 = c * PX
            y1 = (BASELINE_ROW - r + 1) * PX
            y0 = y1 - PX
            pen.moveTo((x0, y0))
            pen.lineTo((x0, y1))
            pen.lineTo((x0 + PX, y1))
            pen.lineTo((x0 + PX, y0))
            pen.closePath()
    return pen.glyph()


def main():
    os.makedirs(ASSETS, exist_ok=True)

    order = [".notdef"]
    cmap = {}
    glyphs = {".notdef": build_glyph(["#####", "#...#", "#...#", "#...#",
                                      "#...#", "#...#", "#####"])}
    metrics = {".notdef": (ADVANCE, 0)}

    for ch, rows in G.items():
        name = glyph_name(ch)
        if name in glyphs:
            continue
        for row in rows:
            if len(row) != COLS:
                raise SystemExit("glyph %r has a row of width %d, expected %d"
                                 % (ch, len(row), COLS))
        order.append(name)
        cmap[ord(ch)] = name
        glyphs[name] = build_glyph(rows)
        metrics[name] = (ADVANCE, 0)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({
        "familyName": "Gohid Pixel",
        "styleName": "Regular",
        "psName": "GohidPixel-Regular",
        "fullName": "Gohid Pixel Regular",
        "version": "Version 1.000",
        "copyright": "Generated by gen_font.py for Run From Gohid.",
    })
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, sTypoLineGap=0,
                usWinAscent=800, usWinDescent=200,
                sxHeight=500, sCapHeight=700, achVendID="GHID")
    fb.setupPost(isFixedPitch=1)

    ttf = os.path.join(ASSETS, "pixel.ttf")
    fb.save(ttf)

    font = TTFont(ttf)
    font.flavor = "woff2"
    woff2 = os.path.join(ASSETS, "pixel.woff2")
    font.save(woff2)
    os.remove(ttf)          # the woff2 is the only thing the game ships

    print("wrote %s  (%d glyphs, %d bytes)"
          % (woff2, len(order), os.path.getsize(woff2)))
    write_font_css(woff2)


def write_font_css(woff2_path):
    """Emit css/font.css with the font inlined as a data: URI.

    Chrome refuses to load an @font-face file over file:// -- fonts are subject
    to CORS and a file:// origin is opaque, so the rule fails silently and the
    UI falls back to the system monospace. A data: URI is same-origin by
    definition, so this keeps the bundled font working with no server. The
    .woff2 on disk stays the artefact of record; this is a transport wrapper.
    """
    with open(woff2_path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    lines = [
        "/* GENERATED BY gen_font.py -- DO NOT EDIT BY HAND.",
        " * The font is inlined as a data: URI because Chrome blocks",
        " * @font-face files loaded over file:// as a CORS failure.",
        " * Re-run: python gen_font.py */",
        "@font-face {",
        "  font-family: 'Gohid Pixel';",
        "  font-style: normal;",
        "  font-weight: 400;",
        "  font-display: block;",
        "  src: url(data:font/woff2;base64," + b64 + ") format('woff2');",
        "}",
        "",
    ]
    css = LF.join(lines)
    dest = os.path.join(HERE, "css", "font.css")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8", newline=LF) as fh:
        fh.write(css)
    print("wrote %s  (%d bytes)" % (dest, os.path.getsize(dest)))


if __name__ == "__main__":
    main()
