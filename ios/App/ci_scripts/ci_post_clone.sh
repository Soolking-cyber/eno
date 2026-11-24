#!/bin/sh
# Xcode Cloud: runs after the clone, before Swift packages resolve (owner 2026-11-24: from April 2027 App Store uploads
# need Xcode 27, which needs Apple silicon; the build Mac is Intel, so Apple's machines build the app).
# The project needs two things the repo does not hold: node_modules/@capacitor/* (CapApp-SPM/Package.swift points
# there) and ios/App/App/capacitor.config.json + public/ (written by `cap sync`, gitignored). The same release checks as
# scripts/ios-release.sh follow, so a cloud binary can never boot anything but https://eno.vn.
set -eu
cd "$CI_PRIMARY_REPOSITORY_PATH"

# Node 24 (package.json engines). Xcode Cloud images ship Homebrew; a machine that already has Node 24 skips it.
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)'; then
  export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1
  brew install node@24
  PATH="$(brew --prefix node@24)/bin:$PATH"
  export PATH
fi
echo "node $(node -v)"

# --ignore-scripts: postinstall generates the Prisma client and icon set, which the app binary never uses.
npm ci --ignore-scripts --no-audit --no-fund

[ -z "${ENO_LOCAL_SHELL:-}" ] || { echo "ENO_LOCAL_SHELL is set — the binary would boot the local shell" >&2; exit 1; }
npx cap sync ios
URL=$(plutil -extract server.url raw ios/App/App/capacitor.config.json)
[ "$URL" = "https://eno.vn" ] || { echo "server.url is $URL, expected https://eno.vn" >&2; exit 1; }
# ⛔ The app renders eno.vn only (owner, 2026-10-06): the navigable hosts are exactly these two — no eno.forum, no wildcard.
NAV=$(plutil -extract server.allowNavigation json -o - ios/App/App/capacitor.config.json)
[ "$NAV" = '["eno.vn","www.eno.vn"]' ] || { echo "allowNavigation is $NAV, expected [\"eno.vn\",\"www.eno.vn\"]" >&2; exit 1; }
# One app identity: the bundle id ios-release.sh checks (a corrupted one reached main once, 2026-07-27).
[ "$(grep -c 'PRODUCT_BUNDLE_IDENTIFIER = vn.eno.app;' ios/App/App.xcodeproj/project.pbxproj)" = "2" ] \
  || { echo "the App target's bundle id is not vn.eno.app in both configurations" >&2; exit 1; }
# cap sync must leave the committed plugin list as it is: a change means node_modules drifted from what was committed.
git diff --exit-code -- ios/App/CapApp-SPM/Package.swift
