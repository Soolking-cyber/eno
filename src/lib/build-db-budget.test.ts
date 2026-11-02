import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { poolConfig } from './db-pool-config'

/**
 * ⛔ A build on a Mac must leave room on the production database (next.config.ts, 2026-11-02). Uncapped, 45 connections on top of ~60 live went past ~97, and
 * Postgres refused the live apps as well as the build. Capped, the peak measured 12 (lsof on the tunnel, during a build).
 */
describe('a build on a Mac', () => {
  const config = readFileSync('next.config.ts', 'utf8')
  const cpus = Number(config.match(/MAC_BUILD_CPUS = (\d+)/)?.[1])
  const perWorker = poolConfig({ url: 'postgres://x', build: true, server: false }).max as number

  it('is capped on every Mac, with nothing to match first that could miss', () => {
    expect(config).toMatch(/\.\.\.\(process\.platform === 'darwin' \? \{ cpus: MAC_BUILD_CPUS \} : \{\}\),\n\s+inlineCss/)
  })

  it('stays at the measured cost: raising it needs a new measurement, not a passing sum', () => {
    expect(cpus * perWorker).toBeLessThanOrEqual(12)
  })
})
