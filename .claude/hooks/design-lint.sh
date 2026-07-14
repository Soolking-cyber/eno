#!/usr/bin/env bash
# PostToolUse(Edit|Write) — enforce the design canon the moment a component changes.
#
# scripts/design-lint.mjs already gates `npm run lint` and `npm run build` (Vercel
# fails on drift), but that feedback arrives minutes later. This runs it in ~0.3s
# right after the edit and exits 2 on a violation, which feeds the report back to
# Claude so the canon breach is fixed in place instead of at deploy time.
#
# See docs/design-language.md for the rules and the `design-lint-allow` escape hatch.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$file" in
  */src/*.tsx) ;;
  *) exit 0 ;;   # only .tsx under src/ can violate the canon
esac

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
if out=$(cd "$root" && node scripts/design-lint.mjs 2>&1); then
  exit 0
fi

printf 'design-lint FAILED — docs/design-language.md violations (fix before continuing):\n%s\n' "$out" >&2
exit 2
