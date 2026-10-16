// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'

const compress = vi.hoisted(() => ({ out: null as File | null, fail: false }))
vi.mock('@/lib/normalize-image', () => ({
  compressImageFile: async (f: File) => { if (compress.fail) throw new Error('decode'); return compress.out ?? f },
}))
const { prepareImport } = await import('./teacher-import-panel')
const { TEACHER_IMPORT_NOTICE_VERSION } = await import('@/lib/teachers/import-notice')

const docx = (text: string) => zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
})
const file = (bytes: BlobPart, name: string, type = '') => new File([bytes], name, { type })

describe('prepareImport — the file as the route takes it', () => {
  it('a PDF goes as is, with the notice version and the language — and is kept to offer as the CV', async () => {
    const f = file(new Uint8Array(1000), 'cv.pdf', 'application/pdf')
    const r = await prepareImport(f, 'vi')
    if (typeof r === 'string') throw new Error(r)
    expect(r.body.get('file')).toBe(f)
    expect(r.body.get('notice')).toBe(TEACHER_IMPORT_NOTICE_VERSION)
    expect(r.body.get('lang')).toBe('vi')
    expect(r.keep).toBe(f)
  })
  it('a PDF over 8 MB is refused before it is sent', async () => {
    expect(await prepareImport(file(new Uint8Array(8 * 1024 * 1024 + 1), 'cv.pdf', 'application/pdf'), 'en')).toBe('import_size')
  })
  it('⛔ a Word file is read HERE and sent as its text — the server never opens a ZIP', async () => {
    const r = await prepareImport(file(new Uint8Array(docx('Jane Smith — English teacher, six years in Hanoi.')), 'cv.docx'), 'en')
    if (typeof r === 'string') throw new Error(r)
    expect(r.body.get('file')).toBeNull()
    expect(String(r.body.get('text'))).toContain('Jane Smith — English teacher')
    expect(r.keep).toBeNull()
  })
  it('a ".docx" that is not one, an old .doc, and anything else: refused with their own codes', async () => {
    expect(await prepareImport(file('not a zip', 'cv.docx'), 'en')).toBe('import_type')
    expect(await prepareImport(file('x', 'cv.doc', 'application/msword'), 'en')).toBe('import_doc')
    expect(await prepareImport(file('x', 'cv.pages'), 'en')).toBe('import_doc')
    expect(await prepareImport(file('x', 'cv.zip', 'application/zip'), 'en')).toBe('import_type')
  })
  it('a photo (HEIC included) is re-encoded small in the browser; one that cannot be decoded is said', async () => {
    compress.out = file(new Uint8Array(500), 'cv.webp', 'image/webp')
    const r = await prepareImport(file(new Uint8Array(5000), 'IMG_0001.HEIC', 'image/heic'), 'en')
    if (typeof r === 'string') throw new Error(r)
    expect((r.body.get('file') as File).name).toBe('cv.webp')
    expect(r.keep).toBeNull()
    compress.fail = true
    expect(await prepareImport(file(new Uint8Array(5000), 'cv.jpg', 'image/jpeg'), 'en')).toBe('import_unreadable')
  })
})
