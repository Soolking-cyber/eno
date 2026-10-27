import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICES } from './voices'

/**
 * ⛔ ONE LIST IN THREE FILES (voices.ts's header): the picker's allowlist, the speech server's own allowlist, and the voices
 * its image is built with. A voice in the picker but not the server is a teacher whose avatar falls silent; one in the
 * server but not the image fails the server at start. Read as text — the Python is never run here.
 */
const DIR = join(__dirname, '../../../infra/vn-node/classroom-speech')

function serverVoices(): string[] {
  const src = readFileSync(join(DIR, 'server.py'), 'utf8')
  const m = src.match(/^VOICES = \(([\s\S]*?)\)[ \t]*(?:#.*)?$/m)
  if (!m) throw new Error('VOICES tuple not found in server.py')
  return [...m[1].replace(/#.*$/gm, '').matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function imageVoices(): string[] {
  const src = readFileSync(join(DIR, 'fetch_models.py'), 'utf8')
  const m = src.match(/^VOICES = \{([\s\S]*?)\}\s*$/m)
  if (!m) throw new Error('VOICES dict not found in fetch_models.py')
  return [...m[1].matchAll(/'([^']+)':\s*'[^']+'/g)].map((x) => x[1])
}

describe('the voice list agrees in all three places', () => {
  it('picker = server = image', () => {
    const ids = VOICES.map((v) => v.id).sort()
    expect(serverVoices().sort()).toEqual(ids)
    expect(imageVoices().sort()).toEqual(ids)
  })
})

/** Soniox's tts-rt-v2 catalogue as GET /v1/tts-models listed it on 2026-10-27 — a name not in it is refused at Soniox. */
const SONIOX_VOICES_2026_10_27 = new Set(["Aarav", "Adrian", "Aiman", "Alessandro", "Alistair", "Alonso", "Alvaro", "Aman", "Andrei", "Annika", "Antoine", "Aoi", "Arabella", "Arjun", "Arthur", "Ashok", "Baptiste", "Bayu", "Bennett", "Bernardo", "Bhavana", "Bianca", "Bohdan", "Bonnie", "Brooke", "Bruna", "Bryce", "Budi", "Camila", "Camille", "Carmen", "Celine", "Colleen", "Cooper", "Cordelia", "Curtis", "Daeho", "Damian", "Daniel", "Davide", "Deepa", "Dev", "Diogo", "Divya", "Dominic", "Duarte", "Elliot", "Elodie", "Emerson", "Emiliano", "Emilio", "Emma", "Evan", "Facundo", "Faisal", "Florian", "Freddie", "Freya", "Genevieve", "Gilang", "Giulia", "Giulio", "Grace", "Guillermo", "Gurpreet", "Haoran", "Harlan", "Harper", "Haruto", "Hazel", "Hector", "Hikari", "Hind", "Huong", "Hyunwoo", "Imogen", "Iris", "Ishita", "Isla", "Javier", "Jihoon", "Jiwoo", "Jonas", "Juliana", "Julien", "Juliet", "Junseo", "Kabir", "Karan", "Karim", "Karthik", "Kavya", "Kayla", "Kenji", "Kirill", "Konrad", "Larissa", "Layla", "Leandro", "Lekha", "Lena", "Linh", "Logan", "Lorenzo", "Lucia", "Madhura", "Mai", "Manav", "Manon", "Marco", "Marek", "Margo", "Mariana", "Maricel", "Marlene", "Marta", "Mason", "Massimo", "Mateo", "Mathieu", "Matilde", "Matthias", "Meena", "Meilin", "Miles", "Mina", "Minjun", "Mohan", "Nanami", "Nathan", "Nigel", "Nikhil", "Nina", "Nisha", "Noemie", "Nora", "Nuno", "Nurul", "Oliver", "Olivier", "Owen", "Paulina", "Piper", "Poppy", "Preston", "Priya", "Rafael", "Rajan", "Rania", "Reese", "Reid", "Reinhard", "Renata", "Reyna", "Riccardo", "Riku", "Rina", "Rizky", "Rodrigo", "Rohan", "Ruby", "Rui", "Russell", "Sakura", "Santiago", "Sari", "Sebastian", "Seojun", "Sergio", "Shalini", "Shane", "Silas", "Sloane", "Sneha", "Sota", "Stefan", "Sundar", "Surya", "Szymon", "Taras", "Thiago", "Tobias", "Trevor", "Tunde", "Vadim", "Valentina", "Valeria", "Vani", "Venkat", "Victoria", "Vinicius", "Wahyu", "Walter", "Wei", "Wesley", "Yana", "Yousef", "Yuki", "Yuto", "Zihan"])

describe('each voice names the Soniox voice that speaks it (owner, 2026-10-27: "soniox voice turn on")', () => {
  it('every one exists at Soniox (review, opus: a wrong name would send every line to the box)', () => {
    for (const v of VOICES) expect(SONIOX_VOICES_2026_10_27.has(v.soniox), v.soniox).toBe(true)
  })
  it('every picker voice has one, and no two share it', () => {
    const named = VOICES.map((v) => v.soniox)
    expect(named.every((n) => typeof n === 'string' && /^[A-Z][a-z]+$/.test(n))).toBe(true)
    expect(new Set(named).size).toBe(named.length)
  })
})

