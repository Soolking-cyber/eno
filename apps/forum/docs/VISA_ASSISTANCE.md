# Vietnam e-Visa assistance

## Ownership — eno.vn owns the whole feature (owner, 2026-07-21)

**The Vietnam e-Visa service belongs to eno.vn (the repository root), end to end:** the
applicant flow, AI passport extraction, payments, the direct-message experience, and the
admin/operator queue. Build every visa change under `src/**`. **`apps/forum` must not gain
new visa surfaces.**

This reverses the earlier rule in this file, which said the complete feature lived in
`apps/forum` and that its server routes must not be placed in the root application. That
rule described an intermediate state and stopped being true once eno.vn grew its own
applicant engine (`src/app/api/visa/**`, `src/lib/visa/**`), its own wizard
(`src/app/dashboard/visa/**`) and the payment step, which `apps/forum` never had.

Both apps read and write the **same** Supabase tables (`visa_applications`,
`visa_documents`, `visa_events`, `visa_prefill_sessions`) and the same private
`visa-documents` bucket, so an application started on either site is visible on the other.
That is what makes an incremental retirement possible — and what makes leaving both
applicant UIs live indefinitely dangerous (see *Split-brain risks*).

The visa admin identity is **`support@eno.vn`** — the constant in
`apps/forum/src/lib/visa/auth.ts:5` and the real Supabase admin account. Any
`support@eno.forum` in an env file or doc is stale.

The code still under `apps/forum/**` is a **temporary legacy runtime, not dead code**: two
capabilities exist only there. **Do not delete any of it** until the owner has signed off
the inventory below. Ownership is *declared* today; it is not *operationally* complete
until steps 2–6 of the order of operations are done — until then the forum deployment is
still load-bearing, and saying otherwise in a doc or a commit message is wrong.

## Where each capability lives today

| Capability | eno.vn (root) | apps/forum |
|---|---|---|
| Applicant wizard | `src/app/dashboard/visa/**` (current) | `src/app/visa` + `src/components/visa/visa-assistant.tsx` (older twin) |
| Applicant API (draft/upload/extract/submit) | `src/app/api/visa/applications/**` | same paths, older |
| Service-fee payment (Stripe/PayPal) | ✅ `checkout` + `payment/confirm` + `src/lib/visa/payments.ts` | ❌ none |
| Admin queue + case view | ✅ `src/app/admin/visas/**` | `src/app/admin/visas/**` |
| Hosted-browser operator prefill (Browserbase) | ❌ none | ✅ `src/lib/visa/hosted-prefill.ts` + admin `prefill-session` + `api/visa/prefill/[token]` |
| Retention deletion cron | ❌ none | ✅ `src/app/api/cron/visa-retention` — **the only deletion code anywhere** |
| Table/bucket migrations | ❌ none | ✅ `supabase/migrations/2026071615…`, `…2026071623…` |
| e2e coverage | ❌ none | ✅ `e2e/visa.spec.ts` |

## Applicant workflow

1. Sign in with the shared Supabase identity.
2. Create an encrypted private draft and upload the passport page and portrait. The upload action starts the disclosed private image check automatically; there is no second confirmation dialog.
3. eno converts supported JPG, PNG, WebP, HEIC, and HEIF inputs into stripped-metadata JPG files under 2 MB. Portraits are placed on a 4×6 canvas; orientation and safe resizing/compression are automatic.
4. AI checks the visible official criteria for both images. Passport OCR transcribes all relevant visible fields, validates ICAO MRZ check digits, and immediately updates the encrypted draft. Unclear values stay empty and the applicant must check the result. The server records an `ai_extraction_needs_review` marker on the case, plus the list of field names the AI filled, so the applicant can be asked to acknowledge (or correct) exactly those.
5. Complete fields that do not appear on a passport, confirm accuracy, authorize private official-form prefill, and submit the complete application once. A failed or unavailable image check blocks this step until the image passes.
6. When the eno service fee is configured (`VISA_SERVICE_FEE_USD` plus at least one provider), submission runs through checkout first: the case stays the applicant's private draft until the provider confirms payment, and the hand-off to review is completed **server-side** (`markVisaPaidAndHandoff`). With no fee or no provider keys the payment step is dormant and submission behaves exactly as in step 5.
7. If eno finds missing information, it returns the case to the applicant rather than silently changing facts.
8. The declaration and prefill authorization are recorded against the same applicant-approved snapshot. There is no routine second approval round; eno contacts the applicant only when something must be corrected.
9. The approved applicant-only answers are fingerprinted. Any later applicant change invalidates browser prefill until the changed snapshot is approved again.
10. A trained admin reviews both images directly inside the case dashboard and chooses **Approve and open official form**. That single action records admin approval, launches the hosted browser, uploads the approved images, and fills matching official fields without requiring the repository or a designated trusted computer.
11. Browser recording, session logs, and automatic CAPTCHA solving are disabled. The admin reviews every field and personally handles declarations, CAPTCHA, payment, and final submission.
12. eno tracks the government code/status and privately delivers the issued PDF.

