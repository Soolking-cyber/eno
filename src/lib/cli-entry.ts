/**
 * IS THIS MODULE THE SCRIPT THAT WAS RUN? — for a script whose pure half is imported by a unit test,
 * so its `main()` must run when executed and never when imported.
 *
 * ⛔ COMPARE REAL PATHS. The usual `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE
 * when the script is started through a symlinked path — macOS's /tmp → /private/tmp, a symlinked
 * checkout — because argv[1] keeps the link while the module URL is the resolved file. The script then
 * imports, skips main() and exits 0 with no output: measured 2026-09-24,
 * `npx tsx <symlinked dir>/scripts/import-batdongsan-rentals.ts` printed nothing at all (agy + opus).
 * For an importer that USED to run main() unconditionally, and for a one-off whose --apply writes to
 * production, a silent no-op is indistinguishable from "nothing to do".
 *
 * PURE apart from reading the filesystem's links; imported by scripts only, never by the app.
 */
import { realpathSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const real = (p: string) => {
  try { return realpathSync(p) } catch { return resolve(p) }
}

/**
 * ⚠️ AND WITH OR WITHOUT THE EXTENSION. `npx tsx scripts/localize-import-listings` (no ".ts") runs
 * the file but leaves argv[1] extensionless — measured 2026-09-24: the old check skipped main() and
 * exited 0 in silence on exactly that command (opus). So an extensionless argv[1] is also tried with
 * the module's own extension, then compared on real paths like any other.
 */
export function invokedDirectly(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false
  const modulePath = real(fileURLToPath(moduleUrl))
  if (real(argv1) === modulePath) return true
  const ext = extname(modulePath)
  return !!ext && !extname(argv1) && real(argv1 + ext) === modulePath
}
