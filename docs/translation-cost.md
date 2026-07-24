# Translation cost reduction — Google-only plan

Owner, 2026-07-24 (GCP billing screenshot): Google Cloud **Translate is the #2 spend line**
(₫283,688/mo ≈ $11.6, behind only Cloud Run), and **spiking Jul 18–23** (₫23,261 on Jul 23). It
just became material and will grow (live-chat translation adds per-message volume). Directive:
reduce it **without losing quality**, and **"no azure, only google"** — no provider switch.

Planned with both external 2nd opinions (codex GPT-5.6 + Gemini 3.6 Flash). Both independently
converged on the Google-only conclusion below, so staying on Google is not a compromise — it's what
they'd recommend anyway, and it means **zero quality risk** (the engine never changes; Vietnamese
output is byte-identical for anything cached or re-translated by Google). Azure / Gemini-LLM / DeepL
were all evaluated and **dropped** (owner veto + reviewer cautions on quota storms, LLM latency +
prompt-injection, and multi-provider PII exposure).

The strategy is simply: **translate fewer characters on the same engine.**

## Step 0 — ATTRIBUTE THE SPEND (do first; highest ROI, both reviewers)
We have no per-source char attribution, so the Jul spike is unexplained. Add a cheap daily
per-bucket billable-char counter (one small table/KV row per source per day) covering: nightly
UI-dict warm · listing-text warm-at-post · on-demand `/api/translate` misses · iOS content MT ·
chat. Then the next spike is explainable in one query. **Everything below is guessing until this
exists — build it first.**

## Lever 1 — drop EAGER re-warming of low-traffic languages → lazy on-demand + permanent cache
The nightly `warm-translations` cron warms `EAGER_WARM_LANGS = [vi, zh-Hans, ko, ja, ru]` × all
strings. Most language×content combinations are **never viewed**, so pre-warming them is pure paid
waste. Translate on **first real view** and cache forever (public content already caches forever in
the `Translation` table). Keep eager-warming ONLY the languages Step-0 attribution proves are
actually requested at volume. Gemini: "instantly cuts char volume at zero engineering overhead,
preserving Google quality." This is the single biggest concrete lever.

## Lever 2 — never RE-bill a cached string
Audit the warm cron + `/api/translate`: confirm both cache-check before EVERY paid call. A re-warm
that re-translates already-cached strings would, alone, explain the spike. Add a one-line "billable
call" log so a regression is visible in logs.

## Lever 3 — skip trivial before billing
Numbers, pure emoji, URLs, and same-language / same-script text must never reach the paid API. Chat
already skips same-script; extend the guard to the listing/UI warm paths.

## Lever 4 — conservative normalization for cache dedup
Trim + collapse internal whitespace runs so `"Còn hàng "` and `"Còn hàng"` share ONE cache entry.
⚠️ **whitespace ONLY** — both reviewers warn normalization must not alter meaningful formatting,
URLs, prices, or addresses. Gate on a sample that includes those.

## Explicitly NOT doing (both reviewers agree)
- **Chat hashed cache** — low exact-phrase reuse + real privacy questions (guessable source hashes,
  cross-user inference, changes the current no-write posture). Keep chat **ephemeral**; control its
  cost via Lever 3 (it's already same-script-skipped).
- **Gemini-for-chat** — 1–3s latency + prompt-injection from untrusted message text. NMT stays.
- **Any provider switch.** Google only.

## Quality gate
Minimal by construction — the engine doesn't change. The ONLY output-affecting change is Lever 4
(normalization); gate that narrowly (whitespace-only) on a sample including URLs/prices/addresses.

## Ownership / sequencing
Almost entirely backend (`src/lib/translate.ts`, the warm cron, `/api/translate`, instrumentation)
— **Kyle's lane**. ⚠️ **Kyle is mid-flight in `translate.ts` for the chat-translate server lane, so
this cost work QUEUES AFTER that lands** (both edit the same file; no concurrent edits). Murat owns
this plan + the dual-reviews + the attribution query; there is no client piece.

---
## RESULTS — attribution done + first lever SHIPPED (2026-07-24)

**Attribution (Step 0) — done by querying the `Translation` cache directly (no code, no collision):**
30,411 cached strings, ~1.09M value-chars. Key findings:
- **>54% of all translation volume (592K of 1.09M value-chars) goes to 5 low-traffic languages**
  (km/ms/th/fr/hi) — even though the per-listing eager-warm only covers the top 5.
- Long content (descriptions, ≥120 chars) = 419K chars (39%).
- The `@@unique([hash,target])` constraint means the SAME (source,target) is never re-billed —
  so cost is purely NEW (string × language) pairs, i.e. VOLUME, not re-translation. (Lever 2 was
  already handled by the DB.)
- Driver identified: the **daily `warm-translations` cron** was translating every recent listing's
  title/description/location into ALL 11 languages, including the 5 rarely browsed.

**Lever 1 — SHIPPED (`ab14bff3`):** the cron now warms the UI dictionary for all languages but
listing CONTENT only for the top-5 visitor languages; the rare 5 translate listing text on-demand
at view time (PDP already client-translates missing languages, then caches forever). Expected to
remove the bulk of the recurring rare-language listing spend at zero quality change (same Google
engine) — the exact saving will show in next month's bill + the cron's `report` logs (which now
show far fewer `missing`/`healed` for the rare langs). Dual-reviewed (Gemini CONFIRMED; codex
REFUTED a lost dedup → fixed).

**Still open (Kyle's lane, when he's out of translate.ts):** lever 0 as durable CODE (per-source
billable-char counter, so future spikes are attributable without a manual query); lever 3 (skip
trivial before billing on the UI/listing warm paths). Chat stays ephemeral; no provider switch.
