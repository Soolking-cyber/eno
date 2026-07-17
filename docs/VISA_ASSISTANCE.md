# eno.forum Vietnam e-Visa assistance

The complete feature lives in the standalone `Soolking-cyber/eno-forum` repository and the standalone `eno-forum` Vercel deployment. Do not implement or deploy its application code from `eno.vn`.

## Applicant workflow

1. Sign in with the shared Supabase identity.
2. Create an encrypted private draft and upload the passport page and portrait. The upload action starts the disclosed private image check automatically; there is no second confirmation dialog.
3. eno converts supported JPG, PNG, WebP, HEIC, and HEIF inputs into stripped-metadata JPG files under 2 MB. Portraits are placed on a 4×6 canvas; orientation and safe resizing/compression are automatic.
4. AI checks the visible official criteria for both images. Passport OCR transcribes all relevant visible fields, validates ICAO MRZ check digits, and immediately updates the encrypted draft. Unclear values stay empty and the applicant must check the result.
5. Complete fields that do not appear on a passport, confirm accuracy, authorize private official-form prefill, and submit the complete application once. A failed or unavailable image check blocks this step until the image passes.
6. If eno finds missing information, it returns the case to the applicant rather than silently changing facts.
7. The declaration and prefill authorization are recorded against the same applicant-approved snapshot. There is no routine second approval round; eno contacts the applicant only when something must be corrected.
8. The approved applicant-only answers are fingerprinted. Any later applicant change invalidates browser prefill until the changed snapshot is approved again.
9. A trained admin reviews both images directly inside the case dashboard and chooses **Approve and open official form**. That single action records admin approval, launches the hosted browser, uploads the approved images, and fills matching official fields without requiring the repository or a designated trusted computer.
10. Browser recording, session logs, and automatic CAPTCHA solving are disabled. The admin reviews every field and personally handles declarations, CAPTCHA, payment, and final submission.
11. eno tracks the government code/status and privately delivers the issued PDF.

The authority—not eno—decides approval. eno must never promise approval or present itself as a government service.

## Production setup

- Apply `supabase/migrations/20260716150000_visa_assistance.sql` and `supabase/migrations/20260716234500_visa_document_validation.sql` to the shared Supabase project. They create RLS-enabled, deny-by-default tables, the private `visa-documents` bucket, and the image-quality submission gate.
- Add `SUPABASE_SECRET_KEY` only to the forum Vercel server environment.
- Generate `VISA_DATA_ENCRYPTION_KEY` with `openssl rand -base64 32`, keep a recovery copy in the organization password manager, and add it only to the forum server environment.
- `support@eno.forum` is the primary built-in operator identity. Set `VISA_ADMIN_EMAILS` only when additional trained operator emails are required.
- Create a Browserbase project on a paid plan that supports keep-alive sessions. Add `BROWSERBASE_API_KEY` to the forum server environment and, when the API key cannot infer it, add `BROWSERBASE_PROJECT_ID`.
- Create one private Browserbase context for the visa operator and add its ID as `BROWSERBASE_CONTEXT_ID`. The operator signs in through the live browser once when the official site requires authentication; encrypted cookies and login state can then continue into later sessions. Never place a government password or one-time code in forum environment variables. Use only one active session with that shared context at a time, and sign in again when the authority expires it.
- Browser sessions run in `ap-southeast-1`, open the official `evisa.gov.vn` form, disable recording/logging/CAPTCHA automation, and expire after 30 minutes. Live-view URLs are sensitive and must never be copied into support tickets or logs.
- Keep the existing Gemini server credentials for automatic image-quality checks and passport transcription. Upload copy must clearly disclose that processing starts when the applicant uploads.
- Keep Upstash configured. Visa creation, upload, extraction, and submission routes fail closed when the security rate limiter is unavailable.
- Publish the privacy notice, retention period, service price, refund policy, and separate government fee before accepting production applications.
- Set `CRON_SECRET`. The Vercel cron calls `/api/cron/visa-retention` daily and removes private files plus database cases after `retention_until`.

## Admin submission workflow

1. Sign in to `https://www.eno.forum/admin/visas` as `support@eno.forum`.
2. Review the applicant-approved answers and both verified images directly in the dashboard; select either image to enlarge it without leaving the case. Return incomplete or ambiguous cases to the applicant before continuing.
3. The applicant has already accepted the current hosted-browser disclosure for this exact snapshot. Choose **Approve and open official form**; no routine message or second applicant approval is needed.
4. That one action approves the reviewed case and creates a private 30-minute Browserbase session, transfers the approved images directly from private storage, opens the official form, and fills all safely matched fields. If browser creation fails, the case stays in review.
5. Use the live browser to compare every value against the applicant-approved panel. The case lists selector drift and structured fields that still require manual completion instead of guessing.
6. Personally complete the government declarations and CAPTCHA, continue to the payment option offered by the official page, submit, and copy the government registration code back into the eno case. If the official payment page presents a QR, the operator may scan it with MoMo on the phone; eno does not assume that every government payment flow supports MoMo.
7. Choose **End browser session** as soon as the official submission is complete. Mark the case submitted/processing and later upload the official result PDF for private delivery.

The previous repository-local Playwright runner is retained only for emergency development diagnostics; it is not the production operator workflow. Hosted prefill is never permission to guess facts, bypass a challenge, accept a declaration, pay, or submit without human review.

Operators must check the live requirements and application form at `https://evisa.gov.vn/` for every case because the authority can change fields and rules without notice.

As checked on 2026-07-16, the official form asks for a newly taken 4×6 JPG/JPEG portrait under 2 MB, straight face, no hat or glasses, formal clothes, and white background. It asks for one clear passport biodata page with no missing corners. `VISA_IMAGE_RULES_VERSION` and the dated migration make any later criteria change explicit and auditable.
