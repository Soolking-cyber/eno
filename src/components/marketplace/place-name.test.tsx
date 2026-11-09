// @vitest-environment jsdom
/**
 * A wholly administrative location is never machine-translated (best-practice gap 2026-11-10): "Huyện Nhà Bè (Xã Nhà Bè)"
 * read "La maison de la bête" for a French reader. Anything else still goes through useTr.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ lang: 'en', asked: [] as string[] }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string) => en }),
  // A stand-in machine translation: identity in en/vi (as the real useTr), "MT(…)" for every other language.
  useTr: (text: string) => { if (text) h.asked.push(text); return !text ? '' : h.lang === 'en' || h.lang === 'vi' ? text : `MT(${text})` },
}))

import { PlaceName, PopupPlace, usePlaceText } from './place-name'

function Probe({ location }: { location: string }) { return <span data-testid="p">{usePlaceText(location)}</span> }
const shown = (lang: string, location: string) => { h.lang = lang; h.asked = []; render(<Probe location={location} />); const t = screen.getByTestId('p').textContent; cleanup(); return t }

afterEach(cleanup)

describe('usePlaceText', () => {
  it('a wholly administrative place: its English spelling for every non-Vietnamese reader, never asked of MT', () => {
    expect(shown('en', 'Huyện Nhà Bè (Xã Nhà Bè)')).toBe('Nha Be District (Nha Be Commune)')
    expect(shown('fr', 'Huyện Nhà Bè (Xã Nhà Bè)')).toBe('Nha Be District (Nha Be Commune)')
    expect(h.asked).toEqual([])
    expect(shown('vi', 'Huyện Nhà Bè (Xã Nhà Bè)')).toBe('Huyện Nhà Bè (Xã Nhà Bè)')
  })
  it('anything else is translated as before', () => {
    expect(shown('fr', 'Vinhomes Central Park')).toBe('MT(Vinhomes Central Park)')
    expect(shown('en', 'Vinhomes Central Park')).toBe('Vinhomes Central Park')
  })
})

describe('PlaceName', () => {
  it('the Vietnamese for a Vietnamese reader, the English for anyone else', () => {
    h.lang = 'vi'; render(<PlaceName en="District 7" vi="Quận 7" />); expect(document.body.textContent).toBe('Quận 7'); cleanup()
    h.lang = 'de'; render(<PlaceName en="District 7" vi="Quận 7" />); expect(document.body.textContent).toBe('District 7')
  })
})

describe('PopupPlace — the map popup never mixes languages or repeats a place (2026-11-10)', () => {
  const line = (lang: string, district: string | null, location: string) => { h.lang = lang; render(<PopupPlace district={district} location={location} />); const t = document.body.textContent; cleanup(); return t }
  it('the district takes the location\'s register: spelled beside a spelled location, as stored beside a stored one', () => {
    expect(line('en', 'Quận Gò Vấp', 'Quận 12 (Phường An Phú Đông)')).toBe('Go Vap District, District 12 (An Phu Dong Ward)')
    expect(line('vi', 'Quận Gò Vấp', 'Quận 12 (Phường An Phú Đông)')).toBe('Quận Gò Vấp, Quận 12 (Phường An Phú Đông)')
    // A lone ward-level location may be a street, so it is not spelled — nor is the district beside it.
    expect(line('en', 'Quận 7', 'Phường Tân Phong')).toBe('Quận 7, Phường Tân Phong')
  })
  it('a location that already names the district drops it — as whole words, not a substring', () => {
    expect(line('en', 'Quận 7', 'Quận 7 (Phường Tân Phong)')).toBe('District 7 (Tan Phong Ward)')
    expect(line('vi', 'Quận 7', '123 Nguyễn Thị Thập, Quận 7 TP.HCM')).toBe('123 Nguyễn Thị Thập, Quận 7 TP.HCM') // review
    expect(line('vi', 'Quận 7', 'Quận 7 Phú Mỹ Hưng')).toBe('Quận 7 Phú Mỹ Hưng')
    expect(line('en', 'Quận 1', 'Quận 12')).toBe('District 1, District 12')
    expect(line('en', 'Quận 7', 'District 7, HCMC')).toBe('District 7, HCMC') // named in its spelled form (review)
    expect(line('vi', 'Quận 7', 'District 7, HCMC')).toBe('District 7, HCMC') // …for a Vietnamese reader too
  })
  it('a district that is not administrative stays as stored — never machine-translated', () => {
    h.asked = []
    expect(line('fr', 'Bình Thạnh', 'Vinhomes Central Park')).toBe('Bình Thạnh, MT(Vinhomes Central Park)')
    expect(h.asked).toEqual(['Vinhomes Central Park'])
  })
})
