# Cockpit archive — read-only history (retired 2026-07-27)

The multi-agent cockpit ran **2026-07-25 → 2026-07-27**: Alex planned, gated and shipped from
`main`; Kai and Murat implemented in their own worktrees on `work/kai` / `work/murat`. The owner
retired it — *"this experimental work didnt prove itself i will work with 1 agent at a time"*.

**Nothing here is live.** Paths mentioned inside these files (`~/eno-cockpit/TASKS.md`,
`~/eno-cockpit/claim.sh`, `~/eno-kai`, `~/eno-murat`) no longer exist. Do not follow their
instructions; they describe a process that has been shut down. The current protocol is in
CLAUDE.md → "One session at a time".

| File | What it is |
|---|---|
| `TASKS.md` | The final board. The only record of **why** many decisions were made — several rows carry measurements, refuted hypotheses and owner rulings that exist nowhere else. |
| `COORDINATION.md` | The older in-repo board, already superseded by `TASKS.md` before the closure. Kept for its incident log (the `git add -A` scoop-ups, 5550b99b and 72aea9b6). |
| `T336-VERDICT.md` | Kai's diagnosis that the reported native visa/itinerary failure was NOT Turnstile/WebView/CSP, and the naming of the real cause — the `/api/conversations` 500 that became T337. |
| `notes/` | Working notes, including `T337-EVIDENCE.md`: the measured proof that visa and trip threads were colliding on one shared seller. |
| `claims-archive/` | Every completed task claim, with the gates each one passed. |

**Why it was kept:** the board records the reasoning behind shipped behaviour — the 10% fee bound,
the anchor-not-seller thread rule, the itinerary cap — and that reasoning outlives the process that
produced it.
