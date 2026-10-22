import 'server-only'
import { getSupabaseAdmin, TEACHER_CVS_BUCKET } from '@/lib/supabase-admin'
import { TEACHER_CV_MAX_BYTES } from '@/lib/teachers/constants'

/**
 * Teacher CVs — PDF only, in the PRIVATE `teacher-cvs` bucket (scripts/teachers-ddl.mjs creates it).
 * Pattern copied from business-verification-store.ts: magic-byte sniff (the client's MIME and file
 * name are never trusted), raw bytes (a PDF is not re-encoded), `<profileId>/<uuid>.pdf` paths, and
 * reads only through a short signed URL with Content-Disposition: attachment.
 */
// One number with the form's own check at pick time (constants.ts — the client cannot import this server-only file).
export const MAX_CV_BYTES = TEACHER_CV_MAX_BYTES

/** `%PDF` — the only accepted shape. */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

/**
 * Where a CV lives: under the caller's OWN Profile id. ⛔ The prefix is the ownership proof — a first Publish names only the
 * upload's token (constants.ts isCvUploadToken) and the server rebuilds the path from the account saving it, so a token
 * minted for another account names a path this one never uploaded to (publish.ts finds no pending row there).
 */
export function cvPathFor(profileId: string, token: string): string {
  return `${profileId}/${token}.pdf`
}

/** Store a validated PDF at a path chosen first (so a caller can tombstone it before it exists). True when stored. */
export async function uploadTeacherCv(path: string, bytes: Buffer): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .storage.from(TEACHER_CVS_BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false, cacheControl: '0' /* security review item 21: never edge-cacheable past the signed URL — storage-js sends max-age=<this> */ })
  return !error
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
