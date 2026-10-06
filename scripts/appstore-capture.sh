#!/bin/bash
# APP STORE SCREENSHOTS, TAKEN FROM THE APP ITSELF — the iOS shell on a simulator, rendering the live
# https://eno.vn (the app's origin since 2026-10-06), exactly what a reviewer installs. Counterpart of
# scripts/play-capture.mjs (Play).
#
#   scripts/appstore-capture.sh <simulator-udid> <path/to/App.app>
#   → play-store-assets/ios/raw/0N-*.png + manifest.json   (gitignored, like the Play assets)
#   then: node scripts/appstore-frames.mjs                 (captions + frame → play-store-assets/ios/en/)
#
# The App.app is a DEBUG simulator build (only Debug WebViews are inspectable):
#   npx cap sync ios   # ENO_LOCAL_SHELL unset
#   xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
#     -destination 'generic/platform=iOS Simulator' -derivedDataPath <dd> CODE_SIGNING_ALLOWED=NO build
#
# ⛔ THE DEVICE IS AN iPhone 16 Pro Max ON THE iOS 18.4 RUNTIME. It renders 1320×2868, the 6.9-inch size
# App Store Connect requires; the iPhone 17 Pro Max would need the 26.5 runtime, whose simulator cannot
# decode AVIF (every listing photo comes out blank). The script refuses any other pixel size.
# ⛔ HEADLESS ONLY — DO NOT OPEN Simulator.app WHILE THIS RUNS. Measured 2026-10-04: with the GUI open the
# device took stray input (the page navigated by itself) and was shut down mid-run, twice.
# ⚠️ A FRESH INSTALL PER SHOT, AND EVERY SCREEN IS REACHED BY AN IN-APP DEEP LINK (enovn://open?path=…,
# the quick-action route), NEVER BY A FULL RELOAD: the simulator's HTTP/3 stack wedges on reloads and
# shows the offline page (a simulator artifact; devices are fine). Uninstalling clears it.
# ⛔ THE SET IS CERTIFIED AS A SET — manifest.json is written only after every shot passed, with each file's
# sha256, and appstore-frames.mjs frames nothing it does not vouch for (same rule as the Play pipeline).
#
# ⚠️ CAPTURE AFTER THE iOS GATES ARE LIVE ON eno.vn (eno-vn.env — the edition the app renders since 2026-10-06).
# The screens below show no gated surface today, but the store images must match what the reviewer sees;
# re-run once the owner has deployed the flag changes.
#
# No `set -e` (it is a no-op in the agent shell this was written in): every step that must stop the
# run checks its own status.

U="${1:?simulator udid}"
APP="${2:?path to App.app (Debug, iphonesimulator)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
# The blank-frame check and the alpha flatten both need ImageMagick 7; without it every shot would be
# reported "blank", which is the wrong diagnosis.
command -v magick >/dev/null || { echo "ImageMagick 7 (\`magick\`) is required — brew install imagemagick" >&2; exit 1; }
OUT="${OUT:-$ROOT/play-store-assets/ios/raw}"
# The inspector connection drops while a page navigates (a new document is a new inspector target), so
# every call is retried a few times before it counts as a failure.
inspect() {
  local i out
  for i in 1 2 3 4; do
    if out="$(python3 "$ROOT/scripts/ios-sim-inspect.py" "$U" "$1" 2>/dev/null)"; then printf '%s\n' "$out"; return 0; fi
    sleep 2
  done
  python3 "$ROOT/scripts/ios-sim-inspect.py" "$U" "$1"
}
INSPECT=inspect
PREP="$(cat "$ROOT/scripts/appstore-capture-prep.js")" || exit 1

# name | app path (reached by deep link) — the Appendix A screens of docs/ios-appstore-release.md.
SHOTS=(
  "01-home|/"
  "02-rentals-map|/"
  "03-motorbike|/motorbike-rental-ho-chi-minh-city"
  "04-jobs|/c/jobs"
  "05-item|/listings/cmtzgayju00fi0jrs1klz68ac"
  "06-shop|/sellers/cmtsev07l00089zq4tdg845f8"
)

[ -d "$APP" ] || { echo "no app at $APP" >&2; exit 1; }
xcrun simctl list devices | grep "$U" | grep -q Booted || { echo "simulator $U is not booted" >&2; exit 1; }
# The model AND the runtime, not just the pixel size — another device or runtime can render 1320×2868
# too (the header says why not the 26.5 runtime). Recorded in the manifest.
DEVICE="$(xcrun simctl list devices -j | python3 -c '
import json, sys
u = sys.argv[1]
for rt, devs in json.load(sys.stdin)["devices"].items():
    for d in devs:
        if d["udid"] == u:
            print(d["deviceTypeIdentifier"].rsplit(".", 1)[-1] + "|" + rt.rsplit(".", 1)[-1])
