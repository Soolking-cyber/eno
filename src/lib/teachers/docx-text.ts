import { unzipSync } from 'fflate'
import { IMPORT_MAX_TEXT_CHARS } from '@/lib/teachers/import-limits'

/**
 * A WORD CV'S VISIBLE TEXT, READ IN THE BROWSER (teacher CV import, 2026-10-15). The server never opens a ZIP: fflate
 * sizes its output from the entry's declared size and keeps inflating past it, so a crafted .docx could block the box's
 * event loop for every visitor (src/lib/teachers/import-file.ts). Here the worst case is the uploader's own tab.
 *
 * ⛔ HIDDEN WORDS ARE DROPPED. About 1% of real CVs carry text a reader never sees — white, tiny or "hidden" runs —
 * aimed at AI screeners (USENIX Security 2026). A run marked hidden, coloured white or set below 3pt is left out before
 * the model reads the text, and only <w:t> text is read (never field codes or other XML).
 */

/** The route's own cap (import-limits.ts) — one number, so a Word CV cut here is never refused there. */
export const DOCX_MAX_TEXT_CHARS = IMPORT_MAX_TEXT_CHARS
const DOCX_MAX_ENTRIES = 500
const DOCX_MAX_XML_BYTES = 8 * 1024 * 1024
const DOCX_MAX_EDGE_PARTS = 12
const DOCX_MAX_EDGE_BYTES = 512 * 1024

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m
  })

/**
 * A run's properties say WORD hides it: marked hidden, or set under 3pt. ⚠️ Never by colour (gate review, 2026-10-16):
 * white text on a dark banner is how designed CVs print the name and the headings — the page behind a run is not
 * knowable here, and dropping it lost real answers. This is hygiene, NOT the defence: the model is told the file is data,
 * every answer is re-validated (import-map.ts) and the teacher checks each one — and the server takes plain text anyway.
 */
function invisible(props: string): boolean {
  if (/<w:vanish\b(?![^>]*w:val="(?:0|false)")/.test(props)) return true
  const size = /<w:sz\b[^>]*w:val="(\d+)"/.exec(props)?.[1]
  return !!size && Number(size) < 6 // half-points: under 3pt
}

/**
 * The styles (word/styles.xml) whose run properties hide their text — followed down `basedOn`, so a style built on a
 * hidden one is hidden too. ⛔ Hidden text set THROUGH A STYLE never shows a direct property on its run (gate review,
 * 2026-10-16): judging runs alone let a "hidden" character or paragraph style carry words to the model.
 */
export function hiddenStyleIds(stylesXml: string): ReadonlySet<string> {
  const own = new Map<string, { hidden: boolean; basedOn: string | null }>()
  for (const m of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = /w:styleId="([^"]+)"/.exec(m[1])?.[1]
    if (!id) continue
    const props = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(m[2])?.[1] ?? ''
    own.set(id, { hidden: invisible(props), basedOn: /<w:basedOn\b[^>]*w:val="([^"]+)"/.exec(m[2])?.[1] ?? null })
  }
  const hidden = new Set<string>()
  for (const id of own.keys()) {
    // At most 20 links: a style chain is a few deep; a cycle (a crafted file) stops here.
    for (let at: string | null = id, n = 0; at && n < 20; at = own.get(at)?.basedOn ?? null, n++) {
      if (own.get(at)?.hidden) { hidden.add(id); break }
    }
  }
  return hidden
}

/**
 * The visible text of word/document.xml: paragraphs as lines, tabs and breaks kept, hidden runs dropped — by their own
 * properties, or by the character or paragraph style they use (`hiddenStyles`, from hiddenStyleIds).
 * ⚠️ TWO SHAPES THE FIRST VERSION MISREAD (review, 2026-10-16): a text box's runs sit INSIDE the run that anchors the box,
 * so a run is judged only when it holds no other run (innermost) — never by the anchor's own properties — and Word
 * writes every text box twice (the DrawingML choice and a VML fallback), so the fallback copy is dropped first.
 */
