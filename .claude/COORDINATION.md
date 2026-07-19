# Multi-session coordination board

Two or more Claude Code sessions often work this repo **in the same worktree**.
This file is the live claims board. Protocol (also in CLAUDE.md, "Parallel
sessions"):

1. **Before starting a work item**: read this file + TaskList. Claim your item
   here (edit the table) and set the task's owner. Pick tasks the other
   session hasn't claimed.
2. **Stage explicitly — NEVER `git add -A` at the repo root.** The 5550b99b
   incident: a blanket add scooped another session's mid-flight edit and
   shipped a broken intermediate to main. Stage the exact files you changed
   (hook-generated files like src/generated/ui-strings.ts belong to whoever
   triggered the regeneration).
3. **Before committing**: `git status` — anything dirty outside your claim is
   the other session's; leave it unstaged. If HEAD moved since your gates ran,
   re-run tsc before pushing.
4. **Release your claim** (update the row) when the item lands.

**Names (owner, 2026-07-19): the two workers are KYLE and MURAT** — assigned by the
cockpit launcher (`~/eno-cockpit.sh`, wired into the SessionStart hook; it also keeps
the two second-opinion terminals, Codex and Agy, open). At session start run
`echo $ENO_SESSION` to learn which one you are; sign this board with that name.

| Session (started) | Claim | Files / area | Status |
|---|---|---|---|
| **Kyle** (worker #1 — ex-A, audit lane) | Task #113 — structural extractions + §G perf + lint-zero | listings-explorer + extracted seams, forum-client rails/use-forum-feed, admin perf files, providers.tsx | **COMPLETE + RELEASED** (75043dda, f15dc2af, aa55d767, 9341756c, be385a0a, a3359f50 api-listings split, 0b98ce4a post-wizard split). Task #113 closed; nothing left unclaimed from the audit |
| **Murat** (worker #2 — ex-B, migration lane) | Task #114 — GCP cutover + SEO follow-ups | Cloudflare zones, gcloud infra, docs/gcp-migration.md, forum next.config, sitemap/robots/footer/metadata files | CUTOVER COMPLETE: BOTH domains on GCP, ingress locked (run.app 404s — use domains for smoke/e2e), crons on domain URLs; **Vercel DECOMMISSIONED 2026-07-19** (owner waived soak; projects eno + eno-forum deleted, sdc-shop kept; RESEND_API_KEY live v6) |
| **Kyle** (cont.) | Branded email layer (owner ask: logo + app-design emails) | src/lib/emails/* (new layout.ts, weekly-digest refactor), src/lib/mail.ts untouched | **DONE + RELEASED** — renderBrandEmail shell (real logo.png wordmark, card, CTA, legal footer); digest refitted; preview sent to owner via Resend; use the layout for every future email |
| **HANDOFF → Murat** (Cloudflare MCP) | BIMI + DMARC for the email sender logo (owner ask) | eno.vn zone DNS only. Add TXT `default._bimi` = `v=BIMI1; l=https://eno.vn/bimi-eno.svg;` (SVG ships in Kyle's commit). Upgrade TXT `_dmarc` from p=none → p=quarantine — SAFE: all @eno.vn mail is Resend (send.eno.vn return-path = Resend's SES), DKIM-aligned. Note for owner: Gmail's avatar specifically needs a paid VMC cert + registered trademark; BIMI shows in Yahoo/Fastmail/others now, DMARC upgrade helps deliverability everywhere | **DONE (Murat)** — BIMI TXT live; `_dmarc` → `v=DMARC1; p=quarantine; rua=mailto:support@eno.forum`. ⚠️ DEVIATION from spec: rua was `support@eno.vn` but eno.vn has NO MX — reports would bounce; repointed to the real PrivateEmail mailbox + added the required external-destination TXT `eno.vn._report._dmarc.eno.forum` = `v=DMARC1` on the forum zone. SVG verified tiny-ps/title/no-scripts, serves 200. All 3 records read back from authoritative zone |
| **Kyle** (cont.) | #116 Perf Phase 1 (owner brief) — ⚠️ **UNCOMMITTED BY DESIGN, DO NOT STAGE/SWEEP** | 21 modified + 4 new files: next.config (inlineCss off, cacheHandler), capacitor.config (splash 3s), home page + explorer + rails (SSR-seeded ForYou/Business, deferred CategoryRails), listing-card/skeleton, header/mobile-nav/cookie-consent (prefetch), account-panel split (+account-panel-body.tsx), native-bootstrap (reveal-first), currency/area/explorer idle gates, 4 API cache headers, eslint ignores, docs/perf-phase1.md | **WORK COMPLETE, stopped before commit per the brief** — owner reviews then commits. Results: LCP 5.39s→1.32s, CLS 0.142→0.002, HTML 876→351KB, prefetches 22→0; lint 0 / vitest 185 / build ✓ / guest e2e 53 ✓ / gradle debug ✓ |
| **HANDOFF → Murat** (Cloudflare MCP) | #115: EDGE_SECRET pairing + cache rules | (a) ORDER MATTERS: first create a Cloudflare Transform Rule (Modify Request Header) on the eno.vn zone, hosts eno.vn+www: set header `x-eno-edge` = the value of GCP secret `eno-edge-secret` (read: `gcloud secrets versions access latest --secret=eno-edge-secret`); THEN merge `EDGE_SECRET=<same value>` into eno-root-env (next version) + redeploy eno-vn — proxy.ts starts 403-ing /api/* without the header the moment the env lands (crons//api/v1/feeds/sms-hook exempt by path). This closes the direct-LB-IP spoof hole. (b) Cache Rule: `/_next/image*` → cache eligible, respect origin TTL (hashed /_next/static already caches by extension). | **DONE (Murat)** — ⚠️ rulesets API unauthorized for the MCP OAuth token (read AND write) → owner created both rules in the DASHBOARD (transform "eno edge pin" + cache "cache next-image"); EDGE_SECRET live in root env **v9** (rev eno-vn-00034). VERIFIED: via-CF /api → 401 (own auth, pin passed); direct-LB /api → **403 (spoof hole closed)**; exempt /api/v1 direct → 401 (own auth); pages direct → 200; /_next/image cf-cache-status MISS→HIT respecting origin TTL |
| **Murat** (cont.) | support@ migration: mailbox + admin identity | Cloudflare Email Routing (support@eno.vn → support@eno.forum, FREE), DMARC rua repoint, root v8 + forum v3 (BOTH allowlists = eno.vn,eno.forum), forum visa auth constant (890d69a4), Supabase admin email flipped IN PLACE to support@eno.vn (same uid, google identity survives) | **COMPLETE + RELEASED** — verified: authed admin 200 as support@eno.vn. ⚠️ INCIDENT during env rollout: deploy-by-TAG (0b98ce4) clobbered the newer cache-handler image (rev 00030) — caught + restored by DIGEST (rev 00032). RULE: env-only redeploys must reuse the SERVING digest (`gcloud run services describe --format='value(spec.template.spec.containers[0].image)'`), never a remembered tag |
| **Murat** (cont.) | Vercel remnants purge + AI-503 fix | vercel.json (delete), .claude/skills/ship/SKILL.md, eno-root-env secret (GOOGLE_VERTEX_CREDENTIALS was quote-mangled → sh sourcing dropped it → all /api/ai/* 503; re-encoded base64) | **COMPLETE + RELEASED** (36517bb5 + secret v7 + revision 00022; CI build green; verified live: ai-health probe.ok + authed classify 200; ⚠️ new standing rule in [[eno-gcp-migration]]: dotenv secret values must be sh-safe — JSON creds go base64) |
