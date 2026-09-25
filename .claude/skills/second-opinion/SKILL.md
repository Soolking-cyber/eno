---
name: second-opinion
description: How to actually invoke the external reviewers (antigravity/agy and codex gpt-5.6-sol) — exact CLI flags, the anti-exploration prompt preamble, and the failure modes that produce a silent non-review. Load when dispatching a second opinion at plan or diff time.
---

# Invoking the external reviewers

⏸ **codex is PAUSED since 2026-09-25 (owner: "drop codex till available" — OpenAI quota exhausted).** Dispatch agy + Opus only until the owner restores it; never sleep waiting for a quota reset. The gate still needs both to answer; over 180KB it refuses (split the change).

The POLICY — second opinion mandatory at BOTH plan and finished diff, ask them to REFUTE rather
than review, and a reviewer that did not answer is NOT a passed review — lives in the root
`CLAUDE.md` and stays there. This file is only the mechanics.

⛔ **THE OpenAI SEAT IS BACK — owner, 2026-09-24: _"add gpt astra 6 sol medium reasoning as 2nd
opinion from codex"_, then _"which has normal token consumption and good reasoning needs a balance"_.**
Measured on the same real refute-prompt at medium: `gpt-6-astra` 19,302 tokens / 22 s, `gpt-5.6-sol`
9,881 tokens / 21 s, same verdict and same core findings. **The seat is `gpt-5.6-sol` at
`model_reasoning_effort=medium`.** Exact line (prompt on stdin):
`codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium -c web_search=disabled --skip-git-repo-check --sandbox read-only < prompt.txt`
(The 2026-09-23 removal, and any "do not dispatch codex" below, is history. Where a line below says
`model_reasoning_effort=high`, use medium.)

⚠️ **TWO EXTERNAL FAMILIES AGAIN — agy (Google) and codex (OpenAI).** Opus writes most of these diffs
and shares their blind spots, so it never stands in for them. When only ONE of agy/codex returned a
VERDICT, say "single-sourced" out loud; when neither did, the work has had no independent review.

⛔ **A MODEL ID THAT ERRORS TELLS YOU NOTHING ABOUT ONE THAT DOES NOT.** A parallel session probed
`gpt-astra-6-sol`, `astra-6-sol` and `gpt-6-sol`, got errors on all three, and concluded the astra
family was gone — while `gpt-6-astra` exists and is what the measurement above was run against.
⚠️ And codex accepts an UNKNOWN id with only a "fallback metadata" warning, then runs on a
mis-specified model, so an id that "works" is not evidence either. Probe it, read the banner, and
confirm a real VERDICT came back before pinning it.

