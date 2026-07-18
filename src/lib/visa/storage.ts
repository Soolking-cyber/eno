import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { getVisaDb } from '@/lib/visa/db'
import { VISA_BUCKET } from '@/lib/visa-admin'
import { normalizeVisaImage, VISA_IMAGE_RULES_VERSION, type VisaImageKind } from '@/lib/visa/image-normalization'

// Ported from apps/forum/src/lib/visa/storage.ts (minus the result-PDF writer — that is
// the operator flow, which stayed on the admin surface). ⚠️ INTEROP: bucket name and the
// `${userId}/${applicationId}/${kind}-${uuid}.jpg` object path MUST stay byte-identical
// to the forum's so either surface can serve documents the other one stored.
export { VISA_BUCKET }
export { VISA_IMAGE_RULES_VERSION }

export async function storeVisaImage(input: Buffer, userId: string, applicationId: string, kind: VisaImageKind) {
  const normalized = await normalizeVisaImage(input, kind)
  const path = `${userId}/${applicationId}/${kind}-${randomUUID()}.jpg`
  const { error } = await getVisaDb().storage.from(VISA_BUCKET).upload(path, normalized.output, { contentType: 'image/jpeg', upsert: false, cacheControl: 'private, max-age=0' })
  if (error) throw new Error(`visa_storage_failed:${error.message}`)
  return {
    storage_path: path,
    mime_type: 'image/jpeg',
    size_bytes: normalized.output.length,
    width: normalized.width,
    height: normalized.height,
    sha256: createHash('sha256').update(normalized.output).digest('hex'),
    validation_status: kind === 'supporting' ? 'passed' : 'pending',
    validation_report: normalized.report,
  }
}

/** Short-lived signed URL (owner/admin-gated callers only — the bucket is private). */
export async function signVisaFile(path: string, ttl = 300) {
  const { data, error } = await getVisaDb().storage.from(VISA_BUCKET).createSignedUrl(path, ttl)
  if (error || !data?.signedUrl) throw new Error('visa_sign_failed')
  return data.signedUrl
}

export async function removeVisaFiles(paths: string[], options: { strict?: boolean } = {}) {
  if (!paths.length) return true
  const { error } = await getVisaDb().storage.from(VISA_BUCKET).remove(paths)
  if (error && options.strict) throw new Error(`visa_storage_remove_failed:${error.message}`)
  return !error
}
