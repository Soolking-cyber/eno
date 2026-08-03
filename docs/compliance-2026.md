# eno.vn — 2026 E-commerce Compliance Architecture

**Status:** design specification, not yet implemented.
**Owner decision required** on §0.2 (legal citations) and §1.3 (VNeID provider) before any code lands.

This document specifies the technical work to move eno.vn from *passive intermediary* to
*active gatekeeper* under the 2026 e-commerce regime: two-tier identity verification, the
schema that records it, an authority takedown path, and the transparency + retention
obligations that hang off both.

---

## 0. Scope and ground rules

### 0.1 Edition scope — NOT uniform, and the difference is load-bearing

| Module | eno.vn | eno.forum |
|---|---|---|
| 1 · Identity verification (VNPT / passport) | ✅ required | ⛔ **not required** |
| 2 · Schema + audit spine | ✅ | ✅ (shared tables, inert without Module 1) |
| 3 · Authority takedown | ✅ | ✅ |
| 4 · Ranking disclosure + retention | ✅ | ✅ |

**Identity verification is marketplace-only** (owner, 2026-08-03: *"eno.forum doesnt need it"*).
The seller-identity mandate binds the **licensed Vietnamese platform**; eno.vn is the entity
registering as a sàn TMĐT, and eno.forum exists precisely because it sits outside that regime.

⚠️ **THIS GATE IS NOT OPTIONAL POLISH — WITHOUT IT THE FORUM LOCKS ITSELF OUT, SILENTLY.**
`assertPublishable()` lives in `publish-guard.ts`, which **both** editions share. The moment
`verificationStatus` starts being populated, an ungated check refuses **every forum publish** —
and with no VNPT integration channel on that side, no seller could ever clear it. A total
publish lockout, with no self-service exit, on the surface nobody is watching. The gate is
`IDENTITY_VERIFICATION_REQUIRED` (`src/lib/compliance/account-state.ts`), pinned by a test.

Everything else stays shared, per the standing rule: a change under `src/**` reaches both for
free, and the burden of proof is on gating.

⚠️ **One question for counsel, not for code:** these regimes commonly assert jurisdiction over
*cross-border* platforms serving Vietnamese consumers. If eno.forum carries marketplace listings
for VN users, whether it is genuinely out of scope is a legal call — worth confirming, and the
gate above flips with one constant if the answer changes.

⚠️ **The trap is config, not code** — and it has bitten twice (Turnstile allowlist, Cloudflare
cache rules). Everything in §3 and §4 that touches Secret Manager, Cloud Scheduler, or a
Cloudflare rule must be done **twice** and **verified twice**: `eno-root-env` *and*
`eno-services-env`, both zones, both Cloud Build triggers.

### 0.2 Citations — confirmed by the owner 2026-08-03

Law 122/2025/QH15 and Decree 248/2026/ND-CP were **confirmed by the owner on 2026-08-03**
("decree confirmed, build in accordance"), consistent with the licensing research already on
file (ND 340/2025 for currency display, live seller-authentication penalties, e-ID by
2027-01-01).

They are still quoted in exactly **one** file. Not because they are doubted, but because a
citation appears in takedown notices, policy pages and emails, and an amendment must be a
one-line diff rather than a grep across the codebase:

```ts
// src/lib/compliance/legal-basis.ts
//
// ⚠️ SINGLE SOURCE OF TRUTH FOR EVERY CITATION WE PUT IN FRONT OF A USER OR AN AUTHORITY.
// Never inline a law number in a component, an email template, or a policy page — a wrong
// citation in a takedown notice is a legal problem, and it must be fixable in one place.
// VERIFY WITH COUNSEL BEFORE LAUNCH. See docs/compliance-2026.md §0.2.
export const LEGAL_BASIS = {
  ecommerceLaw:  { id: 'Luật Thương mại điện tử số 122/2025/QH15', effective: '2026-07-01' },
  identityDecree:{ id: 'Nghị định 248/2026/NĐ-CP',                 effective: '2027-01-01' },
  // Already confirmed by the 2026 licensing research — currency display.
  currencyDecree:{ id: 'Nghị định 340/2025/NĐ-CP',                 effective: '2025-01-01' },
} as const

/** Hard deadline for seller identity verification. Drives the enforcement ramp in §1.6. */
export const IDENTITY_DEADLINE = new Date('2027-01-01T00:00:00+07:00')
```

### 0.3 What this design deliberately does NOT do

- **No payment/escrow obligations.** eno.vn does not process payments; transactions complete
  off-platform. Provisions that attach to payment intermediaries are out of scope — but note
  this is exactly the classification a regulator may dispute, so §4.2 retains evidence that
  no funds flow through us.
- **No raw national-ID or passport numbers at rest.** See §2.4. Storing them creates a
  breach liability far larger than the compliance benefit, and nothing in the obligation set
  requires the *number* — it requires proof that verification happened.
