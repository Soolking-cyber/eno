#!/usr/bin/env bash
# PostToolUse(Edit|Write) — keep the generated UI-string catalogues in step with the copy.
#
# Every static string is harvested into them so the language provider can warm ALL of
# them in one batch on language change. Add a tr('…','…') / <Tr text="…"> and forget to
# regenerate, and the new string falls back to a lazy /api/translate round trip at
# runtime (or renders untranslated). It's a silent regression — nothing fails.
#
# ⚠️ TWO FILES, ONE GENERATOR. gen-ui-strings.mjs writes src/generated/ui-strings.ts
# (shared) AND src/generated/ui-strings.services.ts (visa/itinerary-only copy — see the
# split rationale at the top of the generator). This hook watched only the first, so a
# services-only edit regenerated the services catalogue and then reported nothing:
# the shasum matched and it exited at the `before = after` check, and even had it
# spoken up, the counter diffed a file that hadn't moved and would have said
# "0 string(s) added". Both the comparison and the counter now cover the pair.
#
# So: regenerate on every src edit (it's ~0.3s and deterministic) and, if either file
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
# Both catalogues, hashed together — a services-only change moves only the second one.
# shasum over two paths prints two lines; the embedded newline is harmless inside "$var".
rel_core='src/generated/ui-strings.ts'
rel_svc='src/generated/ui-strings.services.ts'
before=$(shasum "$root/$rel_core" "$root/$rel_svc" 2>/dev/null | cut -d' ' -f1)
(cd "$root" && node scripts/gen-ui-strings.mjs >/dev/null 2>&1) || exit 0
after=$(shasum "$root/$rel_core" "$root/$rel_svc" 2>/dev/null | cut -d' ' -f1)
[ "$before" = "$after" ] && exit 0

added=$(cd "$root" && git diff -- "$rel_core" "$rel_svc" | grep -c '^+  "' || true)
msg="The UI-string catalogues were stale — regenerated ${rel_core} + ${rel_svc} (${added} string(s) added). New EN copy that deserves natural Vietnamese belongs in src/generated/vi-overrides.ts (VI_OVERRIDES is consulted before machine translation). Commit the regenerated file(s) with your change."
jq -n --arg m "$msg" '{systemMessage:$m, hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$m}}'
exit 0