' "$U")"
case "$DEVICE" in
  "iPhone-16-Pro-Max|iOS-18-4") ;;   # the device TYPE — a simulator's display name is free text
  *) echo "simulator $U is \"$DEVICE\" — use an iPhone 16 Pro Max on the iOS 18.4 runtime" >&2; exit 1 ;;
esac
mkdir -p "$OUT" || exit 1
rm -f "$OUT/manifest.json"   # a stale certificate must not outlive a failed run
xcrun simctl status_bar "$U" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 || exit 1
# Leave the simulator as it was found: the fake 9:41 bar and the last shot's install go on any exit.
trap 'xcrun simctl status_bar "$U" clear >/dev/null 2>&1; xcrun simctl uninstall "$U" vn.eno.app >/dev/null 2>&1' EXIT

# Fails (exit 1, reasons on stderr) unless a scan result passes every check.
check() { # check <name> <stage> <inspector JSON output> <expected path>
  # shellcheck disable=SC2016
  python3 -c '
import json, sys, urllib.parse
raw = json.loads(sys.argv[3])
r = json.loads(raw) if isinstance(raw, str) else raw
problems = []
if r.get("error"): problems.append("prep threw " + r["error"])
u = urllib.parse.urlsplit(r.get("href") or "")
if u.scheme != "https" or u.netloc != "eno.vn": problems.append("not on https://eno.vn: " + str(r.get("href")))
if u.path != sys.argv[4].split("?")[0]: problems.append("on " + str(r.get("href")) + ", not " + sys.argv[4])
if not r.get("images"): problems.append("no image on screen — an empty or failed page")
if r.get("platform") != "ios" or not r.get("nativeIos"): problems.append("not rendering as the iOS app")
if r.get("hits"): problems.append("regulated copy on screen: " + " | ".join(r["hits"][:3]))
if r.get("broken"): problems.append("images failed or still loading: " + " | ".join(r["broken"][:2]))
if not r.get("fits"): problems.append("page wider than the viewport (WebKit would zoom out)")
if r.get("dialogs"): problems.append("a layer is open over the screen: " + " | ".join(r["dialogs"][:2]))
if problems: sys.exit(sys.argv[1] + " (" + sys.argv[2] + "): " + "; ".join(problems))
' "$1" "$2" "$3" "$4"
}

wait_for() { # wait_for <js predicate returning true> <seconds>
  # ⛔ A WALL-CLOCK BOUND, NOT AN ITERATION COUNT: under load one inspector call (four attach tries) takes
  # many seconds, so "30 iterations" ran past half an hour on 2026-10-04 (load 300) and wedged the run.
  local end=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$end" ]; do
    [ "$($INSPECT "$1" 2>/dev/null)" = "true" ] && return 0
    sleep 2
  done
  return 1
}

