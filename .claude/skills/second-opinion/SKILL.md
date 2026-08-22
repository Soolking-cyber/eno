---
name: second-opinion
description: How to actually invoke the external reviewers (codex, antigravity/agy) — exact CLI flags, the anti-exploration prompt preamble, and the failure modes that produce a silent non-review. Load when dispatching a second opinion at plan or diff time.
---

# Invoking the external reviewers

The POLICY — second opinion mandatory at BOTH plan and finished diff, ask them to REFUTE rather
than review, and a reviewer that did not answer is NOT a passed review — lives in the root
`CLAUDE.md` and stays there. This file is only the mechanics.

**How to invoke the two external reviewers (both read-only, non-interactive):**
- **codex** — pipe the prompt via STDIN, never as an argument (the arg form hangs waiting on stdin).
  ⚠️ **CODEX WASTES ITS RUN EXPLORING UNLESS YOU FORBID IT.** Seen repeatedly (2026-07-21..23):
  given a read-only sandbox it greps node_modules and web-searches for the whole run and never
  reaches a verdict. Two fixes, use BOTH:
  · **Constrain the run**: add `-c web_search=disabled --skip-git-repo-check` and keep
    `--sandbox read-only`, so it cannot burn the budget searching the web or walking the tree.
    Full line, verified 2026-07-23 to return a VERDICT in seconds:
    `codex exec -m gpt-5.6-sol -c model_reasoning_effort=high -c web_search=disabled --skip-git-repo-check --sandbox read-only < prompt.txt`
  · **Constrain the PROMPT** — open with this preamble verbatim:
    *"Answer ONLY from the code pasted below. Do NOT read files, do NOT search the web, do NOT
    explore the repo — everything you need is inline. Your FIRST line MUST be `VERDICT: CONFIRMED`
    or `VERDICT: REFUTED`, then one paragraph of why, then each numbered question in ≤3 sentences.
    Whole answer ≤400 words. If the pasted code is insufficient, reply `INSUFFICIENT: <what is
    missing>` — do not go looking for it."*
  A verdict-first, word-capped, no-exploration prompt is the difference between codex answering and
  codex timing out. On 2026-07-23 codex STILL produced no verdict on the scroll-rail bug (63KB of
  node_modules reading) while Gemini answered — but Gemini's proposed fix, tested on the finished
  job, FAILED (a MutationObserver fires before layout, so it read a stale scrollWidth); the
  `watch`-in-deps fix passed. That is the whole rule in one episode: get a verdict from at least one
  family, then TEST what it tells you rather than trusting it.
- **Strong-debugger escalation.** When a bug survives one plausible fix, do not guess again at the
  same altitude — hand it to `deep-debugger` (Opus, xhigh) or the `codex:codex-rescue` subagent with
  the full repro and what was already ruled out. The scroll-rail root cause fell out in minutes once
  framed as "arrows work on the server-seeded rail, not the async-fetched one — why?" instead of
  another blind edit.
  **Owner-set invocation (2026-07-21) — use exactly this:**
  `echo "<review prompt>" | codex exec -m gpt-5.6-sol -c model_reasoning_effort=high --sandbox read-only`
  (or heredoc into stdin). Verify the banner echoes `model: gpt-5.6-sol` / `reasoning effort: high`.
- **antigravity** — `agy -p "<prompt>" --model "Gemini 3.1 Pro (High)"`. ⚠️ If it returns
  *"a tool required the command permission that headless mode cannot prompt for"*, it produced NOTHING —
  that is not a review. Re-run with `--dangerously-skip-permissions` (it is read-only anyway) or add an
  allow-rule. Seen 2026-07-22. Feed the file CONTENT inline in the
  prompt (its agentic file-reading mode times out on `--print-timeout`); use `--print-timeout 240s`.
- **opus** (the panel's third seat since 2026-08-22, replacing fable) —
  `claude -p --model claude-opus-5 --effort max --permission-mode plan < prompt.txt`, prompt on
  **stdin** so it sees the whole diff and counts toward quorum. `--permission-mode plan` is the
  sandbox: read-only, cannot edit or run anything.
  ⛔ **THIS SEAT IS THE SAME MODEL AS THE MAIN THREAD, SO WEIGHT IT ACCORDINGLY.** opus was removed
  from this seat on 2026-08-14 because "an Opus review of Opus code shares its blind spots", and it
  is back only because the intended third family (`oxalpha` via opencode) needs an API key the owner
  does not have. A unanimous 3/3 is worth less than it reads; when codex and agy agree and opus
  dissents, weight the dissent.
  ⛔ **On a diff over 180KB agy does not count, so the counted panel becomes codex + opus — half of
  it a self-review.** The script prints a warning when this happens. Do not ignore it.
  ⚠️ Distinct from the `fable-reviewer` SUBAGENT in `.claude/agents/`, which still runs Fable 5 and
  is a different mechanism — a Claude Code subagent cannot be pointed at a non-Claude model.
- Dispatch them **directly and in PARALLEL** as background jobs — never sequenced, never wrapped in an Opus
  subagent that shells out on their behalf.

In a `Workflow`, pass `model` and `effort` per `agent()` call for the Opus/Fable fan-out, and shell out to
`codex exec` / `agy -p` from inside agents (or the main thread) for the two external families. Cross-family
verification is the highest-value use: find with one family, have the others try to refute.
