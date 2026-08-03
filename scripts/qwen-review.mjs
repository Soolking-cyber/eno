#!/usr/bin/env node
// ── Qwen 3.8 Max reviewer — the THIRD external family in the second-opinion stack ───────────────
//
// Joins codex (GPT-5.6 sol) and agy (Gemini 3.1 Pro). The point of the stack is that the families
// fail DIFFERENTLY: on 2026-08-03 codex and agy independently caught the same false-promise bug in
// the OTP copy, but only agy found the US-number misroute and only codex spotted the dead
// channelHint(). A third family is another set of blind spots that are not ours.
//
//   node scripts/qwen-review.mjs prompt.txt          # prints the review to stdout
//   DASHSCOPE_API_KEY=… node scripts/qwen-review.mjs prompt.txt
//
// ⚠️ THE KEY NEVER LIVES IN THIS REPO. It is read from DASHSCOPE_API_KEY, or from ~/.eno-qwen-key
// (chmod 600) as a convenience. Do not add it to .env — that file is committed-adjacent and the
// project's standing rule is that secrets are surfaced for the owner to paste, never written by me.
//
// ⚠️ AND IT SENDS SOURCE TO A THIRD PARTY. Everything in the prompt leaves the machine and reaches
// Alibaba Cloud (Singapore). That is fine for reviewing OUR code and is the whole point, but never
// pipe .env, a secret, a database dump or user PII through here — a review is not worth a leak.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.DASHSCOPE_BASE || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
const MODEL = process.env.QWEN_MODEL || 'qwen3.8-max'

const keyFile = join(homedir(), '.eno-qwen-key')
const KEY = process.env.DASHSCOPE_API_KEY?.trim() || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '')
if (!KEY) {
  console.error('No key. Set DASHSCOPE_API_KEY, or put it in ~/.eno-qwen-key (chmod 600).')
  process.exit(2)
}

const promptFile = process.argv[2]
if (!promptFile || !existsSync(promptFile)) {
  console.error('usage: node scripts/qwen-review.mjs <prompt-file>')
  process.exit(2)
}
const prompt = readFileSync(promptFile, 'utf8')

// ⚠️ STREAMING IS MANDATORY HERE, NOT A NICETY. Measured 2026-08-03: a 47KB prompt with
// enable_thinking on NEVER returns over a non-streaming request — the connection just hangs and
// curl reports http=000 after minutes, because nothing is written while the model thinks and an
// intermediary drops the idle socket. A small prompt returns fine, so it reads as "works" until you
// send something real. Streaming writes a chunk every few hundred ms, which keeps the socket alive
// and turns a hang into progress you can watch. The owner's own DashScope sample streams for the
// same reason.
//
// Chunks are assembled here rather than printed raw: this is a batch reviewer whose output gets
// read after the fact, and a half-arrived review must be distinguishable from a complete one. If
// the stream ends with no content, this exits NON-ZERO — an empty answer is not a passed review.
const controller = new AbortController()
// Idle-based, not total: reset on every chunk, so a long-but-progressing review is never killed
// while a genuinely stalled one dies quickly.
const IDLE_MS = Number(process.env.QWEN_IDLE_MS || 120_000)
let idle = setTimeout(() => controller.abort(), IDLE_MS)
const bump = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), IDLE_MS) }

try {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      // Thinking mode: this is the deep-review seat, not a lookup. Costs latency, buys the kind of
      // cross-file reasoning that finds a gate enforced in one place and not another.
      enable_thinking: true,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 8000,
    }),
  })
  if (!res.ok) {
    console.error(`qwen HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
    process.exit(1)
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', answer = '', thinking = '', usage = null, sawAnswer = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bump()
    buf += dec.decode(value, { stream: true })
    // SSE frames are separated by a blank line; keep the tail, it may be a partial frame.
    const frames = buf.split('\n\n')
    buf = frames.pop() ?? ''
    for (const f of frames) {
      const line = f.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      let j
      try { j = JSON.parse(payload) } catch { continue }
      if (j.usage) usage = j.usage
      const d = j.choices?.[0]?.delta
      if (!d) continue
      if (d.reasoning_content) {
        thinking += d.reasoning_content
        if (!sawAnswer) process.stderr.write('.') // progress, on stderr so stdout stays the review
      }
      if (d.content) {
        if (!sawAnswer) { sawAnswer = true; process.stderr.write('\n') }
        answer += d.content
        process.stdout.write(d.content)
      }
    }
  }

  if (!answer.trim()) {
    console.error('\nqwen returned no content — treat as NO REVIEW, not as approval.')
    if (thinking) console.error(`(it produced ${thinking.length} chars of reasoning and no answer)`)
    process.exit(1)
  }
  process.stdout.write('\n')
  if (usage) console.error(`\n[qwen ${MODEL}] tokens in=${usage.prompt_tokens} out=${usage.completion_tokens}`)
} catch (e) {
  console.error(`\nqwen failed: ${e.name === 'AbortError' ? `no data for ${IDLE_MS / 1000}s (stalled)` : e.message}`)
  process.exit(1)
} finally {
  clearTimeout(idle)
}
