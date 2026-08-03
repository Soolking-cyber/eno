#!/usr/bin/env bash
# PreToolUse(Bash) — refuse `git commit` unless THIS staged diff has been reviewed.
#
# Owner, 2026-08-03: "every commit should have a 2nd opinion guard". The policy was already in
# CLAUDE.md as a non-negotiable and was still skipped twice in a single day — once on the OTP work,
# once on three UI commits. Discipline was demonstrably the wrong mechanism, so this makes it
# structural: the reviewers run, a receipt is written for the exact content hash, and the hook
# checks that hash.
#
# ⚠️ IT VALIDATES THE CONTENT, NOT THE INTENT. The receipt name is a sha256 of `git diff --cached`,
# so staging one more file — or amending — moves the hash and the old receipt stops applying. A
# review of something else is not a review of this.
#
# ⚠️ IT DOES NOT BLOCK ON A "REFUTED" VERDICT. Reviewers are wrong roughly a third of the time on
# this repo (measured), so auto-blocking would train everyone to bypass the gate. What is enforced
# is that the review HAPPENED and the verdicts are on record; judging them stays a human act.
#
# ⚠️ KNOWN SCOPE — READ THIS BEFORE TRUSTING IT. codex made the point plainly and it is correct: this
# is a Claude Code PreToolUse(Bash) hook, NOT a git hook. It sees commands this session runs through
# Bash and nothing else. A commit made from a terminal, an IDE, a shell alias, or a script bypasses
# it completely and always will. Commit-PRODUCING commands other than `git commit` — `merge`,
# `cherry-pick`, `revert`, `rebase`, `am` — are deliberately not gated: they are rare here and
# blocking one mid-conflict does more harm than the review adds.
# So this raises the cost of skipping a review from "forget to do it" to "deliberately route around
# it". That is worth having, and it is NOT the same as a guarantee. Do not describe it as one.
set -uo pipefail

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null || echo '__JQ_FAILED__')

# ⚠️ MATCH `git … commit`, NOT THE LITERAL STRING "git commit" — codex and qwen both walked straight
# through the old substring test with `git -C <path> commit` and `git -c user.name=x commit`, which
# are ordinary forms, not exotic ones. And if jq is missing the old version produced an empty string
# and exited 0: a gate that fails OPEN on a broken dependency is not a gate.
[ "$cmd" = "__JQ_FAILED__" ] && { echo "second-opinion guard: jq unavailable — refusing to fail open." >&2; exit 2; }

# ⚠️ NORMALISE BEFORE MATCHING, IN THIS EXACT ORDER — the two obvious orders are each wrong, and
# both were shipped for a revision before a reviewer caught them:
#   (1) Drop the -m/-F MESSAGE ARGUMENT first. agy caught that matching flags against the raw command
#       read the commit message as flags, so `git commit -m "revert the -a flag"` was refused. A
#       guard that blocks correct commits gets switched off, so a false positive is a fatal bug here.
#   (2) THEN strip the remaining quote characters, keeping their contents. Stripping whole quoted
#       spans (the first fix) meant `git commit "-a"` had its flag vanish before the regex ran —
#       qwen caught that, and it defeated the -a ban with an ordinary command form. Removing only
#       the quote CHARACTERS keeps `"-a"` visible as `-a` while the message is already gone.
# ⚠️ `[ =]*` NOT `[ =]+` — `-m"msg"` IS VALID GIT AND WAS BEING MISREAD. agy found it: with `+`, the
# unspaced form did not match, `tr` then stripped the quotes, and `-m"added feature"` became
# `-madded feature` — a single-dash cluster containing `a`, refused as if it were `-a`.
flags=$(printf '%s' "$cmd" \
  | sed -E "s/(-m|-F|--message|--file)([ =]*)('[^']*'|\"[^\"]*\")//g" \
  | sed -E "s/(^| )-m[^ ]+//g" \
  | tr -d "\"'")

