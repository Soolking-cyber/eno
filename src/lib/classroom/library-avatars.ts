/**
 * The READY-MADE 3D avatars a teacher can pick (Spatius's public library). Client-safe: the wizard shows them, the API
 * refuses any id that is not here.
 *
 * ⛔ AN ALLOWLIST CURATED BY HAND from the library on the eno App in Spatius Studio (plan Phase 0): realistic adults for
 * adult classes, friendly stylised ones for children. Empty until that is done — the classroom then works in the
 * `photo` look (the teacher's own photo, voice-only), which every learner falls back to anyway.
 * Previews are files we host (public/classroom/avatars/<id>.webp), never hot-linked from Spatius.
 */
export type LibraryAvatar = {
  /** Spatius's avatar id — what AvatarManager.shared.load() takes. */
  id: string
  label: { en: string; vi: string }
  /** /classroom/avatars/<id>.webp */
  preview: string
  style: 'realistic' | 'stylised'
}

export const LIBRARY_AVATARS: readonly LibraryAvatar[] = []

export function libraryAvatarById(id: unknown): LibraryAvatar | null {
  return typeof id === 'string' ? LIBRARY_AVATARS.find((a) => a.id === id) ?? null : null
}