- **No new sanction on buyers.** The identity mandate targets sellers. Verifying every
  browsing expat would destroy the funnel for no compliance gain.

---

## Module 1 — Two-tier identity verification

### 1.1 Who must verify, and when

Verification is a **seller-side** gate, enforced at the point of publishing, not at signup.
That is deliberate: the existing publish gate (`minPhotosFor`, contact-in-name) is already
the choke point every listing passes, so this reuses a proven seam instead of adding a
second one.

| Actor | Tier | Trigger |
|---|---|---|
| Vietnamese citizen selling | **A — VNeID** | first publish, or first publish after 2027-01-01 |
| Foreign resident selling | **B — Passport + residence** | same |
| Business account | A or B **+ business registration** | at business onboarding |
| Buyer / browser | none | never |

Existing sellers are ramped, not locked out — see §1.6.

### 1.2 State machine

One `verificationStatus` per Profile. Every transition writes a `ComplianceAudit` row (§2.5).

```
unverified ──submit──▶ pending ──auto/manual approve──▶ verified
                          │                                 │
                          ├──reject──▶ rejected             ├──document expiry──▶ expired
                          │              │                  └──authority order──▶ revoked
                          └──timeout─────┘                         │
                                 (re-submit allowed, rate-limited) │
   expired / rejected / revoked ──re-submit──▶ pending ◀───────────┘
```

**`expired` is not `unverified`.** A TRC that lapsed means the person was real and their
right to reside changed — a different remediation (renew the document) from someone who
never verified. Collapsing them sends the wrong email and loses the audit trail.

### 1.3 Tier A — VNeID (Vietnamese citizens)

⚠️ **Blocked on the owner:** VNeID integration is not open self-serve. It requires a
contracted connection through C06/an authorised provider, and the endpoints, client
credentials, and assertion format come from that integration package. The flow below is
modelled as **OAuth2 authorization-code + PKCE returning a signed assertion**, which is the
shape these national eID schemes take; the exact endpoint names must be replaced with the
provider's once the contract exists.

```
 Browser                     eno.vn                        VNeID / provider
    │  tap "Verify with VNeID"  │                                  │
    ├──────────────────────────▶│                                  │
    │                           │ create nonce + PKCE verifier,    │
    │                           │ store server-side (5 min TTL)    │
    │  302 to authorize URL     │                                  │
    │◀──────────────────────────┤                                  │
    ├──────────────────────────────────────────────────────────────▶│
    │            user authenticates in the VNeID app                │
    │◀──────────────────────────────────────────────────────────────┤
    │  redirect ?code&state     │                                  │
    ├──────────────────────────▶│                                  │
    │                           │ exchange code + verifier ────────▶│
    │                           │◀──── signed assertion ───────────┤
    │                           │ verify signature, nonce, audience,│
    │                           │ freshness; derive subject hash    │
    │                           │ write IdentityVerification + audit│
    │  verified                 │                                  │
    │◀──────────────────────────┤                                  │
```

**What we keep from the assertion (and nothing else):**

| Keep | Why |
|---|---|
| pairwise subject id → HMAC (§2.4) | duplicate-account detection without holding the CCCD |
| `verifiedAt`, issuer, assertion id | proof the check happened, for the 3-year log |
| full name, DOB **year only** | display + age gate; day/month is not needed |
| assurance level | some obligations may require a higher LoA |

**Never persisted:** the CCCD number, the raw assertion JWT after verification, address,
photograph.

```ts
// src/app/api/compliance/vneid/callback/route.ts  (sketch)
export async function GET(req: NextRequest) {
  const { code, state } = Object.fromEntries(new URL(req.url).searchParams)
  // ⚠️ The nonce is single-use and server-side. A replayed callback must not mint a second
  // verification — that is the whole attack: one real citizen verifying many seller accounts.
  const session = await consumeVneidSession(state)          // atomic DELETE…RETURNING
  if (!session) return fail('vneid_state_invalid')

  const assertion = await exchangeCode(code, session.pkceVerifier)
  const claims = await verifyAssertion(assertion, {
    audience: process.env.VNEID_CLIENT_ID,
    nonce: session.nonce,
    maxAgeSec: 300,
  })
  if (!claims) return fail('vneid_assertion_invalid')

  // ⚠️ ONE HUMAN → ONE VERIFIED SELLER. Enforced by a UNIQUE index on the subject hash, not
  // by a SELECT-then-INSERT: two tabs finishing together both pass the read and both insert.
  // Let Postgres reject the second (see the visa capture race — locking a row is not enough).
  await recordVerification({
    profileId: session.profileId,
    tier: 'A',
    method: 'vneid',
    subjectHash: hmacSubject(claims.sub),
    fullName: claims.name,
    birthYear: claims.birthdate?.slice(0, 4),
    assuranceLevel: claims.acr,
    expiresAt: null,                     // a citizen ID does not gate seller status by expiry
  })
  return NextResponse.redirect(new URL('/dashboard/account?verified=1', req.url))
}
```

