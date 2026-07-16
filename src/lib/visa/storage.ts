import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { getVisaDb } from '@/lib/visa/db'
import { normalizeVisaImage, VISA_IMAGE_RULES_VERSION, type VisaImageKind } from '@/lib/visa/image-normalization'

export const VISA_BUCKET = 'visa-documents'
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

export async function storeVisaResult(input: Buffer, userId: string, applicationId: string) {
  if (!input.length || input.length > 10 * 1024 * 1024 || input.subarray(0, 5).toString() !== '%PDF-') throw new Error('result_pdf_invalid')
  const path = `${userId}/${applicationId}/result-${randomUUID()}.pdf`
  const { error } = await getVisaDb().storage.from(VISA_BUCKET).upload(path, input, { contentType: 'application/pdf', upsert: false, cacheControl: 'private, max-age=0' })
  if (error) throw new Error(`visa_storage_failed:${error.message}`)
  return { storage_path: path, mime_type: 'application/pdf', size_bytes: input.length, width: null, height: null, sha256: createHash('sha256').update(input).digest('hex'), validation_status: 'passed', validation_report: { version: VISA_IMAGE_RULES_VERSION, kind: 'result', issues: [], technicalChecks: { validPdf: true } } }
}

export async function signVisaFile(path: string, ttl = 300) {
  const { data, error } = await getVisaDb().storage.from(VISA_BUCKET).createSignedUrl(path, ttl)
  if (error || !data?.signedUrl) throw new Error('visa_sign_failed')
  return data.signedUrl
}

export async function removeVisaFiles(paths: string[]) {
  if (paths.length) await getVisaDb().storage.from(VISA_BUCKET).remove(paths)
}