**How to invoke the external reviewers (read-only, non-interactive):**
- **codex** — pipe the prompt via STDIN, never as an argument (the arg form hangs waiting on stdin).
  ⚠️ **CODEX WASTES ITS RUN EXPLORING UNLESS YOU FORBID IT.** Seen repeatedly (2026-07-21..23):
  given a read-only sandbox it greps node_modules and web-searches for the whole run and never
  reaches a verdict. Two fixes, use BOTH:
  · **Constrain the run**: add `-c web_search=disabled --skip-git-repo-check` and keep
    `--sandbox read-only`, so it cannot burn the budget searching the web or walking the tree.
    Full line — ⚠️ `medium` since 2026-09-24 (owner's instruction), re-verified that day to return a
    VERDICT in seconds; the `high` in the older lines below is the pre-restore effort:
    `codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium -c web_search=disabled --skip-git-repo-check --sandbox read-only < prompt.txt`
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
  **Owner-set invocation — `medium` since 2026-09-24** (it was `high` from 2026-07-21; medium is current):
  `echo "<review prompt>" | codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium -c web_search=disabled --skip-git-repo-check --sandbox read-only`
  (or heredoc into stdin). ⚠️ **Verify the banner echoes `reasoning effort: medium`** — it said `high`
  here until 2026-09-24, and an operator checking against that stale line would "fix" the effort
  upward, which is exactly what CLAUDE.md now forbids.
  ⚠️ The 2026-07-21 quote of this command carried no `web_search=disabled` / `--skip-git-repo-check`;
  they are added above because the bullet directly overhead says to use BOTH, and a bare "use exactly
  this" without them is how this reviewer spends a run exploring instead of answering.
- **antigravity** — `agy -p "<prompt>" --model gemini-3.8-flash-high --dangerously-skip-permissions --print-timeout 300s`.
  ⚠️ **EITHER FORM WORKS — AND A `invalid model selection` ERROR IS NOT THE MODEL NAME.** On
  2026-09-23 a dispatch died with *"model Gemini 3.8 Flash (High) is not recognized as a known
  model"*; the error also printed `--effort ""`. Both the display name (which
  `scripts/second-opinion.mjs` passes, successfully, on every gate run) and the slug
  `gemini-3.8-flash-high` were then re-tested and BOTH answered. So the failure was transient:
  **retry rather than rewriting the model name.** `agy models` prints slug + display name if you
  need to confirm one. With the OpenAI seat removed, an agy that does not answer means NO
  independent review happened — never treat it as a pass. ⚠️ If it returns
  *"a tool required the command permission that headless mode cannot prompt for"*, it produced NOTHING —
  that is not a review. Re-run with `--dangerously-skip-permissions` (it is read-only anyway) or add an
  allow-rule. Seen 2026-07-22. Feed the file CONTENT inline in the
  prompt (its agentic file-reading mode times out on `--print-timeout`); use `--print-timeout 240s`.
- **opus** (the panel's third seat) —
  `claude -p --model claude-opus-5-5 --effort high --permission-mode plan < prompt.txt` (Opus 5.5 at high — owner, 2026-09-25), prompt on
  **stdin** so it sees the whole diff and counts toward quorum. `--permission-mode plan` is the
  sandbox: read-only, cannot edit or run anything.
  ⛔ **fable held this seat until 2026-09-09 and is now OUT OF BUDGET** — owner: *"change back to
  opus 2nd opinion from fable we are out of tokens"*. Do not dispatch `fable-reviewer` or
  `claude-fable-5-1` until the owner says the budget is back.
  ⚠️ **Same lab AND the same model as the main thread.** This seat is now the author reviewing
  itself, so a unanimous 3/3 is codex + agy agreeing plus a self-check — treat any codex or agy
  dissent as the signal and go and measure. fable at least differed as a model; opus does not.
  ⛔ **On a diff over 180KB agy does not count**, so the counted panel becomes codex + opus — i.e.
  ONE non-author reviewer. At that size call the gate single-sourced out loud rather than 2/2. The
  script prints a warning when that happens; do not ignore it.
  ⚠️ THIS SEAT IS OPUS SINCE 2026-09-09, AND THE OLD BUDGET WARNING BELONGED TO FABLE. The line
  here used to say "budget-limited, check budget before config" — true of fable, not of Opus, and
  aimed at the wrong cause for whoever debugs the next silent seat (the Opus seat, on its own diff).
  A silent seat still drops the panel to its quorum minimum, which is the qwen failure this file
  records; the thing to check first is now the CLI and the config, not a budget.
  ⛔ A cloaked `oxalpha` via the opencode CLI was built and abandoned 2026-08-22: opencode holds no
  credentials and there is no API key. The traps found are in [[opencode-reviewer-sandbox]] if it
  ever comes back.
- Dispatch them **directly and in PARALLEL** as background jobs — never sequenced, never wrapped in an Opus
  subagent that shells out on their behalf.

In a `Workflow`, pass `model` and `effort` per `agent()` call for the Opus/Fable fan-out, and shell out to
`codex exec` / `agy -p` from inside agents (or the main thread) for the two external families. Cross-family
verification is the highest-value use: find with one family, have the others try to refute.
