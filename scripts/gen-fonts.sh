#!/usr/bin/env bash
# ─── Re-subset Open Runde from an upstream release ────────────────────────────────────────────
#
# The app ships ONE typeface, self-hosted: Open Runde (a rounded cut of Inter), OFL-1.1.
# Upstream releases the full charset at ~155 KB per weight — 310 KB for the two we use. This
# subsets to what the screen actually draws — Latin-1, Vietnamese, punctuation, the app's symbols —
# which is ~55 KB total, an 83% saving (124 KB until the 2026-10-16 re-derivation below).
#
# ⚠️ TWO WEIGHTS, NOT FOUR (owner, 2026-08-13: "drop font weights to 2 bold for prices and bold
# parts and normal else"). Open Runde is not variable, so each weight is a whole extra file that
# next/font preloads at priority High — ahead of the LCP image. Medium and Semibold were dropped
# and globals.css `@theme` retargets `--font-weight-medium` to 400 and `--font-weight-semibold` to
# 700, so the ~560 call sites using those classes keep them. If you re-add a weight here you must
# also drop its retarget in globals.css, or the file will ship and never be requested.
#
# ⚠️ VIETNAMESE COVERAGE IS THE WHOLE REASON THIS FONT WAS CHOSEN, so the ranges below are not
# negotiable and the script VERIFIES the result rather than trusting the flags. eno.vn is a
# Vietnamese marketplace: dropping U+1EA0-1EF9 would fall every diacritic back to a system font,
# which looks like a rendering fault on half the listings and would not fail any test.
#
# ⚠️ IT IS NOT WIRED INTO THE BUILD, DELIBERATELY. The output is committed (src/fonts/*.woff2)
# because a font is not a build artifact — it changes when someone decides to change it, not on
# every install, and pyftsubset is a Python dependency no CI box here has. Run it by hand when
# the upstream release moves, then commit the four files.
#
#   usage: bash scripts/gen-fonts.sh [version]     # default: the version below
set -euo pipefail

VERSION="${1:-1.0.1}"
REPO="lauridskern/open-runde"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v pyftsubset >/dev/null || {
  echo "✗ pyftsubset not found — install fonttools:  pip install 'fonttools[woff]' brotli" >&2
  exit 1
}

echo "→ fetching Open Runde v$VERSION"
gh release download "v$VERSION" --repo "$REPO" --pattern '*.zip' --output "$TMP/or.zip" --clobber
unzip -q -o "$TMP/or.zip" -d "$TMP"
WEB="$(find "$TMP" -type d -name web -not -path '*__MACOSX*' | head -1)"
[ -d "$WEB" ] || { echo "✗ no web/ directory in the release" >&2; exit 1; }

# ⛔ RE-DERIVED 2026-10-16 (speed plan item 7): 126.6 KB → ~55 KB for the two weights, which next/font preloads at
# priority High on every first visit, ahead of the LCP image. Each range is here because something on screen draws it,
# measured against the live catalogue (every active listing's title + description, seller names and bios, profile
# names — psql, 2026-10-16) and the UI source:
#  · Latin-1 (U+0000-00FF) — · ² ° and the accented letters in 1,900 of 2,121 listings.
#  · VIETNAMESE — ă đ ĩ ũ ơ ư and the precomposed vowels (U+1EA0-1EF9), plus every mark fully DECOMPOSED Vietnamese
#    needs as a combining character: the five tones (U+0300 0301 0303 0309 0323) AND the circumflex, breve and horn
#    (U+0302 0306 031B — ậ is a + U+0323 + U+0302; Google's vietnamese subset leaves those three out), with 0304 0308
#    0329 as Google has them.
#  · General punctuation, whole (U+2000-206F) — — ’ – … • in thousands of listings.
#  · The currency signs the app prints: ₫ € ₩ ₹ ₽ (src/lib/currencies.ts; $ £ ¥ are Latin-1). The whole currency block
#    was +6 KB for signs nothing renders.
#  · ≈ ≤ ≥ ≠ ∞ − ∕ and the arrows U+2190-2199.
#  · U+2600-26FF and U+2700-27BF whole: upstream draws only 11 of them (☀ ★ ☆ ☼ ♡ ♥ ⚠ ✓ ✗ ❖ ❤), 1.8 KB, and ★ ❤ ✓ ⚠ are
#    in live listings and the UI — dropped, they would render from the platform's fallback (often a colour emoji).
#  · ŏ (U+014F, "Buôn Akŏ Dhông" in itinerary-places.ts); ı Œ œ ʻ ʼ ˆ ˚ ˜ as Google's latin subset has.
# ⛔ DELIBERATELY OUT, MEASURED: Latin Extended-A/B (+8.9 KB — ONE live listing of 2,121 uses a letter from them, a č,
# and 0 of 355 seller and profile names), the rest of the combining block (+10 KB), letterlike symbols (+4.8 KB; ™ is
# kept), super/subscripts (+4.9 KB; ² ³ are Latin-1), the rest of the arrows and math blocks. A character outside the
# subset still renders — in next/font's metric-matched Arial fallback: a slightly different letter, never a missing one.
# Re-measure before adding a range back; every byte here is paid by every visitor.
# ⚠️ THE SYMBOL BLOCKS ARE NOT OPTIONAL. A first pass stopped at U+2215 and the app immediately
# fell back to Arial on ≈ (U+2248) — the dual-currency approximation, which appears on EVERY
# price. Same for ⚠ (U+26A0) in the prelaunch banner and ✓ (U+2713). Open Runde HAS all of them;
# only the subset was dropping them, and a missing glyph is invisible until it is on screen.
UNICODES="U+0000-00FF,U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+1EA0-1EF9"
UNICODES+=",U+0300-0304,U+0306,U+0308-0309,U+031B,U+0323,U+0329,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+014F"
UNICODES+=",U+2000-206F,U+20A9,U+20AB,U+20AC,U+20B9,U+20BD,U+2122,U+2190-2199,U+2212,U+2215,U+221E,U+2248,U+2260"
UNICODES+=",U+2264-2265,U+2600-26FF,U+2700-27BF,U+FEFF,U+FFFD"

