/**
 * The avatar's CHARACTER (owner: "ai avatar customizable to teachers character") — the chips the teacher picks, and the
 * bounds of the persona text. Client-safe: the wizard renders these, the API validates with the same lists.
 */

export const TONES = ['warm', 'cheerful', 'calm', 'direct'] as const
export type Tone = (typeof TONES)[number]
export const PACES = ['slow', 'natural'] as const
export type Pace = (typeof PACES)[number]
/** Conversation topics the avatar likes to bring up — what a teacher would chat about with their own students. */
export const TOPICS = ['daily-life', 'school', 'work', 'travel', 'food', 'music', 'movies', 'sport', 'games', 'animals', 'nature', 'technology'] as const
export type Topic = (typeof TOPICS)[number]

export type Traits = { tone: Tone; pace: Pace; topics: Topic[] }

export const TONE_LABEL: Record<Tone, { en: string; vi: string }> = {
  warm: { en: 'Warm & patient', vi: 'Ấm áp & kiên nhẫn' },
  cheerful: { en: 'Cheerful & fun', vi: 'Vui vẻ & hài hước' },
  calm: { en: 'Calm & clear', vi: 'Điềm tĩnh & rõ ràng' },
  direct: { en: 'Direct & focused', vi: 'Thẳng thắn & tập trung' },
}
export const PACE_LABEL: Record<Pace, { en: string; vi: string }> = {
  slow: { en: 'Slow & simple', vi: 'Chậm & đơn giản' },
  natural: { en: 'Natural speed', vi: 'Tốc độ tự nhiên' },
}
export const TOPIC_LABEL: Record<Topic, { en: string; vi: string }> = {
  'daily-life': { en: 'Daily life', vi: 'Cuộc sống hằng ngày' },
  school: { en: 'School', vi: 'Trường học' },
  work: { en: 'Work', vi: 'Công việc' },
  travel: { en: 'Travel', vi: 'Du lịch' },
  food: { en: 'Food', vi: 'Ẩm thực' },
  music: { en: 'Music', vi: 'Âm nhạc' },
  movies: { en: 'Movies', vi: 'Phim ảnh' },
  sport: { en: 'Sport', vi: 'Thể thao' },
  games: { en: 'Games', vi: 'Trò chơi' },
  animals: { en: 'Animals', vi: 'Động vật' },
  nature: { en: 'Nature', vi: 'Thiên nhiên' },
  technology: { en: 'Technology', vi: 'Công nghệ' },
}

export const DEFAULT_TRAITS: Traits = { tone: 'warm', pace: 'natural', topics: ['daily-life', 'food', 'travel'] }
export const MAX_TOPICS = 5
/** The avatar's display name ("Ms Anna"). The DDL's CHECK allows 60; the form asks for 40. */
export const AVATAR_NAME_MAX = 40
/** The persona text the tutor plays — enough for a character, short enough to stay a character and not a script. */
export const PERSONA_MAX = 1200

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

/** Any stored or submitted value → valid traits (unknown entries dropped, defaults filled). Never throws. */
export function parseTraits(v: unknown): Traits {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const topics = Array.isArray(o.topics) ? [...new Set(o.topics.filter((t): t is Topic => isOneOf(TOPICS, t)))].slice(0, MAX_TOPICS) : DEFAULT_TRAITS.topics
  return {
    tone: isOneOf(TONES, o.tone) ? o.tone : DEFAULT_TRAITS.tone,
    pace: isOneOf(PACES, o.pace) ? o.pace : DEFAULT_TRAITS.pace,
    topics,
  }
}

/** Collapse whitespace and trim — what is stored and what the length limits measure. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}
