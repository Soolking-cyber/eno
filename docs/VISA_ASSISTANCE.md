# eno.forum Vietnam e-Visa assistance

The complete feature lives in the standalone `Soolking-cyber/eno-forum` repository and the standalone `eno-forum` Vercel deployment. Do not implement or deploy its application code from `eno.vn`.

## Applicant workflow

1. Sign in with the shared Supabase identity.
2. Create an encrypted private draft and upload the passport page and portrait. The upload action starts the disclosed private image check automatically; there is no second confirmation dialog.
3. eno converts supported JPG, PNG, WebP, HEIC, and HEIF inputs into stripped-metadata JPG files under 2 MB. Portraits are placed on a 4×6 canvas; orientation and safe resizing/compression are automatic.
4. AI checks the visible official criteria for both images. Passport OCR transcribes all relevant visible fields, validates ICAO MRZ check digits, and immediately updates the encrypted draft. Unclear values stay empty and the applicant must check the result.
5. Complete fields that do not appear on a passport, confirm accuracy, and send to eno review. A failed or unavailable image check blocks this step until the image passes.
6. If eno finds missing information, it returns the case to the applicant rather than silently changing facts.
7. The applicant reviews the final snapshot and explicitly authorizes official-site prefill.
8. The approved applicant-only answers are fingerprinted. Any later change invalidates browser prefill until the applicant approves again.
9. A trained admin creates a one-use, five-minute browser handoff. The visible browser fills known fields and stops before declaration, Next, CAPTCHA, payment, and submission.
10. eno tracks the government code/status and privately delivers the issued PDF.

The authority—not eno—decides approval. eno must never promise approval or present itself as a government service.

## Production setup

- Apply `supabase/migrations/20260716150000_visa_assistance.sql` and `supabase/migrations/20260716234500_visa_document_validation.sql` to the shared Supabase project. They create RLS-enabled, deny-by-default tables, the private `visa-documents` bucket, and the image-quality submission gate.
- Add `SUPABASE_SECRET_KEY` only to the forum Vercel server environment.
- Generate `VISA_DATA_ENCRYPTION_KEY` with `openssl rand -base64 32`, keep a recovery copy in the organization password manager, and add it only to the forum server environment.
- Set `VISA_ADMIN_EMAILS` to a comma-separated operator allowlist.
- Keep the existing Gemini server credentials for automatic image-quality checks and passport transcription. Upload copy must clearly disclose that processing starts when the applicant uploads.
- Keep Upstash configured. Visa creation, upload, extraction, and submission routes fail closed when the security rate limiter is unavailable.
- Publish the privacy notice, retention period, service price, refund policy, and separate government fee before accepting production applications.
- Set `CRON_SECRET`. The Vercel cron calls `/api/cron/visa-retention` daily and removes private files plus database cases after `retention_until`.

## Admin browser runner

Copy the one-use command from `/admin/visas/:id` and run it from this repository:

```sh
npm run visa:prefill -- https://www.eno.forum/api/visa/prefill/ONE_USE_TOKEN
```

The runner stores source images only in a mode-0600 temporary directory and removes it when the visible browser closes. Selector drift becomes a manual warning. It is never permission to guess, bypass a challenge, or submit.

Operators must check the live requirements and application form at `https://evisa.gov.vn/` for every case because the authority can change fields and rules without notice.

As checked on 2026-07-16, the official form asks for a newly taken 4×6 JPG/JPEG portrait under 2 MB, straight face, no hat or glasses, formal clothes, and white background. It asks for one clear passport biodata page with no missing corners. `VISA_IMAGE_RULES_VERSION` and the dated migration make any later criteria change explicit and auditable.
