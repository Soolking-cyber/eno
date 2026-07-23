import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { getSupabaseAdmin, BUSINESS_VERIFICATION_BUCKET } from '@/lib/supabase-admin'

// Raw document store for the business-verification channel. Deliberately NOT the sharp
// image pipeline (storeEvidenceImage/storeVisaImage) — a business licence is often a PDF,
// and re-encoding a legal document would be wrong anyway. So: validate by MAGIC BYTES
// (client MIME/extension is not trusted — external review), then upload the raw bytes to
// the private bucket. Objects are reachable only through short-lived admin-gated signed
// URLs and are deleted after the review decision + dispute window.

export type VerificationDocKind = 'identity' | 'bank' | 'authorization'
export const VERIFICATION_DOC_KINDS: readonly VerificationDocKind[] = ['identity', 'bank', 'authorization']

export type VerificationDoc = {
  kind: VerificationDocKind
  path: string
  mime: 'image/jpeg' | 'image/png' | 'application/pdf'
  sha256: string
  uploadedAt: string
}

/** The largest a single document may be (matches the bucket cap and the route guard). */
export const MAX_VERIFICATION_DOC_BYTES = 15 * 1024 * 1024

/**
 * The true content type from the leading bytes, or null when the bytes are none of the
 * three allowed kinds. JPEG `ff d8 ff`, PNG `89 50 4e 47`, PDF `25 50 44 46` (`%PDF`).
 * A client that renames a .exe to .pdf or lies in the MIME header fails here.
 */
export function sniffVerificationMime(bytes: Buffer): VerificationDoc['mime'] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'
  return null
}

const EXT: Record<VerificationDoc['mime'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

/**
 * Store one already-magic-byte-validated document. Path `<profileId>/<uuid>.<ext>` — the
 * owner's profile id namespaces the object so a signed-URL leak can't be walked to another
 * user's docs. Returns the record to append to the SellerVerification, or null on failure
 * (the caller turns null into a 5xx; nothing partial is recorded).
 */
export async function storeVerificationDoc(input: {
  profileId: string
  kind: VerificationDocKind
  bytes: Buffer
  mime: VerificationDoc['mime']
}): Promise<VerificationDoc | null> {
  const path = `${input.profileId}/${randomUUID()}.${EXT[input.mime]}`
  const { error } = await getSupabaseAdmin()
    .storage.from(BUSINESS_VERIFICATION_BUCKET)
    .upload(path, input.bytes, { contentType: input.mime, upsert: false })
  if (error) {
    console.error('[business-verification] store failed', error.message)
    return null
  }
  return {
    kind: input.kind,
    path,
    mime: input.mime,
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    uploadedAt: new Date().toISOString(),
  }
}

/** A short-lived (10-min) signed URL for an admin reviewer to view one document. The
 *  Content-Disposition is attachment so a PDF never renders active content inline. */
export async function signVerificationDoc(path: string, ttlSeconds = 600): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(BUSINESS_VERIFICATION_BUCKET)
    .createSignedUrl(path, ttlSeconds, { download: true })
  if (error || !data?.signedUrl) {
    console.error('[business-verification] sign failed', error?.message)
    return null
  }
  return data.signedUrl
}

/** Remove a decided case's documents (retention job / on hard delete). Best-effort. */
export async function removeVerificationDocs(paths: string[]): Promise<void> {
  if (!paths.length) return
  const { error } = await getSupabaseAdmin().storage.from(BUSINESS_VERIFICATION_BUCKET).remove(paths)
  if (error) console.error('[business-verification] remove failed', error.message)
}

/** Parse the persisted JSON documents column into typed records, dropping anything malformed. */
export function parseVerificationDocs(value: unknown): VerificationDoc[] {
  if (!Array.isArray(value)) return []
  const out: VerificationDoc[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    if (!VERIFICATION_DOC_KINDS.includes(d.kind as VerificationDocKind)) continue
    if (typeof d.path !== 'string' || !d.path) continue
    if (d.mime !== 'image/jpeg' && d.mime !== 'image/png' && d.mime !== 'application/pdf') continue
    out.push({
      kind: d.kind as VerificationDocKind,
      path: d.path,
      mime: d.mime,
      sha256: typeof d.sha256 === 'string' ? d.sha256 : '',
      uploadedAt: typeof d.uploadedAt === 'string' ? d.uploadedAt : '',
    })
  }
  return out
}
