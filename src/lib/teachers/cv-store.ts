import 'server-only'
import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin, TEACHER_CVS_BUCKET } from '@/lib/supabase-admin'

/**
 * Teacher CVs — PDF only, in the PRIVATE `teacher-cvs` bucket (scripts/teachers-ddl.mjs creates it).
 * Pattern copied from business-verification-store.ts: magic-byte sniff (the client's MIME and file
 * name are never trusted), raw bytes (a PDF is not re-encoded), `<profileId>/<uuid>.pdf` paths, and
 * reads only through a short signed URL with Content-Disposition: attachment.
 */
export const MAX_CV_BYTES = 10 * 1024 * 1024

/** `%PDF` — the only accepted shape. */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

/** Store a validated PDF; the object path, or null on a storage failure (nothing is recorded then). */
export async function storeTeacherCv(profileId: string, bytes: Buffer): Promise<string | null> {
  const path = `${profileId}/${randomUUID()}.pdf`
  const { error } = await getSupabaseAdmin()
    .storage.from(TEACHER_CVS_BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  return error ? null : path
}

/** A 10-minute download link. Callers MUST have checked the share gate first. */
export async function signTeacherCv(path: string, fileName: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(TEACHER_CVS_BUCKET)
    .createSignedUrl(path, 600, { download: fileName })
  return error ? null : data?.signedUrl ?? null
}

/** A display file name that cannot carry a path, a header break or a script. */
export function safeCvFileName(raw: unknown): string {
  const base = typeof raw === 'string' ? raw.split(/[\\/]/).pop() ?? '' : ''
  const clean = base.replace(/[^\p{L}\p{N} ._()-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return clean ? (clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`) : 'cv.pdf'
}
