import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { DROPDOWN_PANEL_Z, DROPDOWN_SCRIM_Z, PANEL_SCRIM_Z, PANEL_Z } from './dropdown-layers'

const n = (cls: string) => Number(/^z-\[(\d+)\]$/.exec(cls)?.[1])
/** This file's own four layers: the ones the guard below measures everything ELSE against. */
const OWN = [PANEL_SCRIM_Z, PANEL_Z, DROPDOWN_SCRIM_Z, DROPDOWN_PANEL_Z].map((c) => n(c))
const themeZ = (name: string) => Number(new RegExp(`--z-index-${name}:\\s*(\\d+);`).exec(readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8'))?.[1])

describe('the page-level dropdown layers (owner 2026-11-19: "why price dropdown doesnt blur")', () => {
  it('each scrim sits one under its panel', () => {
    expect(n(PANEL_Z)).toBe(n(PANEL_SCRIM_Z) + 1)
    expect(n(DROPDOWN_PANEL_Z)).toBe(n(DROPDOWN_SCRIM_Z) + 1)
  })
  it('the panels clear the header, the floating buttons, the tab bar, the map overlays and every chrome layer in the code', () => {
    for (const z of [themeZ('overlay'), themeZ('fab'), themeZ('nav'), themeZ('map-overlay')]) {
      expect(Number.isFinite(z)).toBe(true)
      expect(n(PANEL_SCRIM_Z)).toBeGreaterThan(z)
    }
    // Every arbitrary z-[N] in src except the two full-screen sheets (z-[1099] / z-[1100], which no panel opens over) and the
    // select / debug layers far above — the header's neighbours, map labels, chips, anything new up to 100 past the panels.
    // Read from the code, so a chrome layer that climbs to or past the panels fails here.
    const chrome = execFileSync('grep', ['-rhoE', '\\bz-\\[[0-9]+\\]', 'src', '--include=*.tsx', '--include=*.ts'], { encoding: 'utf8' })
      .split('\n').map(n).filter((z) => Number.isFinite(z) && ![1099, 1100, ...OWN].includes(z) && z < n(PANEL_SCRIM_Z) + 100)
    expect(chrome.length).toBeGreaterThan(0)
    expect(n(PANEL_SCRIM_Z)).toBeGreaterThan(Math.max(...chrome))
  })
  it('⛔ a select opened INSIDE a panel (the Filters panel holds one) still covers that panel', () => {
    expect(n(DROPDOWN_SCRIM_Z)).toBeGreaterThan(n(PANEL_Z))
  })
})