The authority—not eno—decides approval. eno must never promise approval or present itself as a government service.

## Production setup

- Apply `supabase/migrations/20260716150000_visa_assistance.sql` and `supabase/migrations/20260716234500_visa_document_validation.sql` to the shared Supabase project. They create RLS-enabled, deny-by-default tables, the private `visa-documents` bucket, and the image-quality submission gate. These two files stay where they are (an applied migration is never deleted or moved), but **new visa DDL belongs to eno.vn** from now on.
- Add `SUPABASE_SECRET_KEY` only to server environments (never a client bundle).
- Generate `VISA_DATA_ENCRYPTION_KEY` with `openssl rand -base64 32`, keep a recovery copy in the organization password manager, and add it only to server environments. ⚠️ **While both apps are live, this key must be identical in both** — the forum's operator prefill decrypts payloads that eno.vn encrypted. Rotating it in one environment alone breaks prefill immediately and makes existing drafts unreadable.
- `support@eno.vn` is the primary built-in operator identity. Set `VISA_ADMIN_EMAILS` only when additional trained operator emails are required.
- Create a Browserbase project on a paid plan that supports keep-alive sessions. Add `BROWSERBASE_API_KEY` to the operator app's server environment and, when the API key cannot infer it, add `BROWSERBASE_PROJECT_ID`.
- Create one private Browserbase context for the visa operator and add its ID as `BROWSERBASE_CONTEXT_ID`. The operator signs in through the live browser once when the official site requires authentication; encrypted cookies and login state can then continue into later sessions. Never place a government password or one-time code in environment variables. Use only one active session with that shared context at a time, and sign in again when the authority expires it.
- Browser sessions run in `ap-southeast-1`, open the official `evisa.gov.vn` form, disable recording/logging/CAPTCHA automation, and expire after 30 minutes. Live-view URLs are sensitive and must never be copied into support tickets or logs.
- Keep the existing Gemini server credentials for automatic image-quality checks and passport transcription. Upload copy must clearly disclose that processing starts when the applicant uploads.
- The security rate limiter is Supabase-Postgres backed (the Upstash dependency was removed 2026-07-20). The stance is unchanged and load-bearing: visa creation, upload, extraction, submission, and the prefill-token claim **fail closed** when the limiter is unavailable.
- Publish the privacy notice, retention period, service price, refund policy, and separate government fee before accepting production applications.
- Set `CRON_SECRET`. A daily scheduled job calls `/api/cron/visa-retention` and removes private files plus database cases after `retention_until`. ⚠️ **That job currently exists only on the forum service.** eno.vn writes `retention_until` but has no deletion code, so retention depends entirely on the forum deployment staying alive until the cron is ported (migration step 2 below).

## Admin submission workflow

1. Sign in to the operator console as `support@eno.vn`. Two consoles exist during the migration: **eno.vn `/admin/visas`** is the canonical queue (it shows status, documents, the audit trail and the payment stamp), and the forum `/admin/visas` is the only one that can launch hosted prefill. The eno.vn case view renders applicant payload contents only when `VISA_DATA_ENCRYPTION_KEY` is present in eno.vn's server environment; without it the queue still works but the answers panel stays empty by design.
2. Review the applicant-approved answers and both verified images directly in the dashboard; select either image to enlarge it without leaving the case. Return incomplete or ambiguous cases to the applicant before continuing.
3. The applicant has already accepted the current hosted-browser disclosure for this exact snapshot. Choose **Approve and open official form**; no routine message or second applicant approval is needed.
4. That one action approves the reviewed case and creates a private 30-minute Browserbase session, transfers the approved images directly from private storage, opens the official form, and fills all safely matched fields. If browser creation fails, the case stays in review.
5. Use the live browser to compare every value against the applicant-approved panel. The case lists selector drift and structured fields that still require manual completion instead of guessing.
6. Personally complete the government declarations and CAPTCHA, continue to the payment option offered by the official page, submit, and copy the government registration code back into the eno case. If the official payment page presents a QR, the operator may scan it with MoMo on the phone; eno does not assume that every government payment flow supports MoMo.
7. Choose **End browser session** as soon as the official submission is complete. Mark the case submitted/processing and later upload the official result PDF for private delivery.