for W in Regular:regular Bold:bold; do
  SRC="${W%%:*}"; OUT="${W##*:}"
  pyftsubset "$WEB/OpenRunde-$SRC.woff2" \
    --output-file="$DEST/open-runde-$OUT.woff2" \
    --flavor=woff2 --layout-features='*' --unicodes="$UNICODES" --no-hinting --desubroutinize
  printf '  %-9s %7s -> %7s bytes\n' "$SRC" \
    "$(stat -f%z "$WEB/OpenRunde-$SRC.woff2" 2>/dev/null || stat -c%s "$WEB/OpenRunde-$SRC.woff2")" \
    "$(stat -f%z "$DEST/open-runde-$OUT.woff2" 2>/dev/null || stat -c%s "$DEST/open-runde-$OUT.woff2")"
done

# ⚠️ PROVE THE VIETNAMESE SURVIVED. A subset that silently drops a range still produces valid
# woff2 files of a plausible size, so size is not evidence. This asserts the cmap directly.
python3 - "$DEST" <<'PY'
import sys, glob, os
from fontTools.ttLib import TTFont
# Vietnamese, plus the symbols the app actually renders. ≈ is the dual-currency approximation
# and appears on EVERY price; ⚠ is the prelaunch banner. Both were dropped by the first subset.
need = {0x0111: 'đ', 0x0110: 'Đ', 0x01B0: 'ư', 0x01A1: 'ơ', 0x1EC7: 'ệ', 0x1ED9: 'ộ',
        0x1EEF: 'ữ', 0x1EAD: 'ậ', 0x20AB: '₫', 0x2248: '≈', 0x26A0: '⚠', 0x2713: '✓',
        0x2605: '★', 0x2192: '→', 0x2022: '•', 0x2026: '…',
        # The 2026-10-16 re-derivation: the combining tone marks (decomposed Vietnamese), the app's currency signs,
        # and the symbols live listings use.
        0x0300: 'U+0300', 0x0301: 'U+0301', 0x0303: 'U+0303', 0x0309: 'U+0309', 0x0323: 'U+0323', 0x0302: 'U+0302',
        0x0306: 'U+0306', 0x031B: 'U+031B', 0x20AC: '€',
        0x20A9: '₩', 0x20B9: '₹', 0x20BD: '₽', 0x2764: '❤', 0x2606: '☆', 0x2264: '≤', 0x2265: '≥', 0x2014: '—',
        0x2019: '’', 0x00B7: '·', 0x00B2: '²'}
# ⚠️ AND PROVE IT STAYED SMALL (speed plan item 7): both files are preloaded at priority High on every first visit, so a
# range added back is paid by every visitor. Raise the cap only after re-measuring (the UNICODES note above).
CAP = 30_000
bad = False
for path in sorted(glob.glob(sys.argv[1] + '/open-runde-*.woff2')):
    cmap = TTFont(path).getBestCmap()
    missing = [c for cp, c in need.items() if cp not in cmap]
    name = path.rsplit('/', 1)[-1]
    size = os.path.getsize(path)
    if missing:
        bad = True
        print(f'  ✗ {name}: MISSING {" ".join(missing)}')
    elif size > CAP:
        bad = True
        print(f'  ✗ {name}: {size} bytes, over the {CAP}-byte cap')
    else:
        print(f'  ✓ {name}: {len(cmap)} glyphs, {size} bytes, Vietnamese + symbols intact')
if bad:
    sys.exit('✗ subset dropped required coverage — do not commit these files')
PY

cp "$(find "$TMP" -iname 'OFL.txt' -not -path '*__MACOSX*' | head -1)" "$DEST/OFL-OpenRunde.txt" 2>/dev/null || true
echo "✓ done — commit src/fonts/open-runde-*.woff2"
