# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Writes the Latin subsets of the web app's Inter and JetBrains Mono.

Each typeface is declared twice in apps/web/src/index.css: a small Latin file
for the characters the site writes in, and the whole font for everything else,
split by unicode-range so a page downloads the whole font only when it shows a
character outside LATIN. Both fonts are under the SIL Open Font License without
a Reserved Font Name, so the subsets keep their names.

Run after replacing a font, then copy the printed ranges into index.css:

    pip install fonttools brotli
    python3 scripts/subset-fonts.py
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent.parent / "apps" / "web" / "src" / "assets" / "fonts"

# Basic Latin and Latin-1, as Google Fonts' "latin" subset, with the punctuation,
# arrows, keyboard symbols (⌘ ⌥ ⇧ ⌃ ⌫), box drawing and shapes the app writes.
LATIN = [
    (0x0000, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153), (0x02BB, 0x02BC),
    (0x02C6, 0x02C6), (0x02DA, 0x02DA), (0x02DC, 0x02DC), (0x0304, 0x0304),
    (0x0308, 0x0308), (0x0329, 0x0329), (0x2000, 0x209F), (0x20AC, 0x20AC),
    (0x2122, 0x2122), (0x2190, 0x21FF), (0x2212, 0x2212), (0x2215, 0x2215),
    (0x2300, 0x23FF), (0x2500, 0x257F), (0x25A0, 0x25FF), (0x2700, 0x27BF),
    (0xFEFF, 0xFEFF), (0xFFFD, 0xFFFD),
]

# (whole font, its Latin subset, the whole font again as WOFF2 where it isn't one)
JOBS = [
    ("Inter-Variable.woff2", "Inter-Variable-Latin.woff2", None),
    ("Inter-Italic-Variable.woff2", "Inter-Italic-Variable-Latin.woff2", None),
    ("JetBrainsMono-VariableFont.ttf", "JetBrainsMono-Variable-Latin.woff2", "JetBrainsMono-Variable.woff2"),
]


def css_range(ranges):
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges)


def rest(ranges, top=0x10FFFF):
    """Every code point LATIN leaves out, for the whole font's unicode-range."""
    out, start = [], 0
    for a, b in sorted(ranges):
        if a > start:
            out.append((start, a - 1))
        start = b + 1
    if start <= top:
        out.append((start, top))
    return out


def main():
    unicodes = [code for a, b in LATIN for code in range(a, b + 1)]
    for source, latin, whole in JOBS:
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.notdef_outline = True
        font = TTFont(FONTS / source)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=unicodes)
        subsetter.subset(font)
        font.flavor = "woff2"
        font.save(FONTS / latin)
        print(f"{latin}: {(FONTS / latin).stat().st_size // 1024} KB (from {(FONTS / source).stat().st_size // 1024} KB)")
        if whole:
            font = TTFont(FONTS / source)
            font.flavor = "woff2"
            font.save(FONTS / whole)
            print(f"{whole}: {(FONTS / whole).stat().st_size // 1024} KB")
    print(f"\nLatin files:  unicode-range: {css_range(LATIN)};")
    print(f"Whole fonts:  unicode-range: {css_range(rest(LATIN))};")


if __name__ == "__main__":
    main()
