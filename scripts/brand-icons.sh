#!/usr/bin/env bash
# Regenerate every raster of the brand mark from public/logo-mark.svg (Chromium render — see
# scripts/render-brand-icon.mjs for why not ImageMagick). Run after redrawing the mark, then
# set the `?v=` stamp it prints on the four /logo-mark.svg call sites, the PWA icon srcs in
# manifest.ts and the service worker's notification icon (public/sw.js) — the script lists any
# that are stale and fails until they match.
#
#   bash scripts/brand-icons.sh
#
# Rounded tile (transparent corners): favicon, PWA "any" icons, the iOS launch-cover image.
# Full-bleed square (the OS masks the corners itself): iOS AppIcon, apple-touch, maskable PWA,
# the Capacitor shell icon. Capacitor's Android launchers come from assets/icon-*.svg (foreground
# scaled 0.9 into the adaptive safe zone) and are regenerated here too.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ROUNDED=public/logo-mark.svg
TILE='M400 0H112C50.1441 0 0 50.1441 0 112V400C0 461.856 50.1441 512 112 512H400C461.856 512 512 461.856 512 400V112C512 50.1441 461.856 0 400 0Z'
SQUARE="$TMP/square.svg"
# ONE SOURCE OF TRUTH: every other SVG is derived from public/logo-mark.svg right here —
# src/app/icon.svg (byte copy), and the three Capacitor sources: icon-only (full-bleed square),
# icon-background (the tile alone), icon-foreground (the glyph alone, scaled to 0.66 so the "e" is
# the same share of the VISIBLE 72dp tile as it is of the iOS tile: 0.62 × 0.667 ≈ 0.41 of the
# 108dp layer, well inside the 61% safe circle — at 0.9 it read a third larger than everywhere else).
python3 - "$ROUNDED" "$SQUARE" "$TILE" <<'PY'
import re, sys
src, out, tile = sys.argv[1:]
s = open(src, encoding='utf-8').read()
assert s.count(tile) == 2, 'tile path not found twice — was the mark redrawn? update TILE in brand-icons.sh'
square = s.replace(tile, 'M0 0H512V512H0Z')
open(out, 'w', encoding='utf-8').write(square)
open('src/app/icon.svg', 'w', encoding='utf-8').write(s)
at1024 = lambda v: v.replace('width="512" height="512"', 'width="1024" height="1024"', 1)
flat = lambda v: re.sub(r'<style>.*?</style>', '', v, flags=re.S)  # Capacitor/Android sources: crisp, no size-gated filter
square = flat(square)  # ⚠️ BEFORE the first derived source is written, or icon-only.svg keeps the filter
open('assets/icon-only.svg', 'w', encoding='utf-8').write(at1024(square))
bg = re.sub(r'<g class="fx">.*?</g>\n', '', at1024(square), flags=re.S)
assert 'class="fx"' not in bg
open('assets/icon-background.svg', 'w', encoding='utf-8').write(bg)
fg = re.sub(r'<g>\n<path d="M400 0H112.*?</g>\n', '', at1024(flat(s)), count=1, flags=re.S)
assert fg.count('<path') == 2, fg.count('<path')
fg = fg.replace('<g class="fx">', '<g transform="translate(87.04 87.04) scale(0.66)">')
open('assets/icon-foreground.svg', 'w', encoding='utf-8').write(fg)
PY
# ⚠️ FLAT=1 — every raster is crisp; the shadow filter only exists for the web SVG at ≥160px.
r() { FLAT=1 node scripts/render-brand-icon.mjs "$1" "$2" "$3" >/dev/null; }
for s in 16 32 48 120 192 240 360 512; do r "$ROUNDED" "$TMP/r$s.png" "$s"; done
for s in 180 512 1024; do r "$SQUARE" "$TMP/s$s.png" "$s"; done
# ⛔ NO ALPHA CHANNEL ON THE STORE ICONS. Chromium's screenshot encoder writes RGBA even when every
# pixel is opaque, and App Store Connect refuses an AppIcon with an alpha channel (ITMS-90717).
# (`exclude-chunk=date` keeps the output byte-stable: ImageMagick otherwise stamps a creation
# time into the PNG and every regeneration shows up as a changed binary in git.)
for s in 180 512 1024; do magick "$TMP/s$s.png" -background '#0A66C2' -alpha remove -alpha off -define png:exclude-chunk=date,time "$TMP/s$s.png"; done
magick "$TMP/r16.png" "$TMP/r32.png" "$TMP/r48.png" src/app/favicon.ico
cp "$TMP/s180.png"  src/app/apple-icon.png
cp "$TMP/r192.png"  public/icon-192.png
cp "$TMP/r512.png"  public/icon-512.png
cp "$TMP/s512.png"  public/icon-maskable-512.png
cp "$TMP/s1024.png" apps/ios/Eno/Assets.xcassets/AppIcon.appiconset/icon-1024.png
cp "$TMP/s1024.png" ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
mkdir -p apps/ios/Eno/Assets.xcassets/LaunchMark.imageset
cp "$TMP/r120.png" apps/ios/Eno/Assets.xcassets/LaunchMark.imageset/launch-mark.png
cp "$TMP/r240.png" apps/ios/Eno/Assets.xcassets/LaunchMark.imageset/launch-mark@2x.png
cp "$TMP/r360.png" apps/ios/Eno/Assets.xcassets/LaunchMark.imageset/launch-mark@3x.png
# Android launchers. capacitor-assets still writes the LEGACY squares (ic_launcher.png / _round.png, 48–192px, pre-Android 8),
# which were always right. The ADAPTIVE layers are rendered here instead, and the two XMLs are written fresh below.
# ⛔ WHY (owner, 2026-09-14: "first downloaded app has small icon nothing like we uploaded it should look professional"):
# capacitor-assets' XML wraps each layer in `<inset android:inset="16.7%">`, which makes the PNG stand for the VISIBLE 72dp
# window — while icon-foreground.svg is already scaled 0.66 for a FULL 108dp layer. Both at once shrank the "e" to ~27%
# of the launcher tile instead of the ~61% it has on iOS and in the store icon, and the inset layers came out at 192px
# where xxxhdpi needs 432. So: no inset, full 108dp layers at their true density sizes, Chromium-rendered like the rest.
ADAPTIVE=android/app/src/main/res/mipmap-anydpi-v26
npx capacitor-assets generate --android --iconBackgroundColor '#0A66C2' --iconBackgroundColorDark '#0A66C2' >/dev/null
for d in ldpi:81 mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  name="${d%%:*}"; px="${d##*:}"
  r assets/icon-background.svg "android/app/src/main/res/mipmap-$name/ic_launcher_background.png" "$px"
  r assets/icon-foreground.svg "android/app/src/main/res/mipmap-$name/ic_launcher_foreground.png" "$px"
done
for xml in ic_launcher ic_launcher_round; do
  cat > "$ADAPTIVE/$xml.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by scripts/brand-icons.sh — full 108dp layers, NO inset (see the note there: an inset on top of the
     foreground's own 0.66 safe-zone scale is what made the launcher "e" tiny). -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <!-- Android 13+ themed icon: the system tints via the ALPHA channel; the foreground is a white mark on transparent. -->
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
XML
done
STAMP="$(shasum -a 256 "$ROUNDED" | cut -c1-8)"
echo "brand icons regenerated; logo-mark stamp: $STAMP"
# Every cache-stamped reference must carry THIS stamp; list the ones that do not.
# ⚠️ `src` AND `public` — the service worker (public/sw.js) stamps its notification icon too, and
# CI's asset-stamps test greps exactly these two trees. Missing it once cost a red CI (2026-09-05).
STALE="$(grep -rnE '(logo-mark\.svg|icon-(192|512|maskable-512)\.png)\?v=' src public | grep -v "v=$STAMP" || true)"
if [ -n "$STALE" ]; then echo "⚠️  stale stamps — set them to ?v=$STAMP:"; echo "$STALE"; exit 1; fi
