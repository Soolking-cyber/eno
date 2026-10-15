import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'

vi.mock('server-only', () => ({}))
const { readImportFile, roughPdfPages, IMPORT_MAX_PDF_PAGES } = await import('@/lib/teachers/import-file')

const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`
const documentXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
const docx = (xml: string, extra: Record<string, Uint8Array> = {}) =>
  zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml), ...extra })

const pdf = (pages: number, extra = '') =>
  Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Pages /Count ${pages} >> endobj\n${Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj`).join('\n')}\n${extra}\n%%EOF`, 'latin1')

describe('readImportFile', () => {
  it('a PDF passes through as inline bytes', async () => {
    const r = await readImportFile(pdf(2))
    expect(r).toMatchObject({ kind: 'pdf', mimeType: 'application/pdf' })
  })

  it('counts page objects, never the /Pages tree node', () => {
    expect(roughPdfPages(pdf(3))).toBe(3)
  })

  it('refuses a long PDF and a locked one', async () => {
    expect(await readImportFile(pdf(IMPORT_MAX_PDF_PAGES + 1))).toBe('import_too_long')
    expect(await readImportFile(pdf(1, 'trailer << /Root 1 0 R /Encrypt 9 0 R >>'))).toBe('import_locked')
  })

  it('never opens a ZIP (a Word file is read in the browser)', async () => {
    expect(await readImportFile(docx(documentXml(para(run('Jane Smith — English teacher with six years in Hanoi.')))))).toBe('import_type')
  })

  it('a photo is re-encoded as JPEG (EXIF gone), bounded', async () => {
    const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#fff' } }).png().toBuffer()
    const r = await readImportFile(png)
    expect(r).toMatchObject({ kind: 'image', mimeType: 'image/jpeg' })
    const meta = await sharp((r as { data: Buffer }).data).metadata()
    expect(meta.width).toBe(2000)
    expect(meta.exif).toBeUndefined()
  })

  it('a transparent image is flattened onto WHITE, never black (dark text stays readable)', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const r = await readImportFile(png)
    const { data } = await sharp((r as { data: Buffer }).data).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(240)
  })

  it('refuses anything else, and an empty body', async () => {
    expect(await readImportFile(Buffer.from('GIF89a....'))).toBe('import_type')
    expect(await readImportFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('import_type')
    expect(await readImportFile(new Uint8Array())).toBe('import_empty')
  })
})