### 1.4 Tier B — Passport + residence (foreign expats)

This is the flow that must not be sloppy, because it handles the most sensitive documents on
the platform and because expats are a large share of the seller base.

**Steps**

1. **Capture** — passport bio page + residence document (TRC / long-stay visa page).
   In-browser downscale before upload (the video pipeline already does this; a 50 MB Supabase
   project ceiling applies here too).
2. **Quality gate, client-side first** — glare, blur, crop, resolution. Rejecting locally
   costs nothing and avoids storing a document we cannot read.
3. **MRZ parse + checksum** — the machine-readable zone yields passport number, nationality,
   DOB, sex, expiry, and carries **its own check digits**. A failed check digit means a bad
   scan or a forgery; either way, do not proceed.
4. **Cross-field consistency** — MRZ name vs. visual name vs. account name; MRZ nationality
   vs. selected nationality; expiry in the future.
5. **Decision** — auto-approve only on a clean MRZ checksum *and* consistent fields *and*
   an unexpired document. Anything else → `pending` for human review.
6. **Purge** — see §4.3. Images die on decision; only the assertion survives.

> ⚠️ **REUSE THE PRIMITIVES, BUT DO NOT IMPORT FROM `src/lib/visa/**`.**
> The repo already has exactly the right building blocks — `mrz.ts`, `image-quality.ts`,
> `image-normalization.ts`, `crypto.ts` — but importing them here is wrong twice over:
> 1. **Licensing optics.** eno.vn is the edition that must not appear to operate a visa
>    service. A KYC path whose stack trace runs through `lib/visa` is a bad artifact to hand a
>    regulator, even though verifying your own users is plainly not a visa service.
> 2. **`sync-pairs.test.ts` byte-couples those six files to their forum copies.** Editing one
>    to suit KYC fails the root vitest suite until the pair is mirrored.
>
> **Extract, don't import:** move the document-agnostic logic to `src/lib/identity/{mrz,
> image-quality,image-normalization}.ts`, and have the visa modules re-export from there. The
> sync-paired files keep their bytes (they become thin re-exports mirrored on both sides), and
> the compliance path owns a neutral module.

```ts
// src/lib/identity/passport-check.ts
export type PassportCheck =
  | { ok: true; mrz: MrzFields; autoApprove: boolean }
  | { ok: false; reason: 'mrz_unreadable' | 'checksum_failed' | 'expired' | 'name_mismatch' }

