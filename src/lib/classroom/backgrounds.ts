/**
 * THE ROOM BEHIND THE AVATAR (owner, 2026-10-27: "let the teacher set the background for avatar so students feel like they
 * are in classroom with teacher"). The teacher picks one; the learner's session draws the avatar in front of it. Generated
 * for eno with Gemini 2.5 Flash Image on eno's own Vertex project (eno owns them) — public/classroom/backgrounds, a
 * 768×1344 WebP and a thumbnail each. `plain` is the screen's own brand colour. Kept in the avatar's `traits` (persona.ts) —
 * no column of its own.
 */
export const BACKGROUNDS = ['classroom', 'study', 'library', 'tutoring', 'kids', 'cafe', 'plain'] as const
export type Background = (typeof BACKGROUNDS)[number]
export const DEFAULT_BACKGROUND: Background = 'classroom'

export const BACKGROUND_LABEL: Record<Background, { en: string; vi: string }> = {
  classroom: { en: 'Classroom', vi: 'Lớp học' },
  study: { en: 'Study room', vi: 'Phòng đọc sách' },
  library: { en: 'Library', vi: 'Thư viện' },
  tutoring: { en: 'Tutoring room', vi: 'Phòng học riêng' },
  kids: { en: 'Kids’ classroom', vi: 'Lớp học thiếu nhi' },
  cafe: { en: 'Café', vi: 'Quán cà phê' },
  plain: { en: 'Plain', vi: 'Nền trơn' },
}

export const isBackground = (v: unknown): v is Background => typeof v === 'string' && (BACKGROUNDS as readonly string[]).includes(v)

/** The picture behind the avatar, or null for `plain`. */
export const backgroundImage = (b: Background): string | null => (b === 'plain' ? null : `/classroom/backgrounds/${b}.webp`)
/** Its small version for the teacher's picker, or null for `plain`. */
export const backgroundThumb = (b: Background): string | null => (b === 'plain' ? null : `/classroom/backgrounds/${b}-thumb.webp`)
