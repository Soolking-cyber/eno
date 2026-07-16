import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { getVisaDb } from '@/lib/visa/db'

export const VISA_BUCKET = 'visa-documents'

export async function storeVisaImage(input: Buffer, userId: string, applicationId: string, kind: 'portrait' | 'passport' | 'supporting') {
  if (!input.length || input.length > 10 * 1024 * 1024) throw new Error('image_size_invalid')
  const image = sharp(input, { limitInputPixels: 32_000_000, failOn: 'error' }).rotate()
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height || metadata.width < 300 || metadata.height < 300) throw new Error('image_dimensions_invalid')
  let quality = 90
  let output = await image.flatten({ background: '#fff' }).resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer()
  while (output.length >= 2 * 1024 * 1024 && quality > 55) {
    quality -= 8
    output = await sharp(output).jpeg({ quality, mozjpeg: true }).toBuffer()
  }
  if (output.length >= 2 * 1024 * 1024) throw new Error('image_official_limit_failed')
  const normalized = await sharp(output).metadata()
  const path = `${userId}/${applicationId}/${kind}-${randomUUID()}.jpg`
  const { error } = await getVisaDb().storage.from(VISA_BUCKET).upload(path, output, { contentType: 'image/jpeg', upsert: false, cacheControl: 'private, max-age=0' })
  if (error) throw new Error(`visa_storage_failed:${error.message}`)
  return { storage_path: path, mime_type: 'image/jpeg', size_bytes: output.length, width: normalized.width || null, height: normalized.height || null, sha256: createHash('sha256').update(output).digest('hex') }
}

export async function storeVisaResult(input: Buffer, userId: string, applicationId: string) {
  if (!input.length || input.length > 10 * 1024 * 1024 || input.subarray(0, 5).toString() !== '%PDF-') throw new Error('result_pdf_invalid')
  const path = `${userId}/${applicationId}/result-${randomUUID()}.pdf`
  const { error } = await getVisaDb().storage.from(VISA_BUCKET).upload(path, input, { contentType: 'application/pdf', upsert: false, cacheControl: 'private, max-age=0' })
  if (error) throw new Error(`visa_storage_failed:${error.message}`)
  return { storage_path: path, mime_type: 'application/pdf', size_bytes: input.length, width: null, height: null, sha256: createHash('sha256').update(input).digest('hex') }
}

export async function signVisaFile(path: string, ttl = 300) {
  const { data, error } = await getVisaDb().storage.from(VISA_BUCKET).createSignedUrl(path, ttl)
  if (error || !data?.signedUrl) throw new Error('visa_sign_failed')
  return data.signedUrl
}

export async function removeVisaFiles(paths: string[]) {
  if (paths.length) await getVisaDb().storage.from(VISA_BUCKET).remove(paths)
}
