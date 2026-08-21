import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { BUSINESS_VERIFICATION_BUCKET, getSupabaseAdmin } from '@/lib/supabase-admin'
import { KYC_IMAGE_KINDS, normalizeKycImage, type KycImageKind } from './image'

// ── WHERE A KYC CAPTURE LIVES ───────────────────────────────────────────────────────────────────
//
// The existing PRIVATE business-verification bucket, under an `identity/` segment. Reusing it rather
// than minting a bucket is deliberate: a new bucket needs provisioning in scripts/setup-storage.mjs
// AND on the self-hosted box later, and every one of those is a place the private/public flag can
// be set wrong. This bucket is already private, already has the admin-signed-URL path, and already
// carries documents of the same sensitivity.
//
// ⛔ THE PERSON COMES FIRST IN THE PATH — `<profileId>/identity/…`, never `identity/<profileId>/…`.
// The sibling writer in this same bucket (business-verification-store.ts:56) already lays down
// `<profileId>/<uuid>.<ext>`, so putting the TYPE above the person leaves two conventions in one
// bucket and NO single prefix that finds everything one person owns. Erasure is a prefix query, and
// `<profileId>/` has to be sufficient or account deletion silently walks past these captures.
//
// ⚠️ I HAD THIS THE OTHER WAY ROUND FIRST, on the reasoning that retention must be able to select
// identity captures without business licences. That was wrong about the mechanism: the retention
// sweep is ROW-driven — it walks IdentityVerification and removes each row's evidence paths, exactly
// as the visa sweep does — so it never needed a bucket-wide prefix at all. The only query that truly
// needs a prefix is "everything belonging to this person", and that one wants the person on top.
//
// ⛔ ALWAYS RE-ENCODED, NEVER STORED AS UPLOADED. normalizeKycImage decodes and re-emits JPEG,
// which strips EXIF (including GPS — we do not want a seller's home coordinates), drops any
// trailing appended payload, and guarantees the bytes really are an image rather than something
// with an image's first few bytes. The business-verification route deliberately does NOT do this
// because a licence is often a PDF; a KYC capture is always a photo, so here it is free.

/** The segment BELOW the profile id — see the note above on why it is not above it. */
const KIND_PREFIX = 'identity'

/** Everything this module writes for one person. The erasure path wants this, not a longer path. */
export const kycPathPrefix = (profileId: string) => `${profileId}/${KIND_PREFIX}/`

export type StoredKycImage = {
  kind: KycImageKind
  path: string
  sha256: string
  width: number | null
  height: number | null
  uploadedAt: string
  /** The locked pipeline's report plus the EXIF probe — evidence for the reviewer, not a gate. */
  report: unknown
}

export async function storeKycImage(input: {
  profileId: string
  kind: KycImageKind
  bytes: Buffer
}): Promise<StoredKycImage | null> {
  const normalized = await normalizeKycImage(input.bytes, input.kind)
  const path = `${kycPathPrefix(input.profileId)}${input.kind}-${randomUUID()}.jpg`
  const { error } = await getSupabaseAdmin()
    .storage.from(BUSINESS_VERIFICATION_BUCKET)
    .upload(path, normalized.output, { contentType: 'image/jpeg', upsert: false })
  if (error) {
    console.error('[kyc] store failed', error.message)
    return null
  }
  return {
    kind: input.kind,
    path,
    // Of the NORMALISED bytes, because that is what was stored — a hash of the upload would not
    // match the object and would be useless for the integrity check it exists to support.
    sha256: createHash('sha256').update(normalized.output).digest('hex'),
    width: normalized.width,
    height: normalized.height,
    uploadedAt: new Date().toISOString(),
    report: { ...normalized.report, exif: normalized.exif },
  }
}

/**
 * ⛔ AN ALLOW-LIST OF THE EXACT FILENAME THIS MODULE MINTS — NOT A BLACKLIST OF BAD ONES.
 *
 * The first version tested `!path.includes('..')`, and an external reviewer refuted it: nothing in
 * the Supabase client encodes an object path (`_getFinalPath` only strips leading slashes, verified
 * in node_modules), so `%2e%2e` travels to the storage server verbatim and whether it is decoded
 * into `..` there is the server's business, not ours. Rather than guess at one encoding, describe
 * what a legitimate path looks like — we mint every one of them, so we know exactly.
 *
 * Nothing outside this shape can hold a slash, a percent, a dot-segment, or a character that
 * normalises into one, which closes the whole class instead of the one spelling of it.
 */
const UUID_JPG = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg`

/**
 * ⛔ ONE PATTERN PER KIND, so a caller can require that a `selfie` field really holds a selfie —
 * see the note on ownsKycPath. Derived from KYC_IMAGE_KINDS rather than written out, so a third
 * kind cannot leave the upload route accepting something this check then refuses.
 */
const FILENAME: Record<KycImageKind, RegExp> = Object.fromEntries(
  KYC_IMAGE_KINDS.map((k) => [k, new RegExp(`^${k}-${UUID_JPG}$`)]),
) as Record<KycImageKind, RegExp>

/**
 * True when the path is one this module wrote, for the profile claiming it.
 *
 * ⛔ THIS IS AN AUTHORISATION CHECK, NOT A TIDINESS CHECK, AND IT WAS DEAD CODE UNTIL NOW. The
 * submit route takes `documentPath` and `selfiePath` from the REQUEST BODY — they are the client
 * echoing back what the documents route handed it — and listKycQueue mints a signed URL for
 * whatever ends up in the evidence column. Unchecked, a seller could name any object in this
 * private bucket (another seller's business licence, another applicant's passport) and have an
 * admin open it. Call it before anything is written.
 */
export function ownsKycPath(profileId: string, path: string, kind?: KycImageKind): boolean {
  if (!profileId || !path) return false
  const prefix = kycPathPrefix(profileId)
  if (!path.startsWith(prefix)) return false
  const name = path.slice(prefix.length)
  // ⛔ WITH A KIND, THE KIND IS BINDING — and the first version accepted EITHER kind in EITHER
  // field, which quietly undid the freshness fix. A client could send its passport photo as BOTH
  // documentPath and selfiePath: no selfie was ever taken, so no handwritten code was ever in
  // frame, and the reviewer compares the stored code against a photo that cannot contain it.
  // Caught by external review one round after the code-comparison fix landed.
  if (kind) return FILENAME[kind].test(name)
  return Object.values(FILENAME).some((re) => re.test(name))
}