# ⚠️ `git` MUST BE IN COMMAND POSITION. The old test was `*git*commit*` anywhere in the string, which
# codex showed blocks innocent commands: `rg 'git commit' docs/` tripped the gate and could refuse a
# grep. Anchoring to start-of-line or a shell separator means the words only count when they are
# actually being run — while still catching `git -C <path> commit` and `... && git commit`.
# ⚠️ ALLOW A LEADING ENV ASSIGNMENT. qwen found that `FOO=bar git commit` — the ordinary way to set
# GIT_AUTHOR_DATE or EDITOR for one command — put `git` out of command position and skipped the gate.
# ⚠️ ALSO ALLOW WRAPPER WORDS. codex and qwen both walked past the detector with `command git
# commit` / `sudo git commit` / `time git commit` — none exotic, all leaving `git` out of command
# position. Not exhaustive by construction (`eval "git commit"` still escapes, and always will —
# see the KNOWN SCOPE note), but these are the forms someone types by habit rather than to evade.
ENVPFX='([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+|(command|sudo|env|time|nice|exec)[[:space:]]+)*'
if ! printf '%s' "$flags" | grep -qE "(^|[;&|(])[[:space:]]*${ENVPFX}git([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+commit([[:space:]]|\$)"; then
  exit 0
fi

# ⚠️ ONE BASH CALL THAT STAGES *AND* COMMITS DEFEATS THIS ENTIRELY — codex's sharpest finding, and it
# is the most natural thing anyone would type. PreToolUse fires ONCE, before the whole command line,
# so `git add src/x && git commit -m x` is hashed BEFORE the `git add` runs: the hook validates the
# old index (often empty, so it exits 0 as "nothing staged"), then Bash stages new code and commits
# it with no review at all. No amount of flag parsing catches this, because the flags are innocent —
# the problem is the ORDER. Splitting the two calls restores the invariant that the index the hook
# hashed is the index that gets committed.
if printf '%s' "$flags" | grep -qE '(^|[;&|(])[[:space:]]*'"${ENVPFX}"'git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(add|stage|rm|mv|stash)([[:space:]]|$)'; then
  cat >&2 <<'MSG'
second-opinion guard: this command both STAGES and COMMITS in one call. The hook runs once, before
any of it — so it hashed the index as it was BEFORE the staging step, and the receipt would certify
content no reviewer ever saw. Run the staging command first, then `node scripts/second-opinion.mjs`,
then commit as a separate call.
MSG
  exit 2
fi

# ⚠️ `-a` / `--all` STAGE AT COMMIT TIME, AFTER THIS HOOK HAS HASHED THE INDEX — so the receipt would
# cover diff A while the commit contains B. Already banned by CLAUDE.md ("git add -A and commit -a
# stay BANNED", after they scooped mid-flight work into two broken commits), so refusing here
# enforces an existing rule rather than inventing one.
# ⚠️ MATCH BUNDLED SHORT OPTIONS, NOT JUST `-a`. codex pointed out `git commit -qa` slips past a
# literal `-a`/`-am` test while doing exactly the same thing, so this matches any single-dash cluster
# containing `a`. `--author=` is unaffected: it starts with `--`, which the single-dash class cannot.
# ⚠️ `--amend` REWRITES THE PREVIOUS COMMIT (qwen). The receipt is keyed to `git diff --cached`, which
# does not describe the amended RESULT, so an amend would ship content under a receipt for something
# else — the same certify-the-wrong-thing failure as `-a`.
# ⚠️ `--pathspec-from-file=` IS THE SAME HOLE WEARING A DIFFERENT HAT (codex). It selects paths — and
# therefore working-tree content — while parsing as an attached long option, so the bare-operand
# detector below finds nothing and waves it through.
# ⚠️ `--patch`/`-p` AND `--interactive`/`-i` ARE THE SAME HOLE AS `-a` (agy). They open a chooser
# that stages NEW HUNKS at commit time — after this hook hashed the index — so the receipt would
# certify a diff the human then edited. Banning -a while allowing -p is not a guard, it is a
# speed bump.
if printf '%s' "$flags" | grep -qE '(^| )--(all|amend|pathspec-from-file|patch|interactive)([ =]|$)|(^| )-[A-Za-z]*[ap][A-Za-z]*( |$)'; then
  cat >&2 <<'MSG'