export function checkPassport(mrzRaw: string, account: { displayName: string }): PassportCheck {
  const mrz = parseMrz(mrzRaw)
  if (!mrz) return { ok: false, reason: 'mrz_unreadable' }
  // ⚠️ CHECK DIGITS ARE THE POINT OF THE MRZ. A parse that "succeeded" but whose composite
  // check digit fails is a misread or a forgery — never treat a parsed struct as validated.
  if (!mrz.checksumsValid) return { ok: false, reason: 'checksum_failed' }
  if (mrz.expiry <= new Date()) return { ok: false, reason: 'expired' }

  // Transliteration is lossy both ways (NGUYỄN → NGUYEN, and diacritics never survive the
  // MRZ), so compare on a folded form and let a human adjudicate anything short of a match.
  const near = foldName(mrz.surname + mrz.givenNames) === foldName(account.displayName)
  return { ok: true, mrz, autoApprove: near }
}
```

**Residence expiry is a first-class field.** A TRC expiring in 40 days should warn, not
block; expired should suspend publishing but not delete the account. This mirrors the visa
severity model already in the repo (block vs. warn), and it is why `documentExpiresAt` is
indexed in §2.2 — a nightly job walks it.

### 1.5 How this ties into the Public Trust Score

The trust model is **evidence-based (Trust v2)** and drift was deliberately removed. So
verification enters as **evidence**, exactly like any other TrustEvent — not as a multiplier,
not as a decay, and not as a separate badge system.

⚠️ **Do not reintroduce anything that looks like drift.** A "verification freshness" term that
quietly lowers scores over time is drift wearing a compliance hat.

```ts
// Additions to the TrustEvent kinds — awarded once, idempotent on (profileId, kind).
IDENTITY_VERIFIED_TIER_A  +12   // state-backed assertion; strongest identity evidence we can hold
IDENTITY_VERIFIED_TIER_B  +10   // document-backed; slightly weaker (no live issuer check)
IDENTITY_EXPIRED          -10   // reverses the award; NOT a penalty below the pre-award baseline
IDENTITY_REVOKED          -25   // authority-ordered or fraud-confirmed; this one IS a penalty
BUSINESS_REGISTERED       + 8   // verified business registration number
```

Three rules that keep this honest:

1. **Reversal, not punishment.** `IDENTITY_EXPIRED` must not drop a seller below where they
   sat before verifying — otherwise verifying early is a trap. Implement as a paired reversal
   event, and assert it in `trust-math.test.ts`.
2. **The badge is derived, never stored as truth.** `Seller.verified` today is a raw boolean;
   after this it must be **computed** from the live verification row, or it will drift out of
   sync the first time a document expires. Keep the column as a denormalised cache written
   only by `recomputeTrust`, the same discipline as `trustTier`.
3. **Verification does not buy ranking on its own** — it moves `trustScore`, which is 0.60 of
   browse rank and 0.40 of search rank (§4.1). That indirection is what makes the disclosure
   text in §4.1 true.

### 1.6 Enforcement ramp (do not flip a switch on 2027-01-01)

A hard cutover would unpublish the entire seller base overnight. Reuse the existing
`enforcementState` machine instead:

| Window | Behaviour |
|---|---|
| now → D-90 | banner + email; verification optional; verified badge as carrot |
| D-90 → D-30 | new listings require verification; existing listings untouched |
| D-30 → D | existing sellers warned weekly; `enforcementState = 'warned'` |
| D onward | unverified sellers → `throttled`: existing listings stay live and reachable, **new** publishes blocked |
| D+30 | unverified sellers' listings unpublished (reversible, not deleted) |

⚠️ Launch posture is **lenient** (owner, standing instruction): fix false positives rather
than tightening the check. The one exception already on record is the visa document gate —
identity verification here is a *seller* gate and follows the lenient rule.

---

## Module 2 — Database schema

Prisma 7 → Supabase Postgres. ⚠️ Schema changes on this repo follow the documented flow:
drop the `profile_auth_fk` over `DIRECT_URL` → `prisma db push` → `node scripts/profile-auth-fk.mjs`
→ `prisma generate` → restart. `prisma db push` alone fails on that FK.

### 2.1 `Profile` additions

```prisma
model Profile {
  // … existing fields …

  /// Denormalised cache of the live IdentityVerification row. NEVER written by hand —
  /// only by recomputeVerification(), same discipline as trustTier. Read paths use this;
  /// decisions that matter re-read the verification table.
  verificationStatus  String    @default("unverified") // unverified|pending|verified|rejected|expired|revoked
  verificationTier    String?   // 'A' (VNeID) | 'B' (passport)
  verificationMethod  String?   // 'vneid' | 'passport_mrz' | 'passport_manual' | 'business_registry'
  verifiedAt          DateTime?
  /// Residence/passport expiry for Tier B; null for Tier A. Indexed — a nightly job walks it.
  documentExpiresAt   DateTime?

  /// Compliance hold, INDEPENDENT of enforcementState. A trust suspension and a regulatory
  /// hold are different things with different remedies, and conflating them means lifting one
  /// silently lifts the other.
  complianceFlag      String?   // 'authority_hold' | 'identity_fraud' | 'sanctions_review'
  complianceFlaggedAt DateTime?

  identityVerifications IdentityVerification[]

  @@index([verificationStatus])
  @@index([documentExpiresAt])
}
```

### 2.2 `IdentityVerification` — one row per attempt, append-only

```prisma
/// APPEND-ONLY. Never UPDATE a decided row and never DELETE one — supersede it with a new
/// attempt. The 3-year investigative obligation is about being able to show what we knew and
/// when; an UPDATE destroys exactly that.
model IdentityVerification {
  id         String   @id @default(cuid())
  profileId  String   @db.Uuid
  profile    Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)

  tier       String   // 'A' | 'B'
  method     String
  status     String   // pending | verified | rejected | expired | revoked
  submittedAt DateTime @default(now())
  decidedAt   DateTime?
  decidedBy   String?  // admin profile id, or 'system' for auto-approval
  rejectReason String? // mrz_unreadable | checksum_failed | expired | name_mismatch | manual

  /// ⚠️ HMAC, NOT THE IDENTIFIER, AND NOT A BARE SHA256. See §2.4.
  subjectHash String  @db.Char(64)

  fullName    String?
  nationality String?  @db.Char(3)   // ISO-3166-1 alpha-3, from the MRZ
  birthYear   Int?
  documentType String?               // 'passport' | 'trc' | 'visa' | 'cccd'
  documentExpiresAt DateTime?
  assuranceLevel String?

  /// Provider evidence: assertion id / OCR confidence / reviewer note. NEVER the raw document,
  /// never the raw assertion, never the document number.
  evidence   Json?

  supersedesId String?  @unique
  supersedes   IdentityVerification? @relation("Supersedes", fields: [supersedesId], references: [id])
  supersededBy IdentityVerification? @relation("Supersedes")

  /// ⚠️ ONE HUMAN → ONE VERIFIED IDENTITY, enforced by the DATABASE. A partial unique index so
  /// only LIVE verifications collide: a rejected or superseded attempt must not block a retry.
  @@index([profileId, status])
  @@index([subjectHash])
  @@map("identity_verifications")
}
```

```sql
-- The uniqueness Prisma cannot express: partial + predicate.
CREATE UNIQUE INDEX identity_subject_live_uniq
  ON identity_verifications (subject_hash)
  WHERE status = 'verified';
