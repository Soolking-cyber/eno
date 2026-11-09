/**
 * WHAT A TEACHER READS ALOUD FOR THEIR OWN VOICE (2026-11-09, own-voice.ts). A few sentences drawn at random from this pool,
 * different every time and good for one recording: a recording made earlier — or of someone else — does not say them.
 * ⚠️ It proves the WORDS were read for this attempt, NOT who read them (plan review, codex + opus): a friction for the staff
 * pilot, not an identity check. The sentences are a teacher's own register — calm, clear, the voice students will hear —
 * with the sounds a voice is recognised by (vowels, sibilants, plosives, a question's rise).
 * Client-safe and pure.
 */
export const SENTENCES: readonly string[] = [
  'Good morning, everyone. Let us start with a short warm-up before we open our books.',
  'Can you tell me what you did last weekend? Take your time and use full sentences.',
  'That is a very good answer. Now try to say it again a little more slowly.',
  'Listen carefully to the question, and then think about your answer before you speak.',
  'We are going to practise the past tense today, with some useful everyday verbs.',
  'Please repeat after me: the quick brown fox jumps over the lazy dog.',
  'If you are not sure about a word, it is perfectly fine to ask me what it means.',
  'Our topic this week is travel, so think about a place you would really like to visit.',
  'Remember to look at the person you are talking to, and smile when you greet them.',
  'Which do you prefer, coffee or tea? Tell me why in two or three sentences.',
  'Mistakes are part of learning, so do not worry if your sentence is not perfect.',
  'Let us read the story together. I will read one line, and then you read the next.',
  'Excellent pronunciation. Your vowels were clear and your rhythm was natural.',
  'How many people are there in your family, and what do they like to do together?',
  'Before we finish, I would like you to tell me three new words you learned today.',
  'Shall we play a quick game? I describe something, and you guess what it is.',
  'This sound is a little tricky. Put the tip of your tongue behind your top teeth.',
  'Imagine you are ordering food in a restaurant. What would you say to the waiter?',
  'Thank you for your hard work today. I am really proud of the progress you made.',
  'Next time, we will talk about hobbies, so think about what you enjoy doing.',
  'Could you spell your name for me, please, one letter at a time?',
  'When the weather is warm, many families in the city go to the park on Sunday.',
  'Try to link the words together, so the sentence sounds smooth and relaxed.',
  'What time do you usually wake up on a school day, and what do you eat for breakfast?',
  'Let us check the homework. Who would like to read the first answer?',
  'A question goes up at the end, like this: are you ready? A statement goes down.',
  'Six thick thistle sticks, and a shy fish swimming in a shallow sea.',
  'Please write down three things you can see in this picture, then describe them.',
  'Well done for speaking so clearly. Your confidence is growing every week.',
  'Is it better to live in a big city or a small village? Give me one reason.',
  'Today is a good day to learn something new, so let us begin with a smile.',
  'If you could meet anyone in the world, who would it be, and what would you ask?',
  'Read the sentence once silently, and then read it to me out loud.',
  'My favourite season is autumn, because the air is cool and the leaves change colour.',
  'We will take a short break now. Drink some water and we will continue in a minute.',
  'Can you describe your best friend? What do they look like, and why do you like them?',
  'Put these words in the right order to make a question, and then ask your partner.',
  'Good listening! You heard every detail in that conversation.',
  'Tomorrow, we will practise telling the time, so bring a watch if you have one.',
  'That was our lesson for today. See you next time, and keep practising at home.',
]

/** Sentences per recording: ~45–60 s read calmly — inside Soniox's two minutes, enough for a good clone. */
export const SCRIPT_LENGTH = 6

/** `n` distinct sentence indexes in a random order. `random` returns [0, 1) (the server passes a CSPRNG). */
export function pickScript(random: () => number, n = SCRIPT_LENGTH): number[] {
  const pool = SENTENCES.map((_, i) => i)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n)
}

/** The stored form (ClassroomVoice.script: the DDL's pattern) and back. Null for anything that is not a script. */
export const scriptKey = (indexes: readonly number[]) => indexes.join(',')
export function scriptOf(key: string): string[] | null {
  if (!/^[0-9]{1,3}(,[0-9]{1,3}){3,9}$/.test(key)) return null
  const idx = key.split(',').map(Number)
  if (new Set(idx).size !== idx.length || idx.some((i) => !SENTENCES[i])) return null
  return idx.map((i) => SENTENCES[i])
}

/** Lower-case words, letters and digits only — what a transcript and a script are compared on. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean)
}

/**
 * How much of the script was read, IN ORDER: the longest common subsequence of the words over the script's word count
 * (0–1). Extra words (a cough, "sorry", a re-read) cost nothing; skipped or other words lower it.
 */
export function scriptMatch(transcript: string, script: readonly string[]): number {
  const want = wordsOf(script.join(' '))
  const got = wordsOf(transcript)
  if (!want.length) return 0
  // One row of the LCS table at a time: O(want × got) time, O(want) memory (≤ ~150 × ~400 words).
  let prev = new Uint16Array(want.length + 1)
  for (const g of got) {
    const row = new Uint16Array(want.length + 1)
    for (let j = 1; j <= want.length; j++) row[j] = want[j - 1] === g ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    prev = row
  }
  return prev[want.length] / want.length
}

/** Read well enough to be this attempt's script (the STT misses a word here and there; a different text scores far lower). */
export const SCRIPT_MATCH_MIN = 0.75