export function docxBodyText(xml: string, hiddenStyles: ReadonlySet<string> = new Set()): string {
  // The fallback copy of every text box goes, and so do tab-stop DEFINITIONS (<w:tabs><w:tab …/></w:tabs> in a
  // paragraph's properties) — only a run's <w:tab/> is a tab in the text.
  const once = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '').replace(/<w:tabs\b[\s\S]*?<\/w:tabs>/g, '')
  const styleOf = (props: string, tag: 'rStyle' | 'pStyle') => new RegExp(`<w:${tag}\\b[^>]*w:val="([^"]+)"`).exec(props)?.[1]
  // A paragraph in a hidden paragraph style: its runs go with it (innermost paragraphs — a text box's own are judged alone).
  const shown = once.replace(/<w:p\b[^>]*>((?:(?!<w:p\b)[\s\S])*?)<\/w:p>/g, (p, inner: string) => {
    const pProps = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(inner)?.[1] ?? ''
    const id = styleOf(pProps, 'pStyle')
    return id && hiddenStyles.has(id) ? '' : p
  })
  const body = shown.replace(/<w:r\b[^>]*>((?:(?!<w:r\b)[\s\S])*?)<\/w:r>/g, (run, inner: string) => {
    const props = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(inner)?.[1] ?? ''
    if (invisible(props)) return ''
    const id = styleOf(props, 'rStyle')
    return id && hiddenStyles.has(id) ? '' : run
  })
  let text = ''
  for (const m of body.matchAll(/<w:t(?:\s[^>]*)?(?<!\/)>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g)) {
    if (m[1] !== undefined) text += m[1]
    else text += m[0].startsWith('<w:tab') ? '\t' : '\n'
  }
  // Whole: readDocxText refuses a text past the cap rather than cut it.
  return decodeXml(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Is this a ZIP (a .docx is one)? */
export const looksLikeZip = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

/** A .docx's bytes → its visible text, or why not. Never throws. */
export function readDocxText(bytes: Uint8Array): { text: string } | 'not_docx' | 'too_big' | 'empty' {
  if (!looksLikeZip(bytes)) return 'not_docx'
  let seen = 0
  let bodies = 0
  let styleParts = 0
  let edgeParts = 0
  let sawContentTypes = false
  let tooBig = false
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        seen++
        if (f.name === '[Content_Types].xml') sawContentTypes = true
        // The styles too, bounded like the body: hidden text can be set through a style (hiddenStyleIds).
        if (f.name === 'word/styles.xml' && seen <= DOCX_MAX_ENTRIES) {
          if (++styleParts > 1 || f.originalSize > DOCX_MAX_XML_BYTES) { tooBig = true; return false }
          return true
        }
        // Headers and footers: a CV template often prints the name and the contact block in the header (gate review,
        // 2026-10-16). A few, each small — a document has at most three of each per section.
        if (/^word\/(?:header|footer)\d{0,2}\.xml$/.test(f.name) && seen <= DOCX_MAX_ENTRIES) {
          if (++edgeParts > DOCX_MAX_EDGE_PARTS || f.originalSize > DOCX_MAX_EDGE_BYTES) return false
          return true
        }
        if (f.name !== 'word/document.xml' || seen > DOCX_MAX_ENTRIES) return false
        // One body, at a sane stated size (a second copy of the name is a crafted file, not Word's).
        if (++bodies > 1 || f.originalSize > DOCX_MAX_XML_BYTES) { tooBig = true; return false }
        return true
      },
    })
  } catch {
    return 'not_docx'
  }
  if (tooBig) return 'too_big'
  const xml = entries['word/document.xml']
  if (!sawContentTypes || !xml) return 'not_docx'
  const decode = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(b)
  const styles = entries['word/styles.xml']
  const hidden = styles ? hiddenStyleIds(decode(styles)) : new Set<string>()
  // Headers first (the name and contact sit there), then the body, then the footers — each header/footer text once
  // (a template repeats the same one for the first page and the rest).
  const edge = (kind: 'header' | 'footer') => [...new Set(Object.keys(entries).filter((n) => n.startsWith(`word/${kind}`)).sort()
    .map((n) => docxBodyText(decode(entries[n]), hidden)).filter(Boolean))]
  const text = [...edge('header'), docxBodyText(decode(xml), hidden), ...edge('footer')].filter(Boolean).join('\n\n')
  // ⛔ Never cut silently (gate review, 2026-10-16): a document past the cap is not a CV, and a cut one would import its
  // first part as if it were all of it.
  if (text.length > DOCX_MAX_TEXT_CHARS) return 'too_big'
  return text.replace(/\s+/g, '').length < 40 ? 'empty' : { text }
}