```

### 2.3 `Listing` additions — including the ranking variables

```prisma
model Listing {
  // … existing fields …

  /// Compliance lifecycle, SEPARATE from the existing sold/active status. A listing taken
  /// down by an authority is not "sold" and must not render the sold page (which returns 200
  /// + noindex by design); it needs its own terminal state.
  complianceStatus   String    @default("clear") // clear | under_review | taken_down | restored
  takenDownAt        DateTime?
  takedownOrderId    String?
  takedownOrder      TakedownOrder? @relation(fields: [takedownOrderId], references: [id])

  /// ⚠️ RANKING TRANSPARENCY REQUIRES REPRODUCIBILITY. Storing only the composite makes the
  /// §4.1 disclosure unauditable — we could not show a regulator (or a seller) WHY one listing
  /// outranked another. Persist the components and the formula version alongside the score.
  rankScore          Float     @default(0)
  rankTrustComponent Float?
  rankDemandComponent Float?
  rankRecencyComponent Float?
  rankFormulaVersion String?   // e.g. 'v2.1' — bump whenever RANK constants change
  rankComputedAt     DateTime?

  @@index([complianceStatus])
}
```

### 2.4 ⚠️ How identifiers are hashed — and why not SHA-256

A national ID or passport number is **low-entropy and structured**. Vietnam's CCCD is 12
digits; a plain `sha256(cccd)` is brute-forceable in seconds on commodity hardware, so a
leaked hash column is equivalent to leaking the numbers. The same is true of passport numbers
within a nationality.

```ts
// src/lib/compliance/subject-hash.ts
import { createHmac } from 'node:crypto'

/**
 * ⚠️ KEYED hash with a pepper held ONLY in Secret Manager — never in the database, never in
 * NEXT_PUBLIC_*, never in a migration. Without the key the column is useless to an attacker;
 * with it we can still detect "same human, second account", which is the only thing we need.
 *
 * ⚠️ NEXT_PUBLIC_* IS INLINED AT BUILD TIME INTO THE SERVER BUNDLE TOO. A pepper read from a
 * NEXT_PUBLIC_ var would be shipped inside the artifact. It must be a plain server env var.
 */
export function hmacSubject(raw: string): string {
  const pepper = process.env.IDENTITY_HASH_PEPPER
  if (!pepper) throw new Error('IDENTITY_HASH_PEPPER missing — refusing to hash without a key')
  return createHmac('sha256', pepper).update(raw.trim().toUpperCase()).digest('hex')
}
```

**Owner action:** generate a 32-byte pepper and add `IDENTITY_HASH_PEPPER` to **both**
`eno-root-env` and `eno-services-env`. Rotating it invalidates duplicate detection for
existing rows, so treat it as permanent; if rotation is ever forced, store a `pepperVersion`
alongside and dual-write.

### 2.5 `ComplianceAudit` — the 3-year investigative log

```prisma
/// APPEND-ONLY, HASH-CHAINED. The point of an investigative log is that it can be shown to be
/// unaltered. A plain table proves nothing: anyone with write access can rewrite history.
/// Each row commits to its predecessor, so a single edit breaks the chain from that row on.
model ComplianceAudit {
  id         BigInt   @id @default(autoincrement())
  occurredAt DateTime @default(now())

  actorType  String   // 'user' | 'admin' | 'authority' | 'system'
  actorId    String?
  actorIp    String?  // ⚠️ from cf-connecting-ip only — never a client-supplied XFF

  action     String   // identity.verified | listing.taken_down | listing.restored | …
  subjectType String  // 'profile' | 'listing' | 'seller'
  subjectId  String

  /// What changed, already redacted. NEVER a document image, a raw identifier, or a full
  /// assertion — the log is retained for 3 years and must survive a data-protection audit too.
  detail     Json

  legalBasis String?  // LEGAL_BASIS key, for authority-driven actions
  prevHash   String?  @db.Char(64)
  rowHash    String   @db.Char(64)

  @@index([subjectType, subjectId, occurredAt])
  @@index([action, occurredAt])
  @@map("compliance_audit")
}
```

```sql
-- Monthly partitions: 3 years of retention is a DROP PARTITION, not a 100M-row DELETE that
-- bloats the table and stalls autovacuum.
CREATE TABLE compliance_audit (LIKE compliance_audit_template INCLUDING ALL)
  PARTITION BY RANGE (occurred_at);

