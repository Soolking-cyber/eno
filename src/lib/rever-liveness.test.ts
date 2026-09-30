import { describe, expect, it } from 'vitest'
import { classifyReverLiveness, reverStatusLabels, verdictFromLabels } from './rever-liveness'

const page = (badge: string, related = '') =>
  `<html><body><h1>Căn hộ Masteri Lumiere Riverside, diện tích 74m²</h1>
   <ul><li><span class="tooltip verified-tooltip"></span></li></ul>${badge}
   <section class="related">${related}</section></body></html>`
const LIVE_BADGE = '<span class="label-primary label-outline-blue">Sẵn sàng giao dịch</span>'
const RENTED_BADGE = '<span class="label-primary label-outline-blue">Đã thuê</span>'
const RELATED_RENTED = '<h3><a href="/thue/x">X</a></h3> </div> <div class="status rever-color">Đã thuê</div>'

describe('classifyReverLiveness', () => {
  it('reads an available listing from its own badge', () => {
    expect(classifyReverLiveness(200, page(LIVE_BADGE)).verdict).toBe('live')
  })

  it('reads a let listing from its own badge', () => {
    expect(classifyReverLiveness(200, page(RENTED_BADGE))).toEqual({ verdict: 'rented', http: 200, label: 'Đã thuê' })
  })

  it('ignores "Đã thuê" printed by RELATED listing cards — the live page must stay live', () => {
    const html = page(LIVE_BADGE, RELATED_RENTED.repeat(5))
    expect(html.split('Đã thuê').length - 1).toBe(5)
    expect(classifyReverLiveness(200, html).verdict).toBe('live')
  })

  it('sets a price-drop badge aside — live and let pages alike', () => {
    const drop = '<span class="label-danger">giảm 7%</span>'
    expect(classifyReverLiveness(200, page(drop + LIVE_BADGE)).verdict).toBe('live')
    expect(classifyReverLiveness(200, page(drop + RENTED_BADGE)).verdict).toBe('rented')
    expect(verdictFromLabels(200, ['giảm 10%', 'Đã thuê']).verdict).toBe('rented')
    expect(verdictFromLabels(200, ['giảm 10%']).verdict).toBe('unknown') // a drop with no status says nothing
  })

  it('treats 404 and 410 as gone', () => {
    expect(classifyReverLiveness(404, '').verdict).toBe('gone')
    expect(classifyReverLiveness(410, '').verdict).toBe('gone')
  })

  it('hides nothing it does not recognise', () => {
    expect(classifyReverLiveness(200, page('')).verdict).toBe('unknown') // no badge
    expect(classifyReverLiveness(200, page(LIVE_BADGE + RENTED_BADGE)).verdict).toBe('unknown') // two badges
    expect(classifyReverLiveness(200, page('<span class="label-x">Đang đàm phán</span>')).verdict).toBe('unknown')
    expect(classifyReverLiveness(200, `<html>${RENTED_BADGE}</html>`).verdict).toBe('unknown') // no detail header
    expect(classifyReverLiveness(503, page(RENTED_BADGE)).verdict).toBe('unknown')
    expect(classifyReverLiveness(301, page(RENTED_BADGE)).verdict).toBe('unknown')
  })

  it('matches a decomposed (NFD) badge the same as a composed one', () => {
    expect(classifyReverLiveness(200, page(RENTED_BADGE.normalize('NFD'))).verdict).toBe('rented')
    expect(reverStatusLabels(page(LIVE_BADGE.normalize('NFD')))).toEqual(['Sẵn sàng giao dịch'])
  })
})
