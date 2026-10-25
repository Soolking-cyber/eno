import 'server-only'
import { db } from '@/lib/db'
import { teacherTextRefusal } from '@/lib/teachers/text-screen'
import type { PublishBlockCode } from '@/lib/publish-guard'
import { AVATAR_NAME_MAX, PERSONA_MAX, cleanText, parseTraits, type Traits } from './persona'
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
  for (const [field, text] of [['name', name], ['persona', persona], ['greeting', greeting]] as const) {
    const code = teacherTextRefusal(field === 'name' ? 'headline' : 'bio', text)
    if (code) return { ok: false, code }
  }
  return { ok: true, value: { name, persona, greeting, traits: parseTraits(raw.traits), voice: voice.id, look, libraryAvatarId } }
}

export async function saveAvatar(teacherProfileId: string, v: AvatarInput) {
  const now = new Date()
  const data = {
    name: v.name, persona: v.persona, greeting: v.greeting, traits: v.traits, voice: v.voice, look: v.look,
    libraryAvatarId: v.libraryAvatarId, updatedAt: now,
  }
  return db.classroomAvatar.upsert({
    where: { teacherProfileId },
    create: { teacherProfileId, ...data },
    update: data,
    select: AVATAR_SELECT,
  })
}

export const AVATAR_SELECT = {
  id: true, name: true, persona: true, greeting: true, traits: true, voice: true, look: true, libraryAvatarId: true,
  customStatus: true, photoConsentAt: true, updatedAt: true,
} as const