The previous repository-local Playwright runner is retained only for emergency development diagnostics; it is not the production operator workflow. Hosted prefill is never permission to guess facts, bypass a challenge, accept a declaration, pay, or submit without human review.

Operators must check the live requirements and application form at `https://evisa.gov.vn/` for every case because the authority can change fields and rules without notice.

As checked on 2026-07-16, the official form asks for a newly taken 4×6 JPG/JPEG portrait under 2 MB, straight face, no hat or glasses, formal clothes, and white background. It asks for one clear passport biodata page with no missing corners. `VISA_IMAGE_RULES_VERSION` and the dated migration make any later criteria change explicit and auditable.

## Migration plan — inventory of every forum visa surface

⛔ **Nothing in this table has been deleted, and nothing may be deleted without the owner
reading this list first.** Retiring a live route is irreversible for anyone mid-application.

| # | Surface | What it does | Recommendation |
|---|---|---|---|
| 1 | `src/app/visa/page.tsx` + `src/components/visa/visa-assistant.tsx` (848 lines) | Public, **indexable** `/visa` page embedding the older applicant wizard | **Keep the page, retire the embedded wizard.** Turn it into a marketing page whose CTA points at eno.vn. Never 404 it — it has organic traffic and in-flight drafts behind it. |
| 2 | `src/app/api/visa/applications/**` | Applicant CRUD, upload, extract, submit (older twin of eno.vn's) | **Retire after a drain period.** Removing the wizard (#1) stops *new* forum drafts; it does not protect the ones already open in a browser tab or linked from an email. Leave these routes serving for a defined drain window after #1 flips, then retire. The underlying rows are shared, so a drained applicant continues on eno.vn with the same draft. |
| 3 | `src/app/api/visa/admin/applications/[id]/route.ts` | Admin status transitions + payload edits (decrypts) | **Retire** once eno.vn's admin actions cover the same transitions *and* eno.vn's deployed env has the encryption key. |
| 4 | `src/lib/visa/hosted-prefill.ts` (329) + `admin/applications/[id]/prefill-session` + `scripts/visa-prefill.mjs` | Browserbase + Playwright operator prefill of `evisa.gov.vn` | **Keep (forum-only) or port last — owner's call.** No eno.vn equivalent exists. It needs the long-timeout backend service and a paid Browserbase plan; porting it is the largest single piece of work here. |
| 5 | `src/app/api/visa/prefill/[token]/route.ts` | One-time token that returns the **decrypted PII payload** + signed document URLs to the operator's browser | **Moves with #4, never separately.** Highest-risk endpoint in the feature: one claimed token yields passport plaintext. Keep its strict rate limit and `no-store` headers wherever it lives. |
| 6 | `src/app/api/visa/admin/applications/[id]/result/route.ts` | Operator records the government code and uploads the result PDF | **Port to eno.vn** with the admin queue (small), then retire the forum copy alongside #3. |
| 7 | `src/app/api/cron/visa-retention/route.ts` | ⚠️ **The only code anywhere that deletes expired applications and their storage objects** | **Port to eno.vn FIRST**, before anything else is retired, and move the scheduled job to the eno.vn domain. Losing it means passport PII is kept past `retention_until` — a data-protection failure, not a feature regression. |
| 8 | `src/app/admin/visas/**` + `src/components/visa/visa-admin-case.tsx` | Forum operator console | **Keep until #4 is resolved** (it is the only UI that can launch hosted prefill), then retire in favour of eno.vn `/admin/visas`. |
| 9 | `src/lib/visa/{schema,crypto,mrz,checkpoints,image-quality,image-normalization,storage,records,db}.ts` | Duplicated engine; six of these are **sync-paired** to the eno.vn copies | **Retire with #2/#3.** ⚠️ Drop each pair from `src/lib/sync-pairs.test.ts` in the **same commit** that deletes the forum file — that test reads both paths off disk and fails the root suite if one disappears. **Interim rule:** until then, an eno.vn edit to `mrz` · `image-quality` · `image-normalization` · `checkpoints` · `schema` · `crypto` **must be mirrored into the forum copy in the same commit**. Mirroring an existing paired file is maintenance, not a new forum surface — it is the one sanctioned exception to "no new visa surfaces in `apps/forum`". Prefer putting new visa logic in files that are *not* paired so the exception stays rare. |
| 10 | `src/lib/visa/{auth,types,workflow}.ts` | Forum-only helpers; holds `VISA_SUPPORT_ADMIN_EMAIL` | **Retire with #8**; move the admin-email constant into eno.vn when the last forum visa route goes. |
| 11 | `e2e/visa.spec.ts` (183) | The only automated visa coverage in the repo | **Port to an eno.vn spec before retiring.** eno.vn has no visa e2e today; deleting this leaves the feature untested. |
| 12 | `supabase/migrations/20260716150000_visa_assistance.sql`, `20260716234500_visa_document_validation.sql` | DDL for the visa tables, the private bucket, and the validation gate | **Keep in place permanently** (applied migrations are history). Future visa DDL is authored on the eno.vn side. |

### Order of operations

1. **Docs + decree** (this change). No code moves.
2. **Port the retention cron** to eno.vn, point the scheduled job at the eno.vn domain, and verify one real deletion run. Only after this is the forum deployment non-load-bearing for compliance.
3. **Confirm `VISA_DATA_ENCRYPTION_KEY` in eno.vn's deployed environment** (it is present in the local root `.env`; several eno.vn source comments still claim it is forum-only and are stale). This lights up the payload panel in eno.vn's admin console.
4. **Make eno.vn the applicant entry point**: forum `/visa` becomes marketing + CTA, and the eno.vn footer link (`src/components/marketplace/footer.tsx`, "Vietnam e-Visa help" → `${FORUM_URL}/visa`) is repointed at the eno.vn flow.
5. **Port e2e (#11) and the result route (#6)**, then retire the forum applicant/admin routes (#2, #3, #9, #10) together with their `sync-pairs` entries.
6. **Decide hosted prefill (#4/#5) last** — keep it forum-side or port it, with the owner.

### Split-brain risks while both applicant UIs are live

- **Schema divergence.** The two wizards write the same rows through different code. Add a required field on the eno.vn side and the older forum wizard will submit payloads that fail validation — for forum organic traffic only, which is exactly the traffic nobody is watching. This is the main argument for doing step 4 sooner rather than later.
- **Two admin consoles.** An operator acting in the forum console on a case created by the newer engine can transition or rewrite it with older assumptions. Treat eno.vn `/admin/visas` as the queue of record; use the forum console only to run hosted prefill.
- **Key rotation.** `VISA_DATA_ENCRYPTION_KEY` must be rotated in both environments simultaneously or not at all (see *Production setup*).
- **Identity drift.** `apps/forum/.env.example` still sets `VISA_ADMIN_EMAILS=support@eno.forum`. That address is not the admin account; fix it wherever it is deployed.
- **Separate operator sessions.** Admin cookies do not cross `eno.vn` ↔ `eno.forum`, so signing in to one console does not sign you in to the other. An operator can be authorized in one app and bounced from the other purely by session state — sign in to each explicitly rather than assuming an authorization problem.
- **Rate limits do NOT need re-checking** (verified 2026-07-21): both apps use the identical namespaces and quotas (`visa-create` 5/24h, `visa-update` 120/h, `visa-document` 20/h, `visa-image-analysis-v2-hour|day`, `visa-submit` 20/h, `visa-delete` 10/24h) keyed by the same user id, and since the Upstash→Postgres migration both hit one shared store — so there is no cross-domain quota bypass today. Keep them identical if either side is edited.
- **Retention windows.** The forum cron scans `visa_applications` globally, not per app, so it already covers cases created on eno.vn. That is the only reason coexistence is currently compliant — and the reason step 2 is first.
