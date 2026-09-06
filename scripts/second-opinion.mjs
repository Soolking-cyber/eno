#!/usr/bin/env node
// ── The second-opinion gate ─────────────────────────────────────────────────────────────────────
//
// Runs the external reviewers against the STAGED diff and writes a receipt the pre-commit hook
// checks. Owner, 2026-08-03: "every commit should have a 2nd opinion guard" — because the policy
// already existed in CLAUDE.md and I still skipped it twice in one day. Discipline was the wrong
// mechanism; this makes it structural.
//
//   node scripts/second-opinion.mjs            # review the staged diff, write a receipt
//   node scripts/second-opinion.mjs --status   # is the current staged diff already reviewed?
//
// ⚠️ THE RECEIPT IS BOUND TO THE DIFF'S CONTENT HASH, not to a timestamp or a branch. Amend a
// commit, stage one more file, or change a single character and the hash moves and the receipt no
// longer applies. That is the point: a review of something else is not a review of this.
//
// ⚠️ WHAT COUNTS AS A REVIEW. At least two DISTINCT families must return a parseable verdict.
// One is not enough — the whole reason for the stack is that they fail differently (2026-08-03:
// codex and agy both caught a false-promise bug, but only agy found a US-number misroute and only
// codex found dead code). A reviewer that errors, times out or returns empty is NOT a pass; it is
// recorded as `no-answer` and does not count toward the quorum.
//
// ⚠️ A REFUTED VERDICT DOES NOT BLOCK THE COMMIT, and that is deliberate. Reviewers are wrong about
// a third of the time on this repo (measured), so an automatic block would train the author to
// bypass the gate. What is enforced is that the review HAPPENED and its verdicts are recorded in
// the receipt; judging them stays a human act.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const RECEIPTS = join(ROOT, '.second-opinion')
// Declared up here because `--status` validates receipts long before REVIEWERS is built below.
const REVIEWER_NAMES = ['codex', 'agy', 'fable']

/**
 * ⛔ GENERATED ASSETS ARE EXCLUDED FROM WHAT REVIEWERS *READ*, NEVER FROM WHAT IS *HASHED*.
 * The distinction is the whole safety of this change, so read it before touching either half.
 *
 * The problem it fixes, measured 2026-08-16: staging 47 Lottie emoji animations produced a diff of
 * 1,459 lines but 2,666KB, because minified JSON is ONE line per file — up to 229KB each. Every
 * reviewer CLI rejected it on input size and exited within seconds, so the run scored 0/3 and no
 * receipt could be written. The guard was not refusing a bad change; it was unable to read any
 * change that happened to sit next to a generated asset, which would have pushed the author toward
 * committing outside the session — the one outcome this guard exists to prevent.
 *
 * ⚠️ THE RECEIPT STILL COVERS THE FULL STAGED DIFF. `hash` is computed over the COMPLETE
 * `git diff --cached`, exactly as before, so adding, removing or altering an excluded asset still
 * moves the hash and still invalidates the receipt. Only the TEXT SENT TO THE REVIEWERS is trimmed.
 * A reviewer cannot meaningfully audit 2.6MB of minified animation coordinates anyway — there is no
 * logic in it — so nothing that was previously reviewed has stopped being reviewed.
 *
 * ⚠️ KEEP THIS LIST NARROW AND MACHINE-GENERATED-ONLY. Every path here is one a human never hand
 * edits and a reviewer could never judge. Do not add source directories to make a big refactor
 * easier to land — that IS the bypass this file's header warns about.
 */
const UNREVIEWABLE = [
  ':(exclude)public/emoji/*.json',
  // Self-hosted Tesseract WASM assets for the on-device passport MRZ reader — a third-party minified
  // worker + base64-embedded WASM core + a 3.9MB binary traineddata. Multi-megabyte blobs a reviewer
  // cannot judge and that blow every reviewer CLI's input limit; the .ts adapter that USES them is
  // reviewed normally. Still HASHED (the receipt covers them), only excluded from what reviewers read.
  ':(exclude)public/tesseract/*',
  // Self-hosted OpenCV.js (~9MB) + jscanify for on-device document-edge auto-capture: exclude only the
  // multi-megabyte MINIFIED third-party bundles a reviewer can't judge. The small first-party worker
  // (detect-worker.js) and PROVENANCE.md stay VISIBLE so its message protocol and licensing CAN be
  // reviewed — hiding them made every reviewer flag them as "missing". All still hashed.
  ':(exclude)public/opencv/opencv.js',
  ':(exclude)public/opencv/jscanify.js',
]

