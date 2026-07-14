#!/usr/bin/env bash
# PostToolUse(Edit|Write) — keep src/generated/ui-strings.ts in step with the UI copy.
#
# Every static string is harvested into that file so the language provider can warm
# ALL of them in one batch on language change. Add a tr('…','…') / <Tr text="…"> and
# forget to regenerate, and the new string falls back to a lazy /api/translate round
# trip at runtime (or renders untranslated). It's a silent regression — nothing fails.
#
# So: regenerate on every src edit (it's ~0.3s and deterministic) and, if the file
# actually moved, tell Claude — the new EN strings usually want a curated Vietnamese
# line in src/generated/vi-overrides.ts (consulted BEFORE machine translation).
set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$file" in
  */src/*.tsx|*/src/*.ts) ;;
  *) exit 0 ;;
esac
case "$file" in
  */src/generated/*) exit 0 ;;   # don't recurse on our own output
esac

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
gen="$root/src/generated/ui-strings.ts"
before=$(shasum "$gen" 2>/dev/null | cut -d' ' -f1)
(cd "$root" && node scripts/gen-ui-strings.mjs >/dev/null 2>&1) || exit 0
after=$(shasum "$gen" 2>/dev/null | cut -d' ' -f1)
[ "$before" = "$after" ] && exit 0

added=$(cd "$root" && git diff -- src/generated/ui-strings.ts | grep -c '^+  "' || true)
msg="ui-strings.ts was stale — regenerated it (${added} string(s) added). New EN copy that deserves natural Vietnamese belongs in src/generated/vi-overrides.ts (VI_OVERRIDES is consulted before machine translation). Commit the regenerated file with your change."
jq -n --arg m "$msg" '{systemMessage:$m, hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$m}}'
exit 0
