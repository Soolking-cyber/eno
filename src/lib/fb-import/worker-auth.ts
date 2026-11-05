import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/** The one credential the worker holds. It opens these two routes and nothing else. No token set: the routes don't exist. */
export function workerAuthorized(req: Request): boolean {
  const secret = process.env.FB_IMPORT_WORKER_TOKEN?.trim()
  if (!secret) return false
  const header = req.headers.get('authorization')
  const a = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '')
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}
