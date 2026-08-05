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
# ⚠️ (3) DROP HEREDOC BODIES — THE LINES, NOT "EVERYTHING AFTER `<<`".
# The two sed passes below delete a QUOTED `-m`/`-F` value, the only message form they were written
# for. But `git commit -F - <<'MSG' … MSG` puts the whole message into the command string as ordinary
# unquoted words, and every detector below then parses the prose. Measured 2026-08-05: a commit
# message describing its own change ("… covers src/lib/ssrf.ts …") had that path read as a PATHSPEC
# OPERAND — `git ls-files --error-unmatch` naturally succeeds for a real file a message merely
# mentions — and the commit was REFUSED. The header of this file already calls a false positive a
# fatal bug here, because a guard that blocks correct commits gets switched off.
#
# ⚠️ THE OBVIOUS FIX (`flags="${flags%%<<*}"`) IS ITSELF A BYPASS, AND ALL THREE REVIEWERS SAID SO.
# Truncating at the first `<<` discards anything written after it on the SAME line, so
#     git commit -F - <<'MSG' -- ':(literal)src/app/foo.ts'
# loses its pathspec, and with an empty index the relocated exit below then permits an unreviewed
# working-tree commit — re-opening the exact hole this revision closes. Verified before believing it:
# that command was ALLOWed by the truncating version and is BLOCKed by this one. (Their other two
# candidates — `-m "Refactor <<" -a` and `--message='a << b' -- path` — were already handled by the
# sed passes and blocked correctly either way; one claim in three surviving is the usual rate here.)
#
# A heredoc BODY is by definition the following LINES, so drop those and keep every line intact.
# Anything the author wrote on the command line — flags, `--`, pathspecs — is still parsed.
#
# ⚠️ IT SKIPS ONLY WHEN A REAL TERMINATOR EXISTS, AND THAT DIRECTION IS THE WHOLE DESIGN. The first
# version tracked "am I inside a body?" as it streamed, which fails OPEN in two ways both found by
# review and then reproduced here:
#   · `<<-MSG` permits a TAB-INDENTED terminator, which an exact `$0 == tag` never matches. awk stayed
#     in body mode for the rest of the input, so a following `git commit … -- <path>` was invisible.
#   · A multi-line QUOTED message that merely contains `<<EOF` (`-m "fixed <<EOF\nstill msg"`) looked
#     like a heredoc start, so the next line — carrying the pathspec — was swallowed.
# Both were ALLOWed by the streaming version and are BLOCKed by this one; the third candidate
# (a `\` line continuation) was already handled.
#
# Looking the terminator up FIRST inverts the failure direction: if none is found, nothing is
# skipped, every line is parsed, and the worst case is a REFUSED commit rather than an unreviewed
# one. Leading whitespace is stripped from the candidate terminator unconditionally — over-eager
# termination is safe for the same reason (it parses more, never less).
# ⚠️ THE SAME PASS ALSO STRIPS A MULTI-LINE QUOTED MESSAGE, AND IT HAS TO BE HERE RATHER THAN IN THE
# sed BELOW. `sed` is line-based, so `git commit -m "fix\nsrc/lib/ssrf.ts"` — an ordinary two-line
# message — keeps its second line, and that line names a tracked file, so the operand parser reads it
# as a PATHSPEC and refuses a harmless commit. Reproduced: with an empty index it BLOCKs. It is a
# pre-existing weakness that only became reachable when the pathspec check moved above the
# empty-index exit, which makes it this revision's problem to fix rather than to inherit. awk already
# has every line in hand, so the quoted span is removed across newlines in one place.
cmd=$(printf '%s' "$cmd" | awk '
  { lines[NR] = $0 }
  END {
    i = 1; out = ""
    while (i <= NR) {
      line = lines[i]
      out = out line "\n"
      if (match(line, /<<-?[ \t]*("[^"]+"|\047[^\047]+\047|[A-Za-z_][A-Za-z0-9_]*)/)) {
        t = substr(line, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*/, "", t)
        gsub(/["\047]/, "", t)
        end = 0
        for (j = i + 1; j <= NR; j++) {
          s = lines[j]
          sub(/^[ \t]+/, "", s); sub(/\r$/, "", s)
          if (s == t) { end = j; break }
        }
        if (end > 0) { i = end + 1; continue }   # a genuine body: skip it and its terminator
      }
      i++
    }
    # A negated character class matches newlines in awk, so these spans cross lines — which is the
    # entire reason this is not another sed. Only values attached to a MESSAGE option are removed;
    # a quoted pathspec like \047:(literal)src/x.ts\047 is left alone for the operand parser.
    gsub(/(-m|-F|--message|--file)[ =]*"[^"]*"/, " ", out)
    gsub(/(-m|-F|--message|--file)[ =]*\047[^\047]*\047/, " ", out)
    printf "%s", out
  }
')

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

# ⚠️ THE PATHSPEC CHECK RUNS BEFORE THE "NOTHING STAGED" EXIT, AND THE ORDER IS THE WHOLE POINT.
# It used to run after, which made it DEAD CODE in the only situation it was written for. A pathspec
# commit stages nothing — that is what "commits the working tree, not the index" means — so
# `git diff --cached` is empty, the `[ -z "$changed" ] && exit 0` below fired first, and the guard
# waved through exactly the form CLAUDE.md mandates:
#     git commit -m "…" -- ':(literal)src/app/foo.ts'      ← reviewed nothing, wrote no receipt
# Measured 2026-08-05 by reading the line numbers against the commits this session produced: three
# commits went in with no receipt and never triggered the gate. The reviews had been run by hand and
# reported, so the POLICY held — but the mechanism that exists because "discipline was demonstrably
# the wrong mechanism" was itself doing nothing. A guard whose most important check is unreachable
# is worse than none, because everyone believes it fired.
#
# Ordering it first is sufficient: with a dirty tracked tree the pathspec form is now refused and the
# author must `git add`, which makes the index the thing that gets committed and the receipt true
# again. With a CLEAN tracked tree and an empty index there is nothing for the pathspec form to
# commit, so falling through to the exit below is correct rather than permissive.
#
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

(If you were told nothing is staged: that is exactly the case this refuses. A pathspec commit stages
nothing by design, so "nothing staged" is not "nothing to review" — it is "the review would have
certified the wrong thing".)
MSG
  exit 2
fi

# NOW the "nothing staged" exit is safe to take. Reaching here means either there were no pathspec
# operands (so the commit really is index-driven and an empty index means an empty commit git will
# reject anyway), or there were operands and the tracked tree is clean (so the pathspec form has
# nothing to pick up). Both are genuinely nothing-to-review; neither is the hole above.
[ -z "$changed" ] && exit 0

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