# One attempt at one shot. Returns non-zero (reason on stderr) instead of exiting, so the caller can
# retry: the simulator's network stack and a resume refresh can replace the document mid-shot, which
# loses the injected helper — a fresh install and a second try is the honest recovery, and a shot that
# fails three times stops the run.
shoot() { # shoot <name> <path> → prints the sha256 of the certified file
  local NAME="$1" P="$2" ENC RESULT AFTER ACTED F SIZE
  xcrun simctl terminate "$U" vn.eno.app >/dev/null 2>&1
  xcrun simctl uninstall "$U" vn.eno.app >/dev/null 2>&1   # fails harmlessly when nothing is installed…
  # …so prove it is gone: an upgrade-install over a surviving app would keep its cookies and storage.
  if xcrun simctl get_app_container "$U" vn.eno.app >/dev/null 2>&1; then echo "$NAME: the old install survived uninstall" >&2; return 1; fi
  # stdout of every step below is discarded: this function's stdout IS the hash the manifest records.
  xcrun simctl install "$U" "$APP" >/dev/null || { echo "$NAME: install failed" >&2; return 1; }
  xcrun simctl launch "$U" vn.eno.app >/dev/null || { echo "$NAME: launch failed" >&2; return 1; }
  wait_for "location.href.startsWith('https://eno.vn/') && document.readyState === 'complete'" 60 \
    || { echo "$NAME: the app never loaded eno.vn" >&2; return 1; }
  sleep 4
  # Quiet the sign-up prompt before its 60-second clock can fire (see quietPrompts in the prep file).
  $INSPECT "$PREP" >/dev/null || return 1
  if [ "$P" != "/" ]; then
    ENC="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$P")"
    $INSPECT "location.href = 'enovn://open?path=$ENC'; true" >/dev/null || return 1
    wait_for "location.pathname === '${P%%\?*}' && document.readyState === 'complete'" 40 \
      || { echo "$NAME: the deep link did not land on $P" >&2; return 1; }
    sleep 6
  fi
  $INSPECT "$PREP" >/dev/null || return 1
  $INSPECT "window.__enoCapture.act('$NAME')" >/dev/null || return 1
  # `(window.__enoCapture || {})`: a replaced document has no helper — that is a failed attempt, not a hang.
  wait_for "(window.__enoCapture || {}).acted != null" 40 || { echo "$NAME: the screen action did not finish" >&2; return 1; }
  ACTED="$($INSPECT "window.__enoCapture.acted")"
  [ "$ACTED" = "\"$NAME\"" ] || { echo "$NAME: the screen action failed — $ACTED" >&2; return 1; }
  $INSPECT "window.__enoCapture.prep()" >/dev/null || return 1
  wait_for "(window.__enoCapture || {}).result != null" 40 || { echo "$NAME: prep did not finish" >&2; return 1; }
  RESULT="$($INSPECT "JSON.stringify(window.__enoCapture.result)")" || return 1
  echo "$NAME: $RESULT" >&2
  check "$NAME" "before the shot" "$RESULT" "$P" || return 1
  F="$OUT/$NAME.png"
  # A settle before the shutter: closing the sign-up prompt (prep) animates its scrim out.
  sleep 1
  xcrun simctl io "$U" screenshot "$F" >/dev/null 2>&1 || { echo "$NAME: screenshot failed" >&2; return 1; }
  SIZE="$(python3 -c 'import struct,sys; b=open(sys.argv[1],"rb").read(24); print("%dx%d" % struct.unpack(">II", b[16:24]))' "$F")"
  # Return 2, not 1: the wrong device is not worth a retry — the loop below stops the run on it.
  [ "$SIZE" = "1320x2868" ] || { echo "$NAME: $SIZE is not the 6.9-inch 1320x2868 — use an iPhone 16 Pro Max on iOS 18.4" >&2; rm -f "$F"; return 2; }
  # ⛔ THE DOM CHECKS CANNOT SEE PIXELS. 2026-10-04: 06-shop passed both scans (6 images, no dialog) and
  # was certified as a uniform white frame — the WebView had not painted. The page area (below the status
  # bar, above the home indicator) must carry real contrast, or the shot is retried.
  SPREAD="$(magick "$F" -gravity north -crop 1320x2295+0+344 +repage -colorspace gray -format '%[fx:standard_deviation]' info: 2>/dev/null)"
  python3 -c 'import sys; sys.exit(0 if float(sys.argv[1] or 0) >= 0.02 else 1)' "$SPREAD" \
    || { echo "$NAME: the frame is blank (gray spread ${SPREAD:-?} < 0.02) — the WebView had not painted" >&2; rm -f "$F"; return 1; }
  # The DOM can change between the scan and the shutter (a carousel, a late prompt): scan the page the
  # shot was taken of, and discard the file rather than certify it if anything new appeared.
  AFTER="$($INSPECT "window.__enoCapture.rescan()")" || { rm -f "$F"; return 1; }
  check "$NAME" "after the shot" "$AFTER" "$P" || { rm -f "$F"; return 1; }
  # App Store Connect refuses screenshots with an alpha channel.
  magick "$F" -alpha remove -alpha off -define png:exclude-chunk=date,time "$F" >/dev/null || { rm -f "$F"; return 1; }
  shasum -a 256 "$F" | cut -d' ' -f1
}

MANIFEST="{"
for row in "${SHOTS[@]}"; do
  NAME="${row%%|*}"; P="${row#*|}"; SHA=""
  for attempt in 1 2 3; do
    SHA="$(shoot "$NAME" "$P")"; rc=$?
    [ $rc -eq 0 ] && [ -n "$SHA" ] && break
    SHA=""
    [ $rc -eq 2 ] && exit 1
    echo "$NAME: attempt $attempt failed" >&2
  done
  [ -n "$SHA" ] || { echo "$NAME: REFUSED after 3 attempts" >&2; exit 1; }
  MANIFEST="$MANIFEST\"$NAME\":\"$SHA\","
done
# "base" is asserted per shot by check() (scheme + host), not merely written here.
printf '{"at":"%s","base":"https://eno.vn","device":"%s","model":"%s","shots":%s}}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$U" "$DEVICE" "${MANIFEST%,}" > "$OUT/manifest.json" || exit 1
python3 -m json.tool "$OUT/manifest.json" >/dev/null || { echo "manifest is not JSON" >&2; rm -f "$OUT/manifest.json"; exit 1; }
echo "certified ${#SHOTS[@]} shots → $OUT"