second-opinion guard: -a/--all/--amend/--patch/--interactive/--pathspec-from-file defeat this gate (and
-a/--all is banned by CLAUDE.md). Those stage tracked files at commit time — AFTER the receipt was
computed from the index — or rewrite a commit the receipt never described. Stage by literal pathspec,
review, then commit.
MSG
  exit 2
fi

# ⚠️ DOCS-ONLY COMMITS ARE EXEMPT, matching the Cloud Build triggers' own ignoredFiles — those
# paths cannot deploy, so a review gate on them is pure friction with no risk avoided.
#
# ⚠️ BUT `.claude/` IS **NOT** EXEMPT, AND THAT IS THE POINT. It was, for one run, and both qwen and
# agy immediately noticed the same hole: this hook and its settings LIVE under .claude/, so a
# docs-style exemption let a commit disable the guard without ever triggering it. Those paths are
# executable controls, not documentation. Deploy-irrelevance is not the test — self-modification is.
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
# ⚠️ FAIL CLOSED. This was `cd "$root" || exit 0`, which codex flagged: a missing, moved or wrongly
# supplied CLAUDE_PROJECT_DIR silently permitted the commit — the gate's own dependency failing was
# the way through it, exactly the shape the jq check above exists to prevent.
cd "$root" || { echo "second-opinion guard: cannot enter project dir ($root) — refusing to fail open." >&2; exit 2; }
# ⚠️ DISTINGUISH "NOTHING STAGED" FROM "git FAILED" (qwen). Both produce empty output, and the old
# code read either as "nothing to review" and exited 0 — so a broken git was a way through the gate,
# the same fail-open shape as the jq and `cd` cases above. Nothing staged is genuinely fine (the
# commit itself will fail); git erroring is not.
if ! changed=$(git diff --cached --name-only 2>/dev/null); then
  echo "second-opinion guard: 'git diff --cached' failed — refusing to fail open." >&2
  exit 2
fi
[ -z "$changed" ] && exit 0

# ⚠️ `git commit -- <path>` COMMITS THE WORKING TREE, NOT THE INDEX. codex found this and it matters
# more here than anywhere else, because it is the form CLAUDE.md MANDATES
# (`git commit -m "…" -- ':(literal)path'`). git resolves a pathspec commit from the working tree, so
# any unstaged edit to a tracked file rides along under a receipt computed from `git diff --cached` —
# the repo's own convention silently defeating its own gate. Requiring a clean tracked tree for the
# pathspec form makes index and working tree identical, which makes the receipt true again.
# Untracked files are irrelevant (`git diff` ignores them), so ordinary scratch work is unaffected.
# ⚠️ DETECT THE PATHSPEC BY ITS OPERAND, NOT BY ` -- `. The first version only looked for the
# separator, and codex pointed out that `git commit -m msg src/file` is the same pathspec commit
# written without it — so the very check meant to close this hole missed its most ordinary form.
# What identifies a pathspec commit is a BARE OPERAND after `commit`: anything that is not a flag and
# not the value of one. Option-value pairs are consumed so `-m msg` does not read as a path.
operands=$(printf '%s' "${flags#*commit}" | tr ' ' '\n' | awk '
  BEGIN { skip = 0 }
  /^$/       { next }
  skip == 1  { skip = 0; next }
  /^(-m|-F|-C|-c|--message|--file|--author|--date|--template|--fixup|--squash)$/ { skip = 1; next }
  /^-/       { next }
             { print }
')

# ⚠️ AN OPERAND ONLY COUNTS IF IT IS ACTUALLY A PATH. agy showed the parser turning ordinary prose
# into pathspecs: an unspaced or escape-quoted message (`git commit -m "added \"auth\""`) leaves
# fragments like `bug` or `auth\` behind, and treating those as paths blocked correct commits
# whenever anything tracked was dirty. Git itself is the authority on what names a tracked file, so
# ask it: `ls-files --error-unmatch` succeeds only for real tracked paths. Pathspec MAGIC (`:(literal)…`,
# `:/…`) is kept unconditionally — it is unambiguously a pathspec and never a stray English word.
# This narrows the check to the real risk and removes an entire class of false positives at once.
real_paths=''
while IFS= read -r op; do
  [ -z "$op" ] && continue
  case "$op" in
    :*) real_paths="$real_paths $op"; continue ;;
  esac
  if git ls-files --error-unmatch -- "$op" >/dev/null 2>&1; then
    real_paths="$real_paths $op"
  fi
