/**
 * An error as it may be LOGGED from a write that carried what a learner said (2a round 8, opus): a Prisma validation
 * error prints the call with its arguments — a transcript, a disclosure — and logError keeps the message. Only the
 * error's kind and code survive; the stack is dropped with the message it would repeat.
 */
export function quietError(e: unknown): Error {
  const o = (e && typeof e === 'object' ? e : {}) as { name?: unknown; code?: unknown }
  const name = typeof o.name === 'string' ? o.name : 'Error'
  const code = typeof o.code === 'string' ? o.code : ''
  const quiet = new Error(`${name}${code ? ` ${code}` : ''} (details withheld: the write carried learner text)`)
  quiet.name = name
  quiet.stack = undefined
  return quiet
}
