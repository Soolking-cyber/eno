import { createHash } from 'node:crypto'

/**
 * WHAT A REVIEW APPROVED — a short digest of a guide's content (SHA-256 of `JSON.stringify` of the parsed
 * JSON, first 16 hex). The registry stores the digest next to the `reviewed` date (integrate.py computes it
 * the same way, from the same JSON, when the owner approves), and content.ts refuses to build a reviewed
 * guide whose content no longer matches: a guide edited after its review must be reviewed again before it
 * can keep saying it was. Server-only (node:crypto); never import it from a client component.
 */
export function contentDigest(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 16)
}
