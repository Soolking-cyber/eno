#!/usr/bin/env bash
# ─── Re-subset Open Runde from an upstream release ────────────────────────────────────────────
#
# The app ships ONE typeface, self-hosted: Open Runde (a rounded cut of Inter), OFL-1.1.
# Upstream releases the full charset at ~155 KB per weight — 620 KB for the four we use. This
# subsets to Latin + the Vietnamese block, which is 236 KB total, a 62% saving.
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

# Latin + Latin-1 + Latin Ext-A/B + combining marks + LATIN EXTENDED ADDITIONAL (U+1E00-1EFF,
# which is where every Vietnamese precomposed vowel lives) + punctuation + currency (₫ = U+20AB)
# + arrows, MATH OPERATORS, misc symbols and dingbats.
# ⚠️ THE SYMBOL BLOCKS ARE NOT OPTIONAL. A first pass stopped at U+2215 and the app immediately
# fell back to Arial on ≈ (U+2248) — the dual-currency approximation, which appears on EVERY
# price. Same for ⚠ (U+26A0) in the prelaunch banner and ✓ (U+2713). Open Runde HAS all of them;
# only the subset was dropping them, and a missing glyph is invisible until it is on screen.
UNICODES="U+0000-00FF,U+0100-017F,U+0180-024F,U+0259,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20BF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2600-26FF,U+2700-27BF,U+FEFF,U+FFFD"

for W in Regular:regular Medium:medium Semibold:semibold Bold:bold; do
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
import sys, glob
from fontTools.ttLib import TTFont
# Vietnamese, plus the symbols the app actually renders. ≈ is the dual-currency approximation
# and appears on EVERY price; ⚠ is the prelaunch banner. Both were dropped by the first subset.
need = {0x0111: 'đ', 0x0110: 'Đ', 0x01B0: 'ư', 0x01A1: 'ơ', 0x1EC7: 'ệ', 0x1ED9: 'ộ',
        0x1EEF: 'ữ', 0x1EAD: 'ậ', 0x20AB: '₫', 0x2248: '≈', 0x26A0: '⚠', 0x2713: '✓',
        0x2605: '★', 0x2192: '→', 0x2022: '•', 0x2026: '…'}
bad = False
for path in sorted(glob.glob(sys.argv[1] + '/open-runde-*.woff2')):
    cmap = TTFont(path).getBestCmap()
    missing = [c for cp, c in need.items() if cp not in cmap]
    name = path.rsplit('/', 1)[-1]
    if missing:
        bad = True
        print(f'  ✗ {name}: MISSING {" ".join(missing)}')
    else:
        print(f'  ✓ {name}: {len(cmap)} glyphs, Vietnamese + symbols intact')
if bad:
    sys.exit('✗ subset dropped required coverage — do not commit these files')
PY

cp "$(find "$TMP" -iname 'OFL.txt' -not -path '*__MACOSX*' | head -1)" "$DEST/OFL-OpenRunde.txt" 2>/dev/null || true
echo "✓ done — commit src/fonts/open-runde-*.woff2"