-- Append-only enforced in the database, not by convention. Application bugs and a rushed
-- psql session are both in scope here.
CREATE RULE compliance_audit_no_update AS ON UPDATE TO compliance_audit DO INSTEAD NOTHING;
CREATE RULE compliance_audit_no_delete AS ON DELETE TO compliance_audit DO INSTEAD NOTHING;
```

```ts
// Chain computation — rowHash = H(prevHash ‖ canonical(row)).
// ⚠️ Serialise per-chain. Two concurrent writers reading the same prevHash produce a FORK,
// which looks identical to tampering. A single advisory lock on the chain key is enough at
// our write volume, and is far simpler to reason about than a lock-free scheme.
export async function appendAudit(tx: Tx, row: AuditInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('compliance_audit'))`
  const prev = await tx.complianceAudit.findFirst({ orderBy: { id: 'desc' }, select: { rowHash: true } })
  const rowHash = sha256(`${prev?.rowHash ?? ''}|${canonicalJson(row)}`)
  return tx.complianceAudit.create({ data: { ...row, prevHash: prev?.rowHash ?? null, rowHash } })
}
```

---

## Module 3 — Active moderation & authority takedown

### 3.1 Architecture

`/api/v1/*` is the correct home. Per `src/proxy.ts`, that prefix already **bypasses the edge
pin** (`EDGE_SECRET`) because it is reached server-to-server off Cloudflare and carries its
**own** per-key auth. An authority integration is exactly that shape.

```
Authority system ──mTLS + signed request──▶ POST /api/v1/compliance/takedown
                                                │
                            ┌───────────────────┼────────────────────┐
                            ▼                   ▼                    ▼
                    unpublish listing    append audit row     notify seller
                    (single UPDATE)      (hash-chained)       (renderBrandEmail)
                            │
                            ▼  ⚠️ THE PART THAT IS ALWAYS FORGOTTEN
              purge from every surface that CACHED or COPIED it:
              Vertex AI Search index · Google Merchant feed · Meta catalog
              · sitemap · ISR cache · Cloudflare (purge_everything)
```

> ⚠️ **AN UNPUBLISHED LISTING IS NOT A REMOVED LISTING.** This platform copies listings into
> at least five places outside the primary table, and the repo has already been bitten by
> exactly this class of bug (visa products leaking into browse, search, rails, sitemap,
> JSON-LD and the Google/Meta feeds because they are ordinary `Listing` rows). A takedown that
> only flips a column leaves the illegal content live in Google Shopping and the Meta catalog,
> discoverable, with our name on it. **Fan-out is part of the takedown, not a follow-up task.**
> Purge Cloudflare with `purge_everything` — purge-by-URL silently no-ops on `vary: normalize`
> cache keys.

### 3.2 Endpoint blueprint

```
POST /api/v1/compliance/takedown
Authorization: Bearer <authority key>          scope: compliance:takedown
X-Idempotency-Key: <uuid>                      required
X-Signature: <hmac-sha256 over raw body>       required for authority keys
```

```jsonc
// request
{
  "listingId": "clx8…",                  // or "sellerId" for a whole storefront
  "action": "unpublish",                 // unpublish | restore | restrict
  "reason": "visa_scam",                 // enum, see §3.3
  "legalBasis": "ecommerceLaw",          // key into LEGAL_BASIS — never free text
  "orderReference": "QĐ-1234/2026",      // the authority's own document number
  "issuedBy": "Cục TMĐT & KTS (Bộ Công Thương)",
  "issuedAt": "2026-08-03T09:00:00+07:00",
  "notifySeller": true
}
```

```jsonc
// 200 — idempotent: replaying the same key returns the ORIGINAL result, never a second action
{
  "ok": true,
  "orderId": "tko_01J…",
  "listingId": "clx8…",
  "previousStatus": "active",
  "takenDownAt": "2026-08-03T09:00:04+07:00",
  "propagation": {
    "vertexSearch": "purged", "merchantFeed": "queued",
    "metaCatalog": "queued", "cdn": "purged"
  },
  "sellerNotifiedAt": "2026-08-03T09:00:05+07:00",
  "appealUntil": "2026-08-17T09:00:04+07:00"
}
```

```ts
// src/app/api/v1/compliance/takedown/route.ts  (control flow)
export async function POST(req: NextRequest) {
  // 1. Authenticate. ⚠️ Verify the HMAC over the RAW body BEFORE parsing — the same posture as
  //    the Stripe webhook. Parsing first means acting on a body you have not authenticated.
  const raw = await req.text()
  const key = await authenticateAuthorityKey(req, raw)   // constant-time compare
  if (!key?.scopes.includes('compliance:takedown')) return json(403, { error: 'forbidden' })

  const body = TakedownSchema.parse(JSON.parse(raw))     // zod; unknown legalBasis → 400

  // 2. Idempotency FIRST, and atomically. A retried order must never take down twice or
  //    re-notify. Insert-on-conflict-return, not check-then-act.
  const existing = await claimIdempotencyKey(req.headers.get('x-idempotency-key'), body)
  if (existing) return json(200, existing.response)

  // 3. Act inside one transaction: unpublish + order + audit either all land or none do.
  //    A takedown recorded without the audit row is worse than a failed takedown.
  const result = await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.update({
      where: { id: body.listingId },
      data: { complianceStatus: 'taken_down', status: 'unpublished', takenDownAt: new Date() },
    })
    const order = await tx.takedownOrder.create({ data: { ...body, actorKeyId: key.id } })
    await appendAudit(tx, {
      actorType: 'authority', actorId: key.id, action: 'listing.taken_down',
      subjectType: 'listing', subjectId: listing.id,
      legalBasis: body.legalBasis,
      detail: { reason: body.reason, orderReference: body.orderReference },
    })
    return { listing, order }
  })

  // 4. Fan-out AFTER commit, and never let a failing feed roll back a lawful takedown.
  //    ⚠️ Each of these must be retried by the reconciler in §3.5 — "queued" is not "done".
  after(() => propagateTakedown(result.listing.id))
  if (body.notifySeller) after(() => notifySellerOfTakedown(result.order))

  return json(200, buildResponse(result))
}
```