done <<EOF
$operands
EOF
operands="$real_paths"
# ⚠️ THE CLEANLINESS TEST IS REPO-WIDE, NOT PATH-SCOPED, AND THAT IS A DELIBERATE TRADE. qwen called
# it out as over-broad — correctly. Scoping it would mean expanding the operands back into `git diff
# -- <paths>`, and the pathspecs this repo mandates look like `':(literal)src/x.ts'`; re-expanding
# parentheses through the shell is its own injection/parse hazard. Blocking slightly more than
# necessary, with a message saying exactly how to proceed, beats a clever parser inside a guard.
if [ -n "$operands" ] && ! git diff --quiet; then
  cat >&2 <<'MSG'
second-opinion guard: `git commit -- <path>` commits the WORKING TREE for those paths, not the index,
and tracked files currently have unstaged changes. The receipt certifies `git diff --cached`, so the
commit could contain content no reviewer saw. Run `git add -- <paths>` first (then re-run the gate if
the staged diff changed), or `git stash` the unrelated edits.
MSG
  exit 2
fi
# ⚠️ CLAUDE.md AND .claude/ ARE **NOT** EXEMPT. qwen caught that a blanket `*.md` exemption let the
# project's own operating rules be rewritten with no review — the same self-modification hole as the
# .claude/ one, one directory over. Only genuinely inert docs are exempt.
# ⚠️ playwright.config.ts / vitest.config.ts ARE NOT EXEMPT. They were, and qwen caught that they
# CONFIGURE THE GATES — a testMatch, a timeout or a reporter change can quietly stop a suite from
# running what it claims to run. Deploy-irrelevance is not the test; being an executable control is.
# ⚠️ `e2e/` IS NO LONGER EXEMPT EITHER (codex). Cloud Build ignores the path, so an e2e commit
# cannot deploy — but deploy-irrelevance was never the test. Those specs ARE the assertions that
# catch a visa/payment surface leaking onto the licensed marketplace, so a commit that quietly
# weakens or deletes one removes a control. Same self-modification logic as .claude/ and CLAUDE.md.
if ! printf '%s\n' "$changed" | grep -qvE '^(docs/|README\.md$)'; then
  exit 0
fi

if node scripts/second-opinion.mjs --status >/dev/null 2>&1; then
  exit 0
fi

hash=$(node -e "
  const {execFileSync}=require('child_process'), {createHash}=require('crypto');
  const d=execFileSync('git',['diff','--cached'],{encoding:'utf8',maxBuffer:67108864});
  console.log(createHash('sha256').update(d).digest('hex').slice(0,16));
" 2>/dev/null)

cat >&2 <<EOF
SECOND-OPINION GUARD — this staged diff (${hash}) has not been reviewed.

CLAUDE.md requires an external second opinion at BOTH plan and diff for substantive work, and
this hook exists because that rule was skipped twice on 2026-08-03 despite being written down.

Run:  node scripts/second-opinion.mjs

It dispatches codex, agy and qwen IN PARALLEL against the staged diff, prints their verdicts, and
writes .second-opinion/${hash}.json. At least TWO families must actually answer — a reviewer that
errors or returns nothing is not a pass. A REFUTED verdict does not block the commit; read the
findings and VERIFY each by measuring before acting on it.

If this genuinely needs no review (a revert, a docs typo outside the exempt paths), say so out loud
in the commit message rather than working around the guard silently.
EOF
exit 2
