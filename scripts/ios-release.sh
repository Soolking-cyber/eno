#!/bin/bash
# THE iOS APP STORE BINARY — archive, check, and (optionally) upload to App Store Connect / TestFlight.
# docs/ios-appstore-release.md §2, P4, P6. The Capacitor shell renders the live https://eno.vn (owner,
# 2026-10-06: "ship both with eno.vn"), so a new binary is needed only when the NATIVE shell changes
# (plugin, Info.plist, privacy manifest, entitlement, icon) — a web deploy reaches installed apps on its own.
#
#   scripts/ios-release.sh <build-number>            # signed archive + checks, nothing leaves the Mac
#   scripts/ios-release.sh <build-number> --upload   # …then export + upload (appears in TestFlight)
#
# <build-number> = CFBundleVersion. It must be higher than every build already uploaded for this version,
# rejected ones too. The script writes it into project.pbxproj (CURRENT_PROJECT_VERSION) — commit the bump
# with the release. Output: ~/eno-ios-prep/release-builds/<stamp>-b<build>/ (override IOS_RELEASE_OUT).
#
# SIGNING: automatic, with the Xcode account (Xcode → Settings → Accounts, the Eno company limited team).
# For a fully headless run set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (an App Store Connect API .p8 —
# Admin role: cloud-managed distribution signing needs it) — passed to every xcodebuild call. Never commit a .p8.
# ⚠️ A NEW TEAM CANNOT ARCHIVE UNTIL IT HAS ONE REGISTERED DEVICE (automatic signing needs a development
# profile, and that needs a device). Once per team, build to the connected iPhone first:
#   xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination id=<udid> \
#     -derivedDataPath <dd> -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
# (`xcrun devicectl list devices` → the udid). That also registers the App ID with its capabilities.
# ⚠️ The first signed build on a Mac shows "codesign wants to use key …": click ALWAYS ALLOW, or every
# later headless build hangs at CodeSign (fix once: security set-key-partition-list -S
# apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db).
# ⛔ Never pass PRODUCT_BUNDLE_IDENTIFIER on the xcodebuild command line: it renames IONCameraLib.framework
# too and the install fails with DuplicateIdentifier. It lives in project.pbxproj, App target only.
#
# No `set -e` (a no-op in the agent shell): every step that must stop the run checks its own status.

cd "$(dirname "$0")/.." || exit 1
BUILD="$1"
UPLOAD="$2"
PBX=ios/App/App.xcodeproj/project.pbxproj
fail() { echo "✗ $*" >&2; exit 1; }

