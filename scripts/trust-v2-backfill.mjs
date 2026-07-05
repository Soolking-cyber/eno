// Trust v2 backfill — thin wrapper over trust-v2-dryrun.mjs --write so the dry-run's
// predictions and the backfill's writes share ONE code path and can never diverge.
// Prints the full dry-run report first, then commits Profile/Seller/Listing trust
// mirrors in a single transaction. AFTER this, run scripts/backfill-listing-rankscore.mjs
// (browse ranking reads trust via rankScore).
//   set -a; . ./.env; set +a; node scripts/trust-v2-backfill.mjs
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dryrun = join(dirname(fileURLToPath(import.meta.url)), 'trust-v2-dryrun.mjs')
const child = spawn(process.execPath, [dryrun, '--write'], { stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code ?? 1))
