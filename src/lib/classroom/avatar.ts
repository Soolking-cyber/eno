import 'server-only'
import { db } from '@/lib/db'
import { teacherTextRefusal } from '@/lib/teachers/text-screen'
import type { PublishBlockCode } from '@/lib/publish-guard'
import { AVATAR_NAME_MAX, BEST_FOR_MAX, PERSONA_MAX, cleanText, parseTraits, type Traits } from './persona'
import { voiceById } from './voices'
import { libraryAvatarById } from './library-avatars'
import { AVATAR_LOOKS, type AvatarLook } from './constants'

/** The teacher behind the classroom: the account's TeacherProfile (one per account), or null. */
export async function teacherForClassroom(profileId: string) {
  return db.teacherProfile.findUnique({
    where: { profileId },
    select: { id: true, profileId: true, fullName: true, photoUrl: true, nationality: true, status: true },
  })
}

export const GREETING_MAX = 200

export type AvatarInput = {
  name: string
  /** Who this tutor suits ("calm, for shy beginners") — the tutor card's line. */
  bestFor: string
  /** The teacher's own uploaded room (ClassroomBackground id), null for the library room in traits, or UNDEFINED when the
   *  request did not say — left as it is (commit gate, opus: a client that never sends it must not wipe a room). Its
   *  OWNERSHIP is the route's to check (tutors routes: backgroundOfTeacher) — this only reads the shape. */
  backgroundId?: string | null
  /** Speak in the teacher's own voice (own-voice.ts) — UNDEFINED when the request did not say (left as it is). True only while
   *  that voice is ready: the route's to check (ownVoiceReady), like the room's ownership. */
  ownVoice?: boolean
  /** What a save writes for it: the teacher's ready voice's id (on), null (off), undefined (left as it is) — the route's. */
  ownVoiceId?: string | null
  persona: string
  greeting: string
  traits: Traits
  voice: string
  look: AvatarLook
  libraryAvatarId: string | null
}

export type AvatarRefusal = 'name_required' | 'voice_invalid' | 'look_invalid' | PublishBlockCode

/**
 * The submitted avatar → what may be saved, or why not. Pure (the current custom status comes in as an argument).
 * ⛔ `custom` is only the teacher's to pick once their likeness is READY — a request in the queue is not a face.
 * ⛔ Every free text goes through the teacher text screen (contact details, banned words, visa wording — text-screen.ts):
 * the persona becomes the avatar's voice in a class, so it is held to the profile's own rules.
 */
export function validateAvatar(raw: Record<string, unknown>, customStatus: string): { ok: true; value: AvatarInput } | { ok: false; code: AvatarRefusal } {
  const name = cleanText(raw.name, AVATAR_NAME_MAX).replace(/\n/g, ' ')
  if (!name) return { ok: false, code: 'name_required' }
  const persona = cleanText(raw.persona, PERSONA_MAX)
  const greeting = cleanText(raw.greeting, GREETING_MAX).replace(/\n/g, ' ')
  const bestFor = cleanText(raw.bestFor, BEST_FOR_MAX).replace(/\n/g, ' ')
  const backgroundId = !('backgroundId' in raw) || raw.backgroundId === undefined ? undefined
    : raw.backgroundId === null ? null
      : typeof raw.backgroundId === 'string' && raw.backgroundId.length > 0 && raw.backgroundId.length <= 64 ? raw.backgroundId : false
  if (backgroundId === false) return { ok: false, code: 'look_invalid' }
  if (raw.ownVoice !== undefined && typeof raw.ownVoice !== 'boolean') return { ok: false, code: 'voice_invalid' }
  const ownVoice = raw.ownVoice as boolean | undefined
  const voice = voiceById(raw.voice)
  if (!voice) return { ok: false, code: 'voice_invalid' }
  const look = (AVATAR_LOOKS as readonly string[]).includes(String(raw.look)) ? (raw.look as AvatarLook) : null
  if (!look) return { ok: false, code: 'look_invalid' }
  let libraryAvatarId: string | null = null
  if (look === 'library') {
    const a = libraryAvatarById(raw.libraryAvatarId)
    if (!a) return { ok: false, code: 'look_invalid' }
    libraryAvatarId = a.id
  }
  if (look === 'custom' && customStatus !== 'ready') return { ok: false, code: 'look_invalid' }
  for (const [field, text] of [['name', name], ['bestFor', bestFor], ['persona', persona], ['greeting', greeting]] as const) {
    const code = teacherTextRefusal(field === 'name' || field === 'bestFor' ? 'headline' : 'bio', text)
    if (code) return { ok: false, code }
  }
  return { ok: true, value: { name, bestFor, backgroundId, ownVoice, persona, greeting, traits: parseTraits(raw.traits), voice: voice.id, look, libraryAvatarId } }
}

/** The columns a save writes (tutors.ts). */
export function avatarData(v: AvatarInput) {
  return {
    name: v.name, bestFor: v.bestFor, ...(v.backgroundId !== undefined ? { backgroundId: v.backgroundId } : {}), ...(v.ownVoiceId !== undefined ? { ownVoiceId: v.ownVoiceId } : {}), persona: v.persona, greeting: v.greeting, traits: v.traits, voice: v.voice, look: v.look,
    libraryAvatarId: v.libraryAvatarId,
  }
}

export const AVATAR_SELECT = {
  id: true, name: true, bestFor: true, backgroundId: true, ownVoiceId: true, persona: true, greeting: true, traits: true, voice: true, look: true, libraryAvatarId: true,
  customStatus: true, photoConsentAt: true, createdAt: true, updatedAt: true,
} as const
