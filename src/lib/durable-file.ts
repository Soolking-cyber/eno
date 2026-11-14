import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Write `text` to `dir/name` so that a crash or a power cut leaves the old file or the new one, never half of one,
 * and never a rename the disk forgot: the temp file is fsynced before the rename, the directory after it (commit gate,
 * codex 2026-11-14 — an undo journal that a power cut loses is no way back). The pattern of
 * scripts/expire-apartment-rentals.ts, shared. (On macOS Node's fsync is libuv's, which issues F_FULLFSYNC.)
 */
/**
 * mkdir -p whose NEW directories survive a power cut: each parent entry from the first directory it made down is
 * fsynced (commit gate, codex rounds 4 + 17 — a directory made elsewhere first must not skip this).
 */
export function mkdirDurably(dir: string): void {
  // The first directory this call CREATED (undefined when the whole chain existed).
  const created = mkdirSync(dir, { recursive: true })
  if (!created) return
  const top = resolve(created)
  for (let d = resolve(dir); ; d = dirname(d)) { fsyncDir(dirname(d)); if (d === top || d === dirname(d)) break }
}

export function writeFileDurably(dir: string, name: string, text: string): void {
  mkdirDurably(dir)
  const path = join(dir, name)
  const tmp = `${path}.tmp-${process.pid}`
  const buf = Buffer.from(text)
  const fd = openSync(tmp, 'w', 0o600)
  try {
    for (let off = 0; off < buf.length;) off += writeSync(fd, buf, off, buf.length - off)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  renameSync(tmp, path)
  fsyncDir(dir)
}

function fsyncDir(dir: string): void {
  const dfd = openSync(dir, 'r')
  try { fsyncSync(dfd) } finally { closeSync(dfd) }
}
