'use client'

import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { libraryAvatarById } from '@/lib/classroom/library-avatars'
import { backgroundThumb, type Background } from '@/lib/classroom/backgrounds'

/** What a tutor's picture needs: its face (a ready-made one, or the teacher's own photo) and the room behind it. */
export type TutorLook = { name: string; look: string; libraryAvatarId: string | null; background: Background }

/**
 * A TUTOR'S PICTURE (owner, 2026-11-09: tutors per student, "ui ux comes from practika app professional minimal"): the room
 * the students see, with the tutor's face in a ring in front of it — Praktika's video-call card. The ready-made faces'
 * pictures carry their own scenery, so the face sits in a circle rather than cut out onto the room.
 * Decorative: the tutor's name is always printed beside it by the caller.
 */
export function TutorFace({ tutor, photoUrl, size = 'md', className }: {
  tutor: TutorLook
  /** The teacher's profile photo: the face of a tutor that uses it (look `photo`, or the own 3D face, which has no picture). */
  photoUrl: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const thumb = backgroundThumb(tutor.background)
  const face = tutor.look === 'library' ? libraryAvatarById(tutor.libraryAvatarId) : null
  const ring = size === 'sm' ? 'size-9' : size === 'md' ? 'size-16' : 'size-28'
  return (
    <span aria-hidden className={cn(
      'relative flex shrink-0 items-center justify-center overflow-hidden bg-brand-deeper',
      size === 'sm' ? 'size-12 rounded-xl' : size === 'md' ? 'aspect-[3/4] w-28 rounded-2xl' : 'aspect-[3/4] w-full max-w-60 rounded-3xl',
      className,
    )}>
      {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
      {face
        ? <img src={face.preview} alt="" width={192} height={192} loading="lazy" className={cn('relative rounded-full object-cover ring-2 ring-white', ring)} />
        : <span className={cn('relative flex rounded-full ring-2 ring-white', ring)}><Avatar name={tutor.name} url={photoUrl} size={size === 'sm' ? 'sm' : size === 'md' ? 'lg' : '2xl'} className="size-full" /></span>}
    </span>
  )
}