/**
 * ⛔ `package-lock.json` WAS ON THIS LIST FOR ONE RUN AND WAS TAKEN OFF. Two reviewers independently
 * called it a blind spot — a hostile dependency could collect a valid receipt without anyone seeing
 * it — and a third then PROVED the cost by reporting a missing `lottie-web` lock entry that was
 * present all along, purely because the exclusion hid it. A lockfile is line-oriented, diffs
 * readably, and is exactly the kind of supply-chain change a second opinion exists to catch.
 * Excluding it optimised for a smaller prompt at the price of the thing being guarded.
 *
 * ⚠️ THE SAME EXCLUSION ALSO MADE A REVIEWER CONCLUDE THE 47 EMOJI FILES WERE MISSING FROM THE
 * COMMIT. They were staged; the reviewer simply could not see them. That is the honest cost of
 * trimming ANY path: a reviewer reasons from what it is shown, so absence reads as omission. Keep
 * this list to files where that trade is unambiguous — generated binary-like blobs with no logic —
 * and expect the occasional "you forgot X" about the excluded paths.
 */

/** The exact content being committed. `--cached` so it matches what the hook will see. */
export function stagedHash() {
  const diff = execFileSync('git', ['diff', '--cached'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const reviewable = execFileSync('git', ['diff', '--cached', '--', '.', ...UNREVIEWABLE], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { diff: reviewable, hash: createHash('sha256').update(diff).digest('hex').slice(0, 16) }
}

const { diff, hash } = stagedHash()

// ⚠️ `--status` VALIDATES THE RECEIPT'S CONTENTS, NOT JUST ITS EXISTENCE. codex caught that this
// used to be a bare `existsSync`: the hook helpfully PRINTS the hash it wants, so `touch
// .second-opinion/<that-hash>.json` was a complete bypass — an empty file certified anything. The
// receipt must name the same hash and record a real full-diff quorum, or it is not a receipt.
// It still is not tamper-PROOF (anyone who can write the file can write plausible JSON); it is
// tamper-EVIDENT, which is the honest goal for a guard whose adversary is my own future shortcut.
if (process.argv.includes('--status')) {
  const path = join(RECEIPTS, `${hash}.json`)
  let ok = false
  let why = 'no receipt'
  if (existsSync(path)) {
    try {
      const r = JSON.parse(readFileSync(path, 'utf8'))
      // ⚠️ DISTINCT, KNOWN FAMILIES — codex noted that counting raw entries let a receipt list the
      // same reviewer twice, or two invented names, and satisfy "two answered". The whole premise of
      // the stack is that these families fail DIFFERENTLY; two of the same one is one review.
      /**
       * ⚠️ ONLY CURRENTLY-KNOWN REVIEWERS COUNT, WHICH MATTERS WHEN THE PANEL CHANGES.
       * Receipts naming a RETIRED reviewer keep working, and that is deliberate rather than lucky.
       * Pre-2026-08-06 receipts list `qwen`; those written 2026-08-14..26 list `fable`. Either one
       * still validates whenever the other two answered (codex + agy = 2, the quorum), and is
       * correctly rejected if the retired name was one of only two verdicts — a review by a
       * reviewer we no longer run is not a review. The cost is re-running the gate on a stale
       * receipt, which is the safe direction. Three reviewers flagged this swap as orphaning the
       * receipt store; it does not, for the reason written here since the qwen retirement.
       */
      const known = new Set(REVIEWER_NAMES)
      const counted = [...new Set((r.reviewers || [])
        .filter((x) => !x.truncated && (x.verdict === 'CONFIRMED' || x.verdict === 'REFUTED'))
        .map((x) => x.name)
        .filter((n) => known.has(n)))]
      if (r.hash !== hash) why = `receipt is for a different diff (${r.hash})`
      else if (counted.length < 2) why = `receipt records only ${counted.length} distinct full-diff verdict(s)`
      else ok = true
    } catch { why = 'receipt is unreadable/corrupt' }
  }
  console.log(ok ? `reviewed (${hash})` : `NOT reviewed (${hash}) — ${why}`)
  process.exit(ok ? 0 : 1)
}

if (!diff.trim()) {
  console.error('Nothing staged — stage the change first, then review it.')
  process.exit(2)
}

// ⚠️ SCAN FOR SECRETS BEFORE SHIPPING THE DIFF TO THREE THIRD PARTIES. qwen raised this reviewing
// the gate itself, and it is the sharpest finding against it: this script sends the ENTIRE staged
// diff to OpenAI (codex), Google (agy) and Anthropic (opus). Sending our SOURCE to them is already
// standing policy — CLAUDE.md mandates these reviewers — but a CREDENTIAL is categorically
// different: it cannot be un-sent, and it would land in three vendors' logs simultaneously.
// The realistic path is not malice, it is a slip: `.env` is gitignored, but a key pasted into a
// config file, a test fixture, or a migration is one `git add` from being staged.
// ⚠️ FAIL CLOSED AND REFUSE TO RUN. Warning and continuing would be worthless — by the time anyone
// reads the warning the diff is already at three vendors.
const SECRET_PATTERNS = [
  [/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key block'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'OpenAI-style secret key'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  // Assignment of a long opaque value to an obviously-secret name. Scoped to ADDED lines and to
  // real assignment syntax, so prose mentioning "secret" does not trip it.
  [/^\+.*(SECRET|PASSWORD|PRIVATE_KEY|CLIENT_SECRET|API_KEY|ACCESS_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9/+_@!#$%^&*-]{16,}/m, 'secret-looking assignment'],
]
if (process.env.SECOND_OPINION_SKIP_SECRET_SCAN !== '1') {
  const hits = SECRET_PATTERNS.filter(([re]) => re.test(diff)).map(([, label]) => label)
  if (hits.length) {
    console.error(`⛔ REFUSING TO SEND THIS DIFF TO EXTERNAL REVIEWERS — it looks like it contains: ${hits.join(', ')}.`)
    console.error('   codex, agy and opus are third-party services; a credential sent to them cannot be recalled.')
    console.error('   Remove the value from the staged content (git reset the file, move it to Secret Manager via')
    console.error('   scripts/secret-set.sh), then re-run. If this is a FALSE POSITIVE — a fixture, a public key, a')
    console.error('   sample in documentation — re-run with SECOND_OPINION_SKIP_SECRET_SCAN=1 and say so out loud.')
    process.exit(2)
  }
}

// ⚠️ THE PROMPT ASKS THEM TO REFUTE, NOT TO "REVIEW". Measured repeatedly on this repo: an
// open-ended "what do you think" returns architecture opinions, while "here is a claim, break it"
// returns defects. The verdict-first, word-capped shape is what stops codex burning a whole run
// exploring without ever reaching an answer.
const prompt = `Answer ONLY from the diff below. Do NOT read files, search the web, or explore the repo.
Your FIRST line MUST be \`VERDICT: CONFIRMED\` or \`VERDICT: REFUTED\`. Then one paragraph of why, then
your findings as a numbered list, most severe first. Whole answer <=450 words.

This is a production Vietnamese marketplace (eno.vn) plus a second edition (eno.forum) built from ONE
codebase; a leak of visa/itinerary/payment surfaces onto eno.vn is a LICENSING failure, not a bug.
Auth is passwordless. Trust scores are public and consumer-facing.

THE CLAIM TO REFUTE: "This staged diff is correct, complete, and safe to commit. It introduces no
regression, no security or licensing hole, no dangling state, and nothing that only breaks for a
user in a state the author did not test."

Prefer concrete failure modes ("a signed-in user at exactly 1024px sees no logo") over style notes.
If the diff is insufficient to judge, say INSUFFICIENT and name what is missing.

STAGED DIFF:
${diff}`

mkdirSync(RECEIPTS, { recursive: true })

// ⚠️ NO PROMPT FILE ANY MORE. The full staged diff used to be written to
// `.second-opinion/.prompt-<hash>.txt` because qwen took the prompt as a PATH rather than on stdin.
// qwen was replaced on 2026-08-06 and every remaining reviewer takes stdin, so that file had no
// reader — it was writing the entire source diff to disk on every commit and relying on an exit
// handler to unlink it. A temp file nobody reads is pure liability: it survives a SIGKILL, and the
// cleanup path for it was itself the source of two earlier bugs.

// ⚠️ CLEANUP BELONGS ON `exit`, NOT ON THE HAPPY PATH — I got this wrong TWICE and agy caught it
// both times, which is why it is now structural instead of another well-placed call.
//   1st: the escalation SIGKILL was `.unref()`ed, so it never fired.
//   2nd: un-unref'ing fixed the SUCCESS path only. On the quorum-failure path `process.exit(1)` runs
//        immediately, tearing down the event loop and the pending 3s SIGKILL with it — so exactly
//        when reviewers had timed out (the case that CREATES orphans) nothing reaped them.
// A handler on 'exit' runs on every terminating path, including process.exit() and an uncaught
// throw, and it is synchronous — which is precisely what killing a pid and unlinking a file need.
// SIGINT/SIGTERM are routed through the same handler so Ctrl-C during a 5-minute review reaps the
// reviewer PROCESS TREES rather than orphaning three of them to keep burning quota in the
// background. It no longer unlinks anything — the prompt file it used to clean up is gone (see
// above) and the receipt is written synchronously at the very end, so an interrupted run simply
// never writes one. (An earlier version of this comment still claimed file cleanup; caught by the
// opus reviewer on the very commit that removed it.)
const CHILDREN = new Set()
process.on('exit', () => {
  for (const pid of CHILDREN) { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }
})
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

// ⚠️ agy TAKES THE PROMPT AS AN ARGV STRING, which the OS caps (ARG_MAX). agy flagged this
// reviewing its own invocation: a big enough diff makes spawn fail with E2BIG, agy silently becomes
// 'no-answer', and the quorum quietly drops to two. Truncating keeps it answering on a large diff
// and says so inside the prompt, rather than failing in a way that looks like silence.
//
// ⚠️ BUT A TRUNCATED REVIEW DOES NOT COUNT TOWARD THE QUORUM, and this is the subtler half — agy and
// qwen independently caught it. The receipt is keyed to the hash of the FULL staged diff, so an agy
// that only saw the first 180KB would still have its verdict certify bytes it never read. On a
// codebase where the failure mode is a visa/PayPal surface leaking onto the licensed marketplace,
// "reviewed" must mean the reviewer saw the licensing-relevant hunk — which, in a big diff, is as
// likely to be at the end as the start. codex and opus BOTH take the prompt on stdin and so both
// get the whole thing, which is what keeps the quorum reachable; agy's truncated verdict is
// recorded but deliberately not counted.
const AGY_LIMIT = 180_000
const agyTruncated = prompt.length > AGY_LIMIT

const REVIEWERS = [
  { name: 'codex', lab: 'openai', cmd: 'codex', args: ['exec', '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=high', '-c', 'web_search=disabled', '--skip-git-repo-check', '--sandbox', 'read-only'], stdin: true },
  /**
   * A SECOND OpenAI SEAT ON A DIFFERENT GENERATION — owner, 2026-09-06: "add codex gpt 6 astra too".
   *
   * ⚠️ THE MODEL ID IS `gpt-6-astra`, VERIFIED AGAINST THE CLI RATHER THAN GUESSED. `gpt-6`,
   * `gpt-6a` and `astra` are all accepted by `codex exec` and all print "Model metadata for `X` not
   * found. Defaulting to fallback metadata; this can degrade performance" — the run still happens,
   * on a mis-specified model, and the only sign is a warning nobody reads in a 300-second review.
   * Probe a new id with a one-word prompt before pinning it here.
   *
   * ⛔ IT IS A SEAT, NOT A FAMILY — AND THE QUORUM LINE DOES NOT KNOW THAT. Read this before
   * trusting a number below. `answered.length` and `counted.length` count ENTRIES in this array;
   * nothing here carries a lab, so the line that prints "N families answered" is misnamed and
   * always has been. Adding astra therefore inflates it: a 4/4 is FOUR SEATS across THREE labs
   * (OpenAI ×2, Google, Anthropic), and a 2-2 split can be two OpenAI seats against Google plus
   * the author's own cousin — which is one lab disagreeing with two, not an even split.
   * ⚠️ THIS IS WORSE PAST agy's 180KB CUTOFF, where agy stops counting and the certifying panel is
   * codex + astra + fable: two seats from one lab plus a cousin of the author. On a diff that big,
   * weigh the labs yourself.
   * ⚠️ AND IT DOUBLES THE OpenAI SPEND per review, which is the cost the owner accepted for a
   * second generation's eyes.
   */
  { name: 'astra', lab: 'openai', cmd: 'codex', args: ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=high', '-c', 'web_search=disabled', '--skip-git-repo-check', '--sandbox', 'read-only'], stdin: true },
  {
    name: 'agy',
    lab: 'google',
    cmd: 'agy',
    truncated: agyTruncated,
    // ⚠️ `--print-timeout` MUST SIT ABOVE agy's OWN RUNTIME AND BELOW OUR BOUND. It was 240s, and
    // measured across four runs agy takes 219s, 224s, 245s, 246s — a distribution the deadline cut
    // straight through. The two runs under 240s answered; the two over it were recorded as
    // `no-answer` and dropped the quorum, once to 1/3, which REFUSED A CORRECT COMMIT. agy was
    // working fine each time; the flag killed it.
    // 400s keeps it under the 420s harness bound ON PURPOSE: agy gets to report its own failure
    // before we SIGKILL the process group, which is the difference between a diagnosable error and
    // silence. Whenever TIMEOUT_MS changes, this must stay below it.
    args: ['-p', agyTruncated ? prompt.slice(0, AGY_LIMIT) + '\n\n[DIFF TRUNCATED at 180KB for argv limits — judge only what is shown]' : prompt, '--model', 'Gemini 3.8 Flash (High)', '--dangerously-skip-permissions', '--print-timeout', '400s'],
  },
  /**
   * ⛔ THE THIRD SEAT'S HISTORY, KEPT BECAUSE IT IS THE ARGUMENT FOR THE CURRENT PANEL.
   *
   * qwen held it until 2026-08-06, when it began returning HTTP 403 — "The free quota has been
   * exhausted" — on every run for a full day. Every review in that period was 2/3 rather than 3/3:
   * a reviewer that cannot answer is not a reviewer, and the gate was correctly refusing to count
   * it, which pinned the quorum at its minimum. It was replaced by `opus`.
   *
   * `opus` then held it until 2026-08-14 and was removed when `fable` arrived (owner: "remove opus
   * since we added fable"). That is the right call and it RESTORES something the opus seat had
   * cost: opus is the same family as the author of the code under review, so the panel had been
   * OpenAI + Google + Anthropic-reviewing-Anthropic. CLAUDE.md's reviewer policy exists precisely
   * because "an Opus review of Opus code shares its blind spots". Swapping it for fable rather than
   * ADDING fable kept three seats and three distinct families.
   * ⚠️ THAT SENTENCE DESCRIBES 2026-08-14, NOT TODAY. As shipped the seat is opus again, so it is
   * three seats and TWO families — see the note at the end of this block.
   *
   * `fable` then held it until 2026-08-26, when the owner asked for opus back. THIS SEAT HAS NOW
   * BEEN qwen -> opus -> fable -> opus, so read the paragraph above as live history rather than as
   * a settled argument: the reason opus was removed on 2026-08-14 has not changed, it has been
   * OVERRULED, and the cost is worth stating plainly where the swap lives.
   *
   * ✅ AND ON 2026-08-30 THE OWNER SWITCHED IT BACK TO FABLE — "also use fable 5 as 3rd opnion
   * instead of opus". So the seat has now been qwen -> opus -> fable -> opus -> fable, and this
   * swing restores the property the paragraph below is about: fable is the same LAB as the author,
   * not the same MODEL, so a 3/3 is two independent families agreeing plus a cousin rather than the
   * author nodding at itself. Read the warning below as the reason this switch was right.
   *
   * ⛔ THE OPUS SEAT WAS THE SAME MODEL AS THE AUTHOR OF THE CODE IT REVIEWS. Not merely the same
   * lab, which is what fable was — the same model. CLAUDE.md's reviewer policy exists because "an
   * Opus review of Opus code shares its blind spots", and that is maximally true here. What still
   * makes the seat worth having: it runs in a FRESH context with no memory of why the code was
   * written, and it is prompted to REFUTE a specific claim rather than to review — measured on this
   * repo, that framing is most of where the signal comes from. What it can no longer be relied on
   * for is catching the class of mistake the author is systematically prone to.
   * ⚠️ SO A 3/3 IS NOW TWO INDEPENDENT FAMILIES AGREEING, NOT THREE. codex (OpenAI) and agy (Google)
   * are the seats that can surprise you. If the two of them split and opus sides with the author,
   * that is not a majority — go and measure.
   */
  /**
   * FOURTH SEAT (owner, 2026-08-14). The owner first asked for `freebuff` here; it was measured and
   * rejected on three grounds, recorded so nobody re-tries it: it has no non-interactive mode (its
   * only flags are `login`, `--continue`, `--cwd`), piping a prompt to it returns a full-screen
   * ANSI TUI rather than text, and it refuses to start twice — "only one freebuff instance is
   * allowed at a time" — which a panel that runs its members IN PARALLEL cannot satisfy. A reviewer
   * that cannot answer is not a reviewer, and this gate is built to treat silence as a failure, so
   * adding it would have quietly lowered the quorum. (It was also ad-supported with training
   * retention, which is a different data posture from the other three for a script that ships our
   * source to third parties.) freebuff was uninstalled the same day.
   *
   * ⚠️ IT REPLACED opus RATHER THAN JOINING IT (owner, same day), which is why the panel is three
   * seats and not four — see the note on the seat above for why that is the better shape.
   * `--effort max` is the point of using it at all; `--permission-mode plan` keeps it read-only, so
   * it answers from the pasted diff and cannot edit, run or commit anything.
   *
   * ⚠️ THE BUDGET NOTE BELOW WAS ABOUT fable, and opus is not budget-limited the same way — but the
   * operational half still holds exactly as written, for any seat: with
   * three reviewers a silent opus drops the panel to codex + agy, which is the quorum MINIMUM.
   * If opus starts failing the way qwen did, do not leave it in place: that is exactly the failure
   * this file has already lived through once.
   *
   * ✅ BACK TO fable ON 2026-08-23 (owner: "add back the Fable 5 as a second opinion instead of
   * opus 5") — and ⛔ BACK TO opus AGAIN ON 2026-08-26, at the owner's request. THE SEAT AS SHIPPED
   * IS opus; read this whole block as a log, not as the current answer, and check REVIEWER_NAMES
   * and the spec below for what actually runs.
   * The objection the paragraphs here spend themselves making still stands on the merits — it has
   * been overruled, not answered — which is why none of it is deleted: the trade has now been made
   * in both directions twice, and the record is the only thing that makes the next proposal
   * cheaper to think about than the last one.
   *
   * ⛔ THE SEAT WENT TO opus ON 2026-08-22, AND THE HISTORY ABOVE IS THE ARGUMENT AGAINST IT.
   * Read it before assuming this is settled. The owner first asked for `oxalpha` — a cloaked model
   * reached through the opencode CLI — which would have made the panel three genuinely separate
   * labs for the first time and, being free and unmetered, would have retired the budget worry in
   * the paragraph above. It was built, guarded and tested, then abandoned the same day for a flatly
   * practical reason: **opencode holds no API credentials here and the owner has none** ("dont have
   * api so drop opencode use opus 5 for 3rd"). A reviewer that cannot authenticate cannot answer,
   * and this file's whole doctrine is that such a seat must not be left in place pretending.
   *
   * ⚠️ AND THE BUDGET WORRY ABOVE IS INHERITED, NOT SOLVED — the opus seat caught this reviewing
   * its own installation. Opus at `--effort max` over a whole diff is not cheaper than fable; the
   * free-and-unmetered property was oxalpha's, and it left with oxalpha. If this seat starts going
   * quiet, budget is the first thing to check, exactly as it was before.
   *
   * ⚠️ THE BLIND-SPOT COST WHILE opus HELD IT WAS THE LARGEST IT HAS EVER BEEN. The main thread that
   * writes this code is Opus; the seat was also Opus. Not merely the same lab, as with fable —
   * the same model. CLAUDE.md's reviewer policy exists because "an Opus review of Opus code shares
   * its blind spots", and opus was removed from this very seat on 2026-08-14 for that reason. The
   * panel is now TWO independent families plus a same-model checker.
   * ⛔ THAT IS NO LONGER THE STANDING SITUATION, but the reading it forced is still worth keeping:
   * when the two non-Anthropic seats agree and the Anthropic one dissents, weight the dissent.
   * fable is a different model from the author, which is why this seat is worth having at all — it
   * is still the same lab, so a unanimous 3/3 is two families agreeing, not three. If a third
   * independent family ever becomes reachable — an OpenRouter key, an opencode login — take it.
   */
  {
    name: 'fable',
    lab: 'anthropic',
    cmd: 'claude',
    // ⚠️ `--permission-mode plan` IS THE SANDBOX and is not decorative: it keeps this reviewer
    // read-only, so it answers from the diff on stdin and cannot edit, run or commit anything.
    // ✅ FABLE 5.1 since 2026-09-02 (owner). The prior id was `claude-fable-5`; `claude-fable-5-1`
    // is accepted by the current CLI (2.1.258 — already latest, no upgrade was needed).
    args: ['-p', '--model', 'claude-fable-5-1', '--effort', 'max', '--permission-mode', 'plan'],
    stdin: true,
  },
]

// ⚠️ EVERY REVIEWER IS HARD-BOUNDED. Measured 2026-08-03: this script sat for 46 MINUTES on a
// 485-line diff because codex never reached a verdict, and `Promise.all` printed nothing at all
// while it hung — agy and qwen had answered in ~90s and their findings were held hostage. That is
// the exact codex failure mode CLAUDE.md already documents ("burning an entire run without ever
// reaching a verdict"), and it is fatal HERE specifically: this gate blocks every commit, so a gate
// that can hang forever is a gate that gets bypassed within a day. An unbounded wait is never
// correct — the same lesson as the CI-poll trap.
// ⚠️ 420s, NOT 300s — TUNED FROM MEASUREMENT, NOT TASTE. Observed qwen wall-times across four
// runs on this repo: 233s, 267s, 278s, >300s. A 300s bound sat inside its normal distribution, so
// the gate started reporting `no-answer` for a reviewer that was working fine, the quorum dropped
// to 1, and a correct commit was refused. A bound that fires on healthy runs is as damaging as no
// bound: one blocks good work, the other lets a 46-minute hang through. This must stay comfortably
// above the SLOWEST healthy reviewer while still killing a genuine hang.
const TIMEOUT_MS = Number(process.env.SECOND_OPINION_TIMEOUT_MS || 420_000)

// ⚠️ KILL THE PROCESS GROUP, NOT THE PROCESS. `codex` is a node wrapper that spawns a vendored
// darwin binary as a SEPARATE pid; killing the wrapper orphans the child, which keeps running,
// keeps burning quota, and holds the pipe open. Measured during the 46-minute hang: killing the
// wrapper left the vendor binary alive. `detached: true` puts each reviewer in its own group so
// `kill(-pid)` reaps the whole tree.
const run = (r) =>
  new Promise((resolve) => {
    const started = Date.now()
    const p = spawn(r.cmd, r.args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    if (p.pid) CHILDREN.add(p.pid)
    let out = ''
    let err = ''
    let done = false
    const finish = (verdict, text) => {
      if (done) return
      done = true
      clearTimeout(timer)
      // Only drop it from the reap set once it has genuinely exited. A TIMED-OUT reviewer resolves
      // here while its process may still be alive ignoring SIGTERM — that is the one we must keep
      // tracking, so removal is done by the 'close' handler below, never by finish().
      const secs = Math.round((Date.now() - started) / 1000)
      console.log(`  ${r.name}: ${verdict} (${secs}s)${r.truncated ? ' ⚠️ TRUNCATED — does not count toward quorum' : ''}`)
      // ⛔ CARRY `lab`. Adding it to REVIEWERS but not here made the whole lab quorum inert: every
      // `r.lab` downstream was undefined, `r.lab ?? r.name` fell back to the seat name, and the
      // gate printed "4 lab(s)" for three — a single-lab panel would have satisfied a two-lab
      // minimum. Three reviewers caught it and the gate's own output confirmed it in one run.
      resolve({ name: r.name, lab: r.lab ?? r.name, verdict, truncated: !!r.truncated, text })
    }
    const reap = (sig) => { try { process.kill(-p.pid, sig) } catch { try { p.kill(sig) } catch {} } }
    const timer = setTimeout(() => {
      reap('SIGTERM')
      // SIGTERM is a request; a wedged reviewer can ignore it. Escalate rather than leak the tree.
      // ⚠️ THIS TIMER MUST STAY REFERENCED. It was `.unref()`ed for one revision and agy caught the
      // consequence: `finish()` resolves immediately, so once every reviewer has settled the script
      // runs to completion and exits — destroying an unref'd timer BEFORE it fires. The SIGKILL
      // would never have been sent, and a reviewer that ignores SIGTERM would outlive the gate as a
      // detached orphan burning quota. Keeping it referenced holds the loop open the extra 3s,
      // which is the entire cost of not leaking a process tree.
      setTimeout(() => reap('SIGKILL'), 3000)
      finish('no-answer', `timed out after ${Math.round(TIMEOUT_MS / 1000)}s`)
    }, TIMEOUT_MS)
    p.stdout.on('data', (d) => (out += d))
    // ⚠️ KEEP STDERR. This was `() => {}` — discarded — and it made the harness unable to explain
    // its own failures: when agy came back `no-answer` twice, the logs held nothing but a duration,
    // and the cause had to be inferred from wall-times. A tool whose job is diagnosing other tools
    // must not throw away their error output. Bounded to the last 2KB so a chatty reviewer cannot
    // balloon memory, and surfaced on the no-answer path where it is the only clue there is.
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000) })
    p.on('error', (e) => finish('no-answer', `spawn failed: ${e.message}`))
    p.on('close', () => {
      if (p.pid) CHILDREN.delete(p.pid) // genuinely exited — nothing left to reap
      // Take the LAST line-anchored verdict: codex echoes the prompt (which contains the word
      // VERDICT) before answering, so a naive first-match reads our own instructions back.
      const m = [...out.matchAll(/^VERDICT: (CONFIRMED|REFUTED)/gm)]
      if (m.length) return finish(m[m.length - 1][1], out.slice(-4000))
      // ⚠️ NO VERDICT: SAY WHY, LOUDLY. This is the branch that silently dropped the quorum and
      // refused a correct commit. Whatever the reviewer wrote to stderr — and the tail of what it
      // wrote to stdout — is the only evidence of the cause, so both go into the receipt.
      finish('no-answer', [
        `exited without a parseable VERDICT after ${Math.round((Date.now() - started) / 1000)}s`,
        err.trim() && `stderr: ${err.trim()}`,
        out.trim() && `stdout tail: ${out.trim().slice(-1200)}`,
      ].filter(Boolean).join('\n'))
    })
    if (r.stdin) { p.stdin.write(prompt); p.stdin.end() } else { p.stdin.end() }
    p.stdin.on('error', () => {}) // a reviewer that dies mid-write must not crash the gate with EPIPE
  })

console.log(`Reviewing staged diff ${hash} (${diff.split('\n').length} lines) with ${REVIEWERS.length} families…`)
const results = await Promise.all(REVIEWERS.map(run))

for (const r of results) {
  const mark = r.verdict === 'no-answer' ? '✗ NO ANSWER' : r.verdict
  console.log(`\n──────── ${r.name}: ${mark} ────────`)
  if (r.verdict !== 'no-answer') {
    const i = r.text.search(/^VERDICT: /m)
    console.log(r.text.slice(i, i + 2500))
  } else {
    // ⚠️ PRINT THE FAILURE. A silent "NO ANSWER" is how a broken reviewer stays broken for four
    // runs — which is exactly what happened to agy here.
    console.log(r.text || '(no output captured)')
  }
}

// ⚠️ QUORUM COUNTS ONLY REVIEWERS THAT SAW THE WHOLE DIFF — see the AGY_LIMIT note above.
const answered = results.filter((r) => r.verdict !== 'no-answer')
const counted = answered.filter((r) => !r.truncated)
/**
 * ⛔ SEATS AND LABS ARE COUNTED SEPARATELY, BECAUSE THEY ARE NOT THE SAME NUMBER AND THIS LINE USED
 * TO PRETEND THEY WERE. It printed "N families answered" while counting entries in REVIEWERS, which
 * was harmless while every seat was a different lab and became a lie the moment `astra` joined
 * `codex` at OpenAI: a 4/4 read as four independent families when it is three, and a 2-2 split can
 * be two OpenAI seats against Google plus Anthropic — one lab outvoting two. Reviewers flagged the
 * mismatch on three consecutive runs; documenting it was not the same as fixing it.
 * ⚠️ THE LAB COUNT IS THE ONE THAT MEANS ANYTHING. fable shares a lab with the author of most diffs
 * here, so even 3 labs is 2 independent families plus a cousin — which is the panel this repo has
 * deliberately chosen, and the reason the seat count must not be allowed to flatter it.
 */
const labsAnswered = new Set(answered.map((r) => r.lab)).size
const labsCounted = new Set(counted.map((r) => r.lab)).size
console.log(`\n${answered.length}/${REVIEWERS.length} seats answered across ${labsAnswered} lab(s) — ${counted.length} seat(s) / ${labsCounted} lab(s) saw the full diff.`)
// ⛔ THE ONE PLACE THE opus SEAT IS ACTIVELY DANGEROUS, AND IT IS INVISIBLE WITHOUT THIS LINE.
// Found by the opus seat reviewing its own installation, which is the most useful thing it has done.
// agy's verdict does not count past AGY_LIMIT, so on a big diff the counted panel is codex + seat 3.
// With fable that was two non-author models. With opus it is GPT plus THE SAME MODEL THAT WROTE THE
// DIFF — self-review becomes half the quorum, exactly when the diff is too big to eyeball and the
// licensing-relevant hunk is most likely to be buried in the tail. Nothing here blocks that; a gate
// that refuses large diffs outright would just get bypassed. But it must not pass QUIETLY.
if (agyTruncated) {
  console.log('\n⛔ THIS DIFF IS OVER 180KB, SO agy DOES NOT COUNT — the panel that certified it is')
  console.log('   codex + opus, and opus is the SAME MODEL that wrote the change. Half of this quorum')
  console.log('   is a self-review. Read the licensing-relevant hunks yourself before trusting it, or')
  console.log('   split the change until agy can see all of it.')
}

// ⚠️ THE RECEIPT IS WRITTEN ONLY AFTER THE QUORUM HOLDS — AND THIS ORDER IS THE GATE.
// It was the other way round for exactly one run, and qwen caught it reviewing this very file:
// writing first meant a run where every reviewer errored STILL produced a receipt the hook accepts,
// so the guard would have rubber-stamped precisely the case it exists to catch. A gate whose
// failure mode is "pass" is worse than no gate, because it also removes the suspicion.
/**
 * ⛔ THE QUORUM IS LABS, NOT SEATS. Two OpenAI seats are one independent opinion twice over; letting
 * them satisfy a two-family minimum would mean a diff certified by a single lab, which is exactly
 * the property this gate exists to guarantee against.
 */
if (labsCounted < 2) {
  console.error(`⚠️  Only ${labsCounted} lab(s) reviewed the FULL diff (${counted.length} seat(s)) — that is NOT a passed`)
  console.error('    review, and NO receipt was written. A truncated or errored reviewer does not count.')
  console.error('    Fix the reviewer (missing binary? no key? rate limited?) and re-run.')
  process.exit(1)
}
// ⚠️ THE RECEIPT KEEPS THE FINDINGS, not just the verdicts. codex caught that a REFUTED receipt with
// no text let a commit proceed while leaving no durable record of what a human was meant to verify —
// the terminal scrollback is not a record. The findings are what the next person needs when this
// commit is the suspect six weeks from now.
writeFileSync(join(RECEIPTS, `${hash}.json`), JSON.stringify({
  // ⚠️ `quorum` STAYS THE SEAT COUNT so older receipts remain comparable; `labs` is the number that
  // actually gates, and a reader six weeks from now needs to see both to judge what certified this.
  hash, lines: diff.split('\n').length, quorum: counted.length, labs: labsCounted,
  // `lab` per seat, not only the total: a receipt read six weeks from now must show WHICH labs
  // certified this without mapping seat names back by hand.
  reviewers: results.map(({ name, lab, verdict, truncated, text }) => ({ name, lab, verdict, truncated, findings: text })),
}, null, 2))
/**
 * ⚠️ THE VETO IS PER SEAT AND THE QUORUM IS PER LAB, AND THAT ASYMMETRY IS DELIBERATE. A reviewer
 * pointed out that OpenAI now holds two vetoes but one vote. That is the right way round: a REFUTED
 * is a FINDING, and a finding is true or false on its own merits regardless of who else shares its
 * lab — this line only decides whether a human must read the receipt before committing, which the
 * answer should always be when any seat objects. The quorum is the opposite question, "did enough
 * INDEPENDENT eyes see this", and there two seats from one lab genuinely are one pair of eyes.
 */
if (answered.some((r) => r.verdict === 'REFUTED')) {
  console.log('⚠️  At least one REFUTED. Read the findings above and VERIFY each by measuring before')
  console.log('    acting — on this repo roughly a third of reviewer claims do not survive checking.')
}
console.log(`Receipt written: .second-opinion/${hash}.json — the commit hook will accept this diff.`)
