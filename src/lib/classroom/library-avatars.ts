/**
 * The READY-MADE 3D avatars a teacher can pick (Spatius's public library). Client-safe: the wizard shows them, the API
 * refuses any id that is not here.
 *
 * ⛔ AN ALLOWLIST CURATED BY HAND from the 28 public avatars in Spatius Studio (Phase 0, 2026-10-26; owner: "lets use
 * ready avatars for mvp"): adults only — a child's face is never a teacher's — in a classroom, office or plain setting,
 * mixed in gender, age and look; three friendly stylised ones for young learners. Left out: the children (Zoe, Milo,
 * Luca), the bar, café and clinic settings (Hugo, Alexei, Kian), the evening-glamour portrait (Clara). The id is the
 * one Studio's "Copy ID" gives (it is also the folder of the avatar's cover on cdn.spatius.ai).
 * Previews are files we host (public/classroom/avatars/<id>.webp, 192 px from that cover), never hot-linked.
 */
export type LibraryAvatar = {
  /** Spatius's avatar id — what AvatarManager.shared.load() takes. */
  id: string
  label: { en: string; vi: string }
  /** /classroom/avatars/<id>.webp */
  preview: string
  style: 'realistic' | 'stylised'
}

const avatar = (id: string, name: string, style: LibraryAvatar['style']): LibraryAvatar =>
  ({ id, label: { en: name, vi: name }, preview: `/classroom/avatars/${id}.webp`, style })

export const LIBRARY_AVATARS: readonly LibraryAvatar[] = [
  avatar('18a01afe-7870-4934-a063-1bd7f9ceb4ac', 'Nora', 'stylised'),
  avatar('383783af-40ad-4839-b9ba-f997277374ed', 'Frederic', 'stylised'),
  avatar('0d5f41ac-a2ce-4abc-a63e-7f880659b7ac', 'Sophie', 'stylised'),
  avatar('981ed26d-fbfe-42eb-a5d5-56ebd104847b', 'Haru', 'realistic'),
  avatar('8b86dda1-98ed-4acd-8a4e-b1a00ba69268', 'Leyla', 'realistic'),
  avatar('56f31c71-58ff-410f-85d2-11b9658c7b49', 'Ethan', 'realistic'),
  avatar('fb2395aa-ad97-4e54-9951-2bd2eb1a9767', 'Vivian', 'realistic'),
  avatar('566981dd-1d95-4844-953e-d67e18b2fde8', 'Adrian', 'realistic'),
  avatar('7b84da80-39f7-41f9-9074-94e7d01543df', 'Margaret', 'realistic'),
]

export function libraryAvatarById(id: unknown): LibraryAvatar | null {
  return typeof id === 'string' ? LIBRARY_AVATARS.find((a) => a.id === id) ?? null : null
}
