#!/usr/bin/env bash
# Behavioural tests for .claude/hooks/second-opinion.sh — the commit review gate.
#
# ⚠️ WHY THIS FILE EXISTS. The gate is a security control that had NO tests, and on 2026-08-05 that
# cost exactly what you would expect: its most important check — the one stopping a pathspec commit
# from bypassing review — sat BELOW an early `[ -z "$changed" ] && exit 0`. A pathspec commit stages
# nothing by definition, so that exit always fired first and the check was DEAD CODE. Three commits
# went in that day with no receipt and nobody noticed, because the gate was believed rather than
# observed. Every case below is one the gate got wrong at some point.
#
# ⚠️ IT BUILDS ITS OWN THROWAWAY REPO, AND THAT IS NOT TIDINESS — IT IS THE TEST.
# The first version of this file ran against the real checkout and PASSED AGAINST THE BUGGY HOOK,
# because whatever happened to be staged at that moment made the index non-empty and the dead check
# reachable. A test whose result depends on the author's working tree cannot fail when it matters,
# which is the same defect this session spent its time removing from the unit suite. So each case
# declares the state it needs — EMPTY INDEX and a dirty tracked file for the pathspec cases — and
# gets a fresh repo containing exactly that.
#
# ⚠️ RUN IT FROM ANYWHERE:  bash .claude/hooks/second-opinion.test.sh
# Needs `jq` and `git`. It never touches the real repo and never commits: it feeds the hook synthetic
# tool_input on stdin and reads the exit code (0 = allow, 2 = refuse), which is the entire contract a
# PreToolUse hook has with Claude Code.
#
# ⚠️ NOT WIRED INTO CI YET. vitest only collects `src/**/*.test.ts`, so this does not run with
# `npm test`. Running it before changing the hook is currently manual; wiring it in is worth doing,
# because a test nobody runs is the same shape of problem as a check nobody reaches.
set -uo pipefail

HOOK="${HOOK_UNDER_TEST:-$(cd "$(dirname "$0")" && pwd)/second-opinion.sh}"
[ -f "$HOOK" ] || { echo "no hook at $HOOK"; exit 1; }

pass=0; fail=0
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT

# A repo whose state is stated rather than inherited:
#   · one tracked, COMMITTED file
#   · that file then modified but NOT staged  → dirty tracked tree
#   · nothing in the index                    → the state the pathspec hole needs
build_fixture() {
  rm -rf "$FIXTURE"; mkdir -p "$FIXTURE/src/lib"
  git -C "$FIXTURE" init -q
  git -C "$FIXTURE" config user.email t@t.test
  git -C "$FIXTURE" config user.name test
  printf 'original\n' > "$FIXTURE/src/lib/ssrf.ts"
  git -C "$FIXTURE" add src/lib/ssrf.ts
  git -C "$FIXTURE" commit -qm base
  printf 'MODIFIED but unstaged\n' > "$FIXTURE/src/lib/ssrf.ts"
}

stage_something() { printf 'staged\n' > "$FIXTURE/src/lib/other.ts"; git -C "$FIXTURE" add src/lib/other.ts; }

decide() { # decide <command-string> → ALLOW | BLOCK
  printf '%s' "$1" | jq -Rs '{tool_input:{command:.}}' \
    | CLAUDE_PROJECT_DIR="$FIXTURE" bash "$HOOK" >/dev/null 2>&1
  [ $? -eq 0 ] && echo ALLOW || echo BLOCK
}

check() { # check <want> <label> <command-string>
  local want="$1" label="$2" cmd="$3" got
  got=$(decide "$cmd")
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); printf '  ok   %-56s %s\n' "$label" "$got"
  else
    fail=$((fail + 1)); printf '  FAIL %-56s want=%s got=%s\n' "$label" "$want" "$got"
  fi
}

# ── EMPTY INDEX + dirty tracked file: the state the hole lives in ───────────────────────────────
build_fixture
echo "── empty index, dirty tracked file (a pathspec commit would carry unreviewed content) ──"
check BLOCK "pathspec + dirty tree"                     "git commit -m x -- :(literal)src/lib/ssrf.ts"
check BLOCK "pathspec without the -- separator"         "git commit -m x src/lib/ssrf.ts"
check BLOCK "git -C form with a pathspec"               "git -C $FIXTURE commit -m x -- src/lib/ssrf.ts"

echo "── heredoc bodies are message prose; the COMMAND line still is not ──"
check BLOCK "pathspec written AFTER the heredoc marker" \
  "$(printf 'git commit -F - <<MSG -- :(literal)src/lib/ssrf.ts\nbody\nMSG')"
check BLOCK "<<- with a TAB-indented terminator, then a pathspec commit" \
  "$(printf 'git commit -F - <<-MSG\n\tbody\n\tMSG\ngit commit -m x -- :(literal)src/lib/ssrf.ts')"
check BLOCK "a quoted multi-line message that merely CONTAINS <<EOF" \
  "$(printf 'git commit -m "fixed <<EOF\nstill msg" -- :(literal)src/lib/ssrf.ts')"
check BLOCK "line continuation, pathspec on the next line" \
  "$(printf 'git commit -F - <<MSG \\\nMSG\n-- :(literal)src/lib/ssrf.ts')"

echo "── message prose naming real files must NOT be read as pathspecs (false positives get gates switched off) ──"
# Nothing staged and no pathspec on the command line ⇒ nothing to review ⇒ allow.
check ALLOW "heredoc body mentions a tracked path and a lone -a" \
  "$(printf 'git commit -F - <<MSG\nWS: covers src/lib/ssrf.ts, and reverts the -a flag\nMSG')"
# A MULTI-LINE -m value: sed is line-based and cannot strip it, so line 2 used to be parsed as an
# operand and a harmless commit was refused. Only reachable once the pathspec check moved above the
# empty-index exit, which is why it belongs to that change.
check ALLOW "multi-line -m message naming a tracked path" \
  "$(printf 'git commit -m "fix the guard\nsee src/lib/ssrf.ts"')"
check ALLOW "multi-line -m message containing a lone -a" \
  "$(printf 'git commit -m "reverted\nthe -a flag"')"

# ── Staging at commit time defeats a receipt computed from the index ────────────────────────────
build_fixture
echo "── flags that stage or rewrite after the receipt was computed ──"
check BLOCK "-a"                                  "git commit -a -m x"
check BLOCK "-qa (bundled short option)"          "git commit -qa -m x"
check BLOCK "--amend"                             "git commit --amend --no-edit"
check BLOCK "--patch"                             "git commit --patch -m x"
check BLOCK "stage and commit in ONE call"        "git add src/lib/ssrf.ts && git commit -m x"

# ── Staged content with no receipt must be refused ──────────────────────────────────────────────
build_fixture; stage_something
echo "── staged, unreviewed content ──"
check BLOCK "plain commit of a staged, unreviewed diff" "git commit -m x"

# ── Not a commit at all ─────────────────────────────────────────────────────────────────────────
build_fixture
echo "── must NOT block ──"
check ALLOW "a grep that merely mentions the words" "rg 'git commit' docs/"
check ALLOW "a non-commit git subcommand"           "git status --short"

echo
echo "── $pass passed, $fail failed ──"
[ "$fail" -eq 0 ]
