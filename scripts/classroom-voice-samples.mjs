#!/usr/bin/env node
// The wizard's voice samples, MADE ONCE: public/classroom/voices/<id>.mp3 — every voice in src/lib/classroom/voices.ts
// saying VOICE_SAMPLE_LINE in its Soniox voice (soniox-tts.ts's protocol: tts-rt-v2 over the WebSocket, MP3, speed 1).
// Soniox speaks at about real time, so a sample made on the spot took ~5–6 s to start (owner, 2026-10-28: "loads very
// slow"); a static file plays at once. Run again whenever the line or a voice's `soniox` changes:
//   SONIOX_API_KEY=… node scripts/classroom-voice-samples.mjs      (or the key in ~/eno-soniox.key)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const src = readFileSync(join(ROOT, 'src/lib/classroom/voices.ts'), 'utf8')
const line = src.match(/export const VOICE_SAMPLE_LINE = "([^"]+)"/)?.[1]
const voices = [...src.matchAll(/\{ id: '(\w+)'[^}]*?soniox: '(\w+)' \}/g)].map((m) => ({ id: m[1], soniox: m[2] }))
if (!line || voices.length < 5) { console.error('could not read VOICE_SAMPLE_LINE / VOICES from voices.ts'); process.exit(1) }
const keyFile = `${process.env.HOME}/eno-soniox.key`
const key = (process.env.SONIOX_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8') : '')).trim().replace(/^['"]|['"]$/g, '')
if (key.length < 20) { console.error('no Soniox key (SONIOX_API_KEY or ~/eno-soniox.key)'); process.exit(1) }
const out = join(ROOT, 'public/classroom/voices')
mkdirSync(out, { recursive: true })

const ws = new WebSocket('wss://tts-rt.soniox.com/tts-websocket', ['soniox-api-key', key])
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('the socket did not open in 15 s')), 15_000)
  ws.onopen = () => { clearTimeout(t); resolve() }
  ws.onerror = () => { clearTimeout(t); reject(new Error('socket')) }
})
const lines = new Map()
// A dropped socket or a voice that never finishes fails the run — never a hang (review, codex).
ws.onclose = () => { for (const l of lines.values()) l.reject(new Error('the socket closed')) }
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data))
  const l = lines.get(m.stream_id)
  if (!l) return
  if (m.error_code) { l.reject(new Error(`${m.error_code} ${m.error_message}`)); return }
  if (m.audio) l.parts.push(Buffer.from(m.audio, 'base64'))
  if (m.terminated) l.resolve(Buffer.concat(l.parts))
}
// Every sample made first, then all written — a run that fails part-way leaves the old set whole.
const made = []
for (const v of voices) {
  const mp3 = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${v.id}: no sample in 60 s`)), 60_000)
    lines.set(v.id, { parts: [], resolve: (b) => { clearTimeout(t); lines.delete(v.id); resolve(b) }, reject: (e) => { clearTimeout(t); reject(e) } })
    ws.send(JSON.stringify({ stream_id: v.id, model: 'tts-rt-v2', language: 'en', voice: v.soniox, audio_format: 'mp3', speed: 1 }))
    ws.send(JSON.stringify({ stream_id: v.id, text: line, text_end: true }))
  })
  if (mp3.length < 10_000) throw new Error(`${v.id}: only ${mp3.length} bytes`)
  made.push({ v, mp3 })
}
ws.onclose = null
ws.close()
// Each file written beside its old one, then renamed over it (atomic per file); the manifest last.
for (const { v, mp3 } of made) writeFileSync(join(out, `${v.id}.mp3.new`), mp3)
for (const { v, mp3 } of made) {
  renameSync(join(out, `${v.id}.mp3.new`), join(out, `${v.id}.mp3`))
  console.log(`${v.id}.mp3 ← ${v.soniox} · ${Math.round(mp3.length / 1024)} KB`)
}
// What the files say, in whose voice — voices.test.ts fails when it no longer matches voices.ts (a stale sample).
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ line, voices: Object.fromEntries(voices.map((v) => [v.id, v.soniox])) }, null, 1) + '\n')
console.log('manifest.json')