[[ "$BUILD" =~ ^[0-9]+$ ]] || fail "usage: $0 <build-number> [--upload]"
[ -z "$UPLOAD" ] || [ "$UPLOAD" = "--upload" ] || fail "unknown option $UPLOAD"
[ -z "${ENO_LOCAL_SHELL:-}" ] || fail "ENO_LOCAL_SHELL is set — the binary would boot the local shell, not the live site"
# ⛔ XCODE 26.x ONLY until the shell adopts the UIScene life cycle: a UIKit app built with the iOS 27 SDK
# and no scene manifest does not launch on iOS 27 (TN3187) — while it still launches on iOS 26, so a
# test phone on 26 hides it. Xcode 27 shipped 2026-09-14; keep App Store auto-update off for Xcode.
xcodebuild -version | head -1 | grep -q '^Xcode 26\.' || fail "archive with Xcode 26.x — $(xcodebuild -version | head -1) needs UIScene first (TN3187)"
grep -q 'DEVELOPMENT_TEAM = S4VCY6N8QR' "$PBX" && fail "project.pbxproj still carries the free personal team S4VCY6N8QR (P4)"
[ "$(grep -c 'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;' "$PBX")" = "2" ] || fail "App.entitlements is not wired into BOTH App configurations (P4)"
TEAM=$(grep -m1 -oE 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' "$PBX" | sed -E 's/.* = (.*);/\1/')
[ -n "$TEAM" ] || fail "no DEVELOPMENT_TEAM in project.pbxproj"
[ "$(grep -c "DEVELOPMENT_TEAM = $TEAM;" "$PBX")" = "$(grep -c 'DEVELOPMENT_TEAM = ' "$PBX")" ] || fail "project.pbxproj carries more than one DEVELOPMENT_TEAM"
BUNDLE=$(grep -m1 -oE 'PRODUCT_BUNDLE_IDENTIFIER = [A-Za-z0-9.-]+;' "$PBX" | sed -E 's/.* = (.*);/\1/')
[ "$(grep -c "PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE;" "$PBX")" = "2" ] || fail "the App target's two PRODUCT_BUNDLE_IDENTIFIER lines disagree"
# The uploaded binary must be a commit (plus the build-number bump made below).
if [ "$UPLOAD" = "--upload" ] && [ -z "${IOS_RELEASE_ALLOW_DIRTY:-}" ]; then
  DIRTY=$(git status --porcelain -- ios capacitor capacitor.config.ts package.json package-lock.json)
  [ -z "$DIRTY" ] || fail "uncommitted native changes — commit first (or IOS_RELEASE_ALLOW_DIRTY=1 for a throwaway):
$DIRTY"
fi
CUR=$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PBX" | grep -oE '[0-9]+$')
# Strictly higher than the committed number: an upload commits its bump, so the committed number is always the last
# one Apple has seen (or the never-uploaded 1). Apple refuses a reused CFBundleVersion only after the archive + upload.
[ "$BUILD" -gt "$CUR" ] || fail "build $BUILD must be higher than the project's $CUR (the last uploaded, or 1)"
AUTH=()
if [ -n "${ASC_KEY_ID:-}" ]; then
  [ -f "${ASC_KEY_PATH:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] || fail "ASC_KEY_ID needs ASC_ISSUER_ID and an ASC_KEY_PATH file"
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi
OUT="${IOS_RELEASE_OUT:-$HOME/eno-ios-prep/release-builds}/$(date +%Y%m%d-%H%M%S)-b$BUILD"
mkdir -p "$OUT" || fail "cannot create $OUT"

sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $BUILD;/" "$PBX" || fail "build-number bump"
npx cap sync ios > "$OUT/cap-sync.log" 2>&1 || fail "npx cap sync ios — $OUT/cap-sync.log"
URL=$(plutil -extract server.url raw ios/App/App/capacitor.config.json) || fail "capacitor.config.json has no server.url"
[ "$URL" = "https://eno.vn" ] || fail "server.url is $URL, expected https://eno.vn"
# ⛔ The app renders eno.vn only (owner, 2026-10-06): no eno.forum host may be navigable inside it.
plutil -extract server.allowNavigation json -o - ios/App/App/capacitor.config.json 2>/dev/null | grep -q 'eno\.forum' \
  && fail "allowNavigation lists an eno.forum host — fix capacitor.config.ts"

echo "→ archiving build $BUILD into $OUT (several minutes)"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" -derivedDataPath "$OUT/dd" -allowProvisioningUpdates "${AUTH[@]}" archive \
  > "$OUT/archive.log" 2>&1 || fail "archive failed — tail $OUT/archive.log"
WARN=$(grep -cE '^[^ ].*: (warning|error):' "$OUT/archive.log")

APP="$OUT/App.xcarchive/Products/Applications/App.app"
pl() { plutil -extract "$1" raw "$APP/Info.plist" 2>/dev/null; }
[ "$(pl CFBundleVersion)" = "$BUILD" ] || fail "CFBundleVersion is $(pl CFBundleVersion), expected $BUILD"
[ "$(pl ITSAppUsesNonExemptEncryption)" = "false" ] || fail "ITSAppUsesNonExemptEncryption must be false"
[ "$(pl UIDeviceFamily.0)" = "1" ] && [ -z "$(pl UIDeviceFamily.1)" ] || fail "UIDeviceFamily is not iPhone-only"
[ "$(plutil -extract server.url raw "$APP/capacitor.config.json")" = "https://eno.vn" ] || fail "bundled server.url is wrong"
# The forum must not render in the app (owner, 2026-10-06): a forum host here keeps forum links in the WebView.
plutil -extract server.allowNavigation json -o - "$APP/capacitor.config.json" 2>/dev/null | grep -q 'eno\.forum' \
  && fail "bundled server.allowNavigation lets eno.forum render in the app"
# The offline page (and the local shell) return to ORIGIN on every first-launch-offline retry.
for f in error.html index.html; do
  grep -q "var ORIGIN = 'https://eno.vn'" "$APP/public/$f" || fail "bundled public/$f does not return to https://eno.vn (capacitor/www ORIGIN)"
done
[ "$(pl CFBundleIdentifier)" = "$BUNDLE" ] || fail "CFBundleIdentifier is $(pl CFBundleIdentifier), project says $BUNDLE"
# The live site is Tailwind v4 = WebKit 16.4+; an older iOS would install the app and render it broken.
[ "$(pl MinimumOSVersion)" = "16.4" ] || fail "MinimumOSVersion is $(pl MinimumOSVersion), expected 16.4"
# Owner, 2026-10-06 (Appendix B): eKYC is hidden in the iOS app (ios-hide-kyc ON); the e-Visa flow is NOT (ios-hide-visa
# stays OFF) and on eno.vn it is PHOTOS-ONLY — passport page + portrait, no form, so no religion. That is why this
# binary declares no SensitiveInfo. If eno.vn ever asks the full form again, declare SensitiveInfo and delete this
# check in the same change.
plutil -convert json -o - "$APP/PrivacyInfo.xcprivacy" | grep -q 'NSPrivacyCollectedDataTypeSensitiveInfo' \
  && fail "PrivacyInfo.xcprivacy declares SensitiveInfo — the app collects none (eno.vn e-Visa is photos-only; eKYC is web-only on iOS)"
for k in NSCameraUsageDescription NSPhotoLibraryUsageDescription NSPhotoLibraryAddUsageDescription NSMicrophoneUsageDescription NSLocationWhenInUseUsageDescription; do
  [ -n "$(pl $k)" ] || fail "Info.plist lacks $k (ITMS-90683)"
done
codesign -d --entitlements - --xml "$APP" > "$OUT/entitlements.plist" 2>/dev/null || fail "cannot read the signed entitlements"
ent() { /usr/libexec/PlistBuddy -c "Print :$1" "$OUT/entitlements.plist" 2>/dev/null; }
[ "$(ent com.apple.developer.team-identifier)" = "$TEAM" ] || fail "signed by team $(ent com.apple.developer.team-identifier), project says $TEAM"
[ -n "$(ent aps-environment)" ] || fail "signed app lacks aps-environment"
DOMAINS=$(ent com.apple.developer.associated-domains)
# ⛔ applinks:eno.vn and NOTHING else (owner, 2026-10-06; see App.entitlements): no forum host, no www.
{ [ "$(echo "$DOMAINS" | grep -c 'applinks:')" = "1" ] && echo "$DOMAINS" | grep -qx '[[:space:]]*applinks:eno\.vn'; } \
  || fail "signed app must claim exactly applinks:eno.vn — it claims: $(echo "$DOMAINS" | grep -o 'applinks:[^[:space:]]*' | tr '\n' ' ')"

# Required-reason APIs: every Mach-O, undefined symbols only. A change here means PrivacyInfo.xcprivacy
# needs a matching category (runbook §2) — then update EXPECTED.
EXPECTED='App: _OBJC_CLASS_$_NSUserDefaults
Frameworks/Capacitor.framework/Capacitor:
Frameworks/Cordova.framework/Cordova:
Frameworks/IONCameraLib.framework/IONCameraLib: _NSURLCreationDateKey'
SCAN=$(find "$APP" -type f | while read -r f; do
  file "$f" | grep -q Mach-O || continue
  echo "${f#$APP/}: $(nm -u "$f" 2>/dev/null | grep -E 'UserDefaults|CreationDate|ModificationDate|_stat$|_fstat$|_lstat$|getattrlist|systemUptime|mach_absolute_time|VolumeAvailableCapacity|_statfs|_statvfs|FileSystemFreeSize|activeInputModes' | sort -u | tr '\n' ' ' | sed 's/ $//')"
done | sed 's/: $/:/' | LC_ALL=C sort)
[ "$SCAN" = "$EXPECTED" ] || { echo "$SCAN" > "$OUT/required-reason-scan.txt"; fail "required-reason API scan changed — see $OUT/required-reason-scan.txt, then PrivacyInfo.xcprivacy"; }

echo "✓ archive OK — $BUNDLE $(pl CFBundleShortVersionString) ($BUILD), team $TEAM, $WARN compiler warnings"
if [ "$UPLOAD" = "--upload" ]; then
  echo "→ exporting + uploading to App Store Connect"
  cp ios/ExportOptions-AppStore.plist "$OUT/ExportOptions.plist" && /usr/libexec/PlistBuddy -c "Add :teamID string $TEAM" "$OUT/ExportOptions.plist" \
    || fail "cannot write $OUT/ExportOptions.plist"
  xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
    -exportPath "$OUT/export" -allowProvisioningUpdates "${AUTH[@]}" > "$OUT/upload.log" 2>&1 \
    || fail "upload failed — tail $OUT/upload.log"
  echo "✓ uploaded — App Store Connect emails when processing ends (then TestFlight shows build $BUILD)"
fi
echo "Commit the build-number bump in $PBX with this release."
