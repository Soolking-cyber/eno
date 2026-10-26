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