### 3.3 Reason enum

Free-text reasons cannot be reported on or appealed consistently.

`visa_scam` · `illegal_sublet` · `counterfeit` · `prohibited_goods` · `unlicensed_service` ·
`fraudulent_seller` · `ip_infringement` · `court_order` · `other` (requires `orderReference`)

### 3.4 Seller notification

⚠️ Every email goes through `renderBrandEmail()` — no exceptions. Bilingual, Vietnamese
first (the recipient may be either audience; VI leads on the licensed marketplace).

> **Subject:** Tin đăng của bạn đã bị gỡ theo yêu cầu của cơ quan chức năng / Your listing has been removed by order of a competent authority
>
> Chào {{sellerName}},
>
> Tin đăng **"{{listingTitle}}"** ({{listingId}}) đã được gỡ khỏi eno.vn vào lúc
> {{takenDownAt}} theo yêu cầu của **{{issuedBy}}**, văn bản số **{{orderReference}}**.
>
> **Lý do:** {{reasonLabel}}
> **Căn cứ pháp lý:** {{legalBasis.id}}
>
> eno.vn hoạt động với vai trò sàn giao dịch trung gian. Chúng tôi thực hiện yêu cầu này theo
> nghĩa vụ pháp lý của mình và **không tự đánh giá nội dung tin đăng của bạn**.
>
> **Nếu bạn cho rằng đây là nhầm lẫn**, bạn có quyền khiếu nại đến {{appealUntil}}:
> {{appealUrl}} — chúng tôi sẽ chuyển khiếu nại của bạn đến cơ quan đã yêu cầu gỡ bỏ.
> Tài khoản của bạn **không bị khóa** và các tin đăng khác không bị ảnh hưởng.
>
> ---
>
> Your listing **"{{listingTitle}}"** was removed from eno.vn at {{takenDownAt}} at the
> request of **{{issuedBy}}** (order {{orderReference}}).
>
> **Reason:** {{reasonLabel}} · **Legal basis:** {{legalBasis.id}}
>
> eno.vn acts as an intermediary marketplace. We are acting on a legal obligation and have
> **not made our own judgement about your listing**. If you believe this is a mistake you may
> appeal until {{appealUntil}} at {{appealUrl}}; we will forward your appeal to the issuing
> authority. Your account remains active and your other listings are unaffected.

Three things this wording does deliberately: it **names the authority and the order number**
(so the seller can seek their own advice), it **disclaims our own judgement** (we are not
adjudicating, which matters to the intermediary position in §0.3), and it **states plainly
that the account is not suspended** — otherwise the support load is entirely "am I banned?".

### 3.5 Reconciler

Feed and index propagation fails silently and invisibly — the pattern that let a green build
serve a broken runtime for nine hours. A cron re-asserts intent:

```ts
// src/app/api/cron/compliance-reconcile — every 15 min
// For every listing with complianceStatus='taken_down' updated in the last 7 days, CONFIRM
// absence from: Vertex index, Merchant feed, Meta catalog, sitemap. Re-purge on mismatch and
// alert if a listing is still present after 3 consecutive passes. Absence is the assertion —
// "we sent a delete" is not evidence that it is gone.
```

---

## Module 4 — Transparency & data retention

### 4.1 Ranking disclosure

⚠️ **These numbers must match `src/lib/ranking-formula.ts`.** They were read from the live
constants on 2026-08-03 (`BROWSE_TRUST_W 0.6 / BROWSE_RELEVANCE_W 0.25 / BROWSE_RECENCY_W
0.15`; `SEARCH_REL_W 0.5 / SEARCH_TRUST_W 0.4 / SEARCH_RECENCY_W 0.1`). **A disclosure that
does not match the code is a false statement**, so this page must be generated from `RANK`,
not hand-written — add a unit test asserting the rendered percentages equal the constants.

**Published at `/legal/ranking` (both editions), linked from the footer and every results page.**

