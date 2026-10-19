// @vitest-environment jsdom
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatRichText } from '@/components/marketplace/rich-text'
import { inlineText, richTextBlocks, richTextGroups } from './rich-text-blocks'

/**
 * ⛔ ONE PARSE, TWO READERS (2026-10-19): the listing page renders a description through formatRichText, and the job-text
 * screen (job-listing.ts jobTextProblem) judges a hiring post in richTextBlocks' blocks — "a hiring post is screened exactly
 * as the reader sees it". formatRichText renders richTextGroups' output, so the two share one parse by construction; this
 * pins the other half — that each block's TEXT is what the reader sees in that rendered element — over a corpus of every
 * shape the renderer knows (hard-wrapped paragraphs, every list marker, headings, fact runs that are and are not tables,
 * blank-line runs, bold) and a seeded fuzz of them.
 */

/** Each rendered block's text, read off the DOM the way a reader reads the page. */
function renderedBlocks(text: string): string[] {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(createElement(Fragment, null, ...formatRichText(text)))
  const out: string[] = []
  for (const el of Array.from(host.children)) {
    if (el.tagName === 'P') out.push(el.textContent ?? '')
    else if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of Array.from(el.children)) {
        // A tick item is [the seller's glyph (aria-hidden — no words), the text]; a disc or number is CSS.
        const spans = li.querySelectorAll(':scope > span')
        out.push(spans.length === 2 ? spans[1].textContent ?? '' : li.textContent ?? '')
      }
    } else if (el.tagName === 'DL') {
      // A table row: the label and the value side by side.
      for (const row of Array.from(el.children)) out.push(`${row.querySelector('dt')?.textContent ?? ''}: ${row.querySelector('dd')?.textContent ?? ''}`)
    } else throw new Error(`an element the block reader does not know: ${el.tagName}`)
  }
  return out
}

const CORPUS: string[] = [
  // A paragraph hard-wrapped mid-sentence (pasted from a PDF), and two paragraphs split by a blank-line run.
  'We support the work permit and temporary residence\ncard for every teacher.',
  'Hỗ trợ làm thẻ tạm\ntrú cho giáo viên.\n\n\n\nLương 25.000.000 đ/tháng.',
  'Line one\r\nline two\r\n\r\nNext paragraph',
  // Every list marker, with paragraphs around them.
  'Duties:\n- Teach adults\n* Plan lessons\n• Mark homework\nAfter the list.',
  '1. First\n2) Second\n123. Third\n1234. Not a number\nTail line',
  '✓ Clear options\n✔Tight tick\n✅ Emoji tick\n☑️ With a selector\n☑ Plain box',
  '- Hỗ trợ tiếp thị\n- Thực hiện các công việc khác theo yêu cầu',
  // Headings, including what is not one.
  '# Visa support\nWe help every teacher.\n### Benefits\n####### seven hashes\n#nospace',
  // Bold edge cases, so inlineText and the renderer's inlineFmt cannot drift apart unseen (review, 2026-10-19).
  'We offer ***visa*** support', 'An unbalanced ** marker and **bold**', '**bold** and **more** in one line', '****', '** spaced **',
  // Fact runs: a table (importer labels), a seller spec sheet (three lines), and runs that are NOT tables — they fold back.
  'Type: Apartment\nArea: 28 m²\nBedrooms: 1\nRent: 6,300,000 ₫/month',
  'Displacement: 125cc\nMax Power: 8.8 kW\nSeat Height: 770 mm',
  'Great bike.\nBrand: Honda\nModel: Wave\nCall me.',
  'Contract: temporary\nResidence hall on campus.',
  'Type: Apartment\nArea: 28 m²\nNote: Call before visiting.\nRent: 6,300,000 ₫/month',
  'Benefits: no training fee\nQuyền lợi: không thu phí',
  'Label:   spaced value\nOther: x\nThird: y',
  // Bold, balanced and not, inside every kind of block.
  'We offer **visa** support and ** stray stars\n- **Bold** item\n# **Bold** heading\nKey: **bold value**\nKey2: v\nKey3: w',
  '**Who can buy:** anyone\n****\n**a** and **b**',
  // Blank-line runs only, and indented markers.
  '\n\n   \n',
  '  - indented bullet\n\t# tab heading\n   1. spaced number',
]

