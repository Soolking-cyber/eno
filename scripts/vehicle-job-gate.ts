/**
 * The every-3-days gate of the vehicle refresh — the CLI half (the rule and its tests: src/lib/vehicle-job-gate.ts).
 * scripts/vehicle-rentals-weekly.sh asks it first on every --apply run the daily LaunchAgent starts:
 *
 *   npx tsx scripts/vehicle-job-gate.ts --stamp ~/eno-import-journals/vehicles/.last-success
 *
 * exit 0  = due: run (also when no stamp exists yet, or it cannot be read as a date)
 * exit 10 = not due: the last successful run is under 66 h old — the job stops quietly
 * exit 1  = the stamp file exists but cannot be read (permissions, a directory): the job fails loudly
 */
import { readFileSync } from 'node:fs'
import { successGate } from '../src/lib/vehicle-job-gate'

const i = process.argv.indexOf('--stamp')
const path = i > -1 ? process.argv[i + 1] : undefined
if (!path || path.startsWith('--')) { console.error('usage: npx tsx scripts/vehicle-job-gate.ts --stamp <file>'); process.exit(1) }
let stamp: string | null = null
try {
  stamp = readFileSync(path, 'utf8')
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { console.error(`cannot read ${path}: ${(e as Error).message}`); process.exit(1) }
}
const gate = successGate(stamp, Date.now())
console.log(gate.reason)
process.exit(gate.due ? 0 : 10)