> ### Cách eno.vn sắp xếp kết quả / How eno.vn ranks results
>
> eno.vn không bán vị trí hiển thị. Không có tin đăng nào được xếp hạng cao hơn nhờ trả phí.
> *(eno.vn does not sell placement. No listing ranks higher because it was paid for.)*
>
> **Khi bạn duyệt (không có từ khoá tìm kiếm) / When you browse (no search query):**
> - **Điểm tin cậy của người bán — 60%** — an evidence-based score from completed
>   transactions, reviews, response behaviour, verified identity, and confirmed reports.
> - **Mức độ quan tâm — 25%** — how many buyers viewed and contacted this listing. A contact
>   counts far more than a view, and the effect saturates so a popular listing cannot dominate.
> - **Độ mới — 15%** — freshness, decaying continuously (about half its value after ~10 days).
>
> **Khi bạn tìm kiếm / When you search:**
> - **Mức độ phù hợp — 50%** · **Điểm tin cậy — 40%** · **Độ mới — 10%**
>
> **Tin nổi bật / Featured listings** receive a fixed, disclosed boost and are always labelled.
>
> **Điều chúng tôi KHÔNG dùng / What we do NOT use:** your personal data, browsing history,
> demographics, nationality, or device to reorder results. Two people running the same search
> at the same moment see the same order.
>
> **Điểm tin cậy / Trust score:** how it is calculated, and how to raise yours, is at
> {{trustExplainerUrl}}. You can see your own score and every event that changed it in your
> dashboard, and dispute any event you believe is wrong.

### 4.2 Retention schedule

The tension: a 3-year investigative obligation vs. data minimisation. Resolve it by
retaining **evidence**, not **documents**.

| Data | Retention | Mechanism |
|---|---|---|
| Identity document **images** | **Deleted on decision**; ≤30 days if manual review stalls | fail-closed object removal, per the visa-retention cron pattern |
| Verification assertion (hash, name, expiry, decision) | **3 years after account closure** | `identity_verifications`, append-only |
| `compliance_audit` | **3 years** from `occurredAt` | monthly partitions → `DROP PARTITION` |
| Listing content (incl. taken-down) | **3 years** as a tombstone | soft delete; body retained, hidden from every public surface |
| Takedown orders | **3 years** after the order | never deleted while an appeal is open |
| Chat messages | per existing policy | unchanged — 1:1 chat, not a compliance surface |
| Server/access logs | 12 months | Cloud Logging retention |

**Deletion requests.** A user's right to erasure does not override a statutory retention
duty, but it does constrain what we keep. On an erasure request: purge profile PII, avatar,
and display name; **retain** the pseudonymised audit rows and the verification hash, which no
longer identify the person once the profile is gone. Record the erasure itself as an audit
row — an unexplained gap in a hash chain is worse than a documented one.

⚠️ **A taken-down listing must not 404 and must not render the sold page.** The sold page
deliberately returns 200 + noindex; a compliance takedown needs its own terminal state
returning **410 Gone + noindex**, with a short neutral notice. Reusing the sold page would
tell buyers the item sold, which is false.

### 4.3 Document lifecycle

```ts
// src/app/api/cron/identity-retention — daily, mirroring eno-visa-retention
//
// ⚠️ FAIL CLOSED. If the storage delete errors, DO NOT mark the row purged — the next run must
// retry. A "purged" flag written ahead of the actual delete is how documents survive a
// retention policy that everyone believes is working.
// 1. verified/rejected > 0 days  → delete document objects, set documentsPurgedAt
// 2. pending > 30 days           → auto-reject (stale), then purge
// 3. documentExpiresAt < today   → status → 'expired', reversal TrustEvent, notify seller
// 4. documentExpiresAt < +30d    → one warning email (idempotent on documentExpiresAt)
```

---

## Implementation order

Each phase ships independently and is reversible.

1. **Schema + audit spine** (§2) — tables, hash chain, `LEGAL_BASIS`. No user-visible change.
2. **Ranking disclosure** (§4.1) — generated from `RANK`; smallest change, immediate value,
   and it is a live obligation independent of the identity deadline.
3. **Takedown endpoint** (§3) — including fan-out and the reconciler. Ship before the
   identity work: an authority request arriving with no path to service it is the acute risk.
4. **Tier B passport** (§1.4) — extract `src/lib/identity/*` first.
5. **Tier A VNeID** (§1.3) — gated on the provider contract.
6. **Enforcement ramp** (§1.6) — begins at D-90.

## Open items for the owner

- [ ] **Confirm the legal citations** with counsel (§0.2) — everything user-facing quotes them.
- [ ] **VNeID integration path** — C06 direct, or an authorised provider? Blocks phase 5.
- [ ] `IDENTITY_HASH_PEPPER` into **both** secret stores (§2.4).
- [ ] Authority key issuance: who receives a `compliance:takedown` key, and how is it delivered?
- [ ] Appeal handling — does an appeal go to a human at eno.vn, or straight to the authority?
- [ ] Business registration (ĐKKD) verification: registry API, or manual document review?