/** A seeded fuzz of every line shape the renderer branches on. */
function fuzz(n: number): string[] {
  const shapes = [
    '', '', '   ', 'Plain sentence here.', 'Another line without a stop', 'Visa **bold** text', '**Who can buy:** anyone', '- bullet',
    '* bullet two', '• bullet three', '-nospace', '1. first', '2) second', '✓ tick', '☑️ selector', '# Heading', '#nospace', 'Type: Apartment',
    'Area: 28 m²', 'Rent: 6,300,000 ₫/month', 'Brand: Honda', 'Model: Wave', 'Note: Call before visiting.', 'Max Power: 8.8 kW',
    'Diện tích: 28 m²', 'Phòng ngủ: 2', 'Quyền lợi: không thu phí', 'Label:   spaced', 'thẻ tạm', 'trú', 'hỗ trợ tiếp thị', 'Thực hiện',
  ]
  let seed = 7
  // Math.imul: a plain multiply passes 2^53 and drops the low bits the mask keeps, so the sequence collapsed (review, 2026-10-19).
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const out: string[] = []
  for (let t = 0; t < n; t++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => shapes[Math.floor(rnd() * shapes.length)])
    out.push(lines.join(rnd() < 0.2 ? '\r\n' : '\n'))
  }
  return out
}

describe('richTextBlocks — each block is the text the page renders for it', () => {
  it.each(CORPUS)('%j', (text) => {
    expect(richTextBlocks(text)).toEqual(renderedBlocks(text))
  })

  // 500 texts (~0.5 s alone): the CORPUS above already holds every shape; the fuzz mixes them. Its own timeout, so the
  // full suite under load (CI's Test step) never fails it on vitest's 5 s default (review, 2026-10-19).
  it('…over a seeded fuzz of every line shape (500 texts)', () => {
    const texts = fuzz(500)
    expect(new Set(texts).size).toBeGreaterThan(450) // the fuzz is real: hundreds of distinct texts, not a short cycle
    for (const text of texts) expect(richTextBlocks(text), JSON.stringify(text)).toEqual(renderedBlocks(text))
  }, 30_000)
})

describe('richTextBlocks — the units the job-text screen judges', () => {
  it('a paragraph is its lines joined with a space; a list item, a heading and a table row are blocks of their own', () => {
    expect(richTextBlocks('Hỗ trợ làm thẻ tạm\ntrú')).toEqual(['Hỗ trợ làm thẻ tạm trú'])
    expect(richTextBlocks('- Hỗ trợ làm thẻ tạm\n- trú')).toEqual(['Hỗ trợ làm thẻ tạm', 'trú'])
    expect(richTextBlocks('# Benefits\n✓ Housing\n1. Visa support')).toEqual(['Benefits', 'Housing', 'Visa support'])
    expect(richTextBlocks('Type: Apartment\nArea: 28 m²')).toEqual(['Type: Apartment', 'Area: 28 m²'])
    // One fact line is prose: folded back into the paragraph it sits in.
    expect(richTextBlocks('Contract: temporary\nResidence hall on campus.')).toEqual(['Contract: temporary Residence hall on campus.'])
    expect(richTextBlocks('First paragraph.\n\nSecond paragraph.')).toEqual(['First paragraph.', 'Second paragraph.'])
  })

  it('"**bold**" reads without its asterisks; the groups keep the markdown the renderer formats', () => {
    expect(inlineText('We offer **visa** support')).toBe('We offer visa support')
    expect(richTextBlocks('We offer **visa** support')).toEqual(['We offer visa support'])
    expect(richTextGroups('We offer **visa** support')).toEqual([{ kind: 'p', text: 'We offer **visa** support' }])
    expect(richTextGroups('Type: Apartment\nArea: 28 m²')).toEqual([{ kind: 'dl', rows: [['Type', 'Apartment', null], ['Area', '28 m²', 'area']] }])
  })
})
