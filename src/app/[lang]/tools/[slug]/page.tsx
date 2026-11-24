import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_SERVICES } from '@/lib/edition'
import { localizedHref } from '@/lib/lang-pinned'
import { RENT_TOOLS, RENT_TOOL_SLUGS, rentToolPath } from '@/lib/rent-tools/registry'
import { liveTool } from '@/lib/tools/content'
import { formatInputValue } from '@/lib/tools/input-format'
import { formatOutput, runTool } from '@/lib/tools/run'
import { TOOL_LINKS, type Copy } from '@/lib/tools/spec'
import { moneyLocale } from '@/lib/vnd'
import { ExampleRows, Inputs, Limits, P, ToolPageShell, toolPageMetadata, type MoreLink } from '@/components/marketplace/rent-tool-page'
import { GeneratedToolCalculator } from './calculator'

/**
 * /tools/<slug> (and /vi/tools/<slug>): a tool eno Reach wrote and a person approved (src/lib/tools/registry.ts), rendered from
 * its spec by the same page as the four rent tools: the answer, the calculator, how it works, a worked example the SERVER
 * computes (so the page answers without JavaScript), the FAQ with its FAQPage node, and links on. Every word is the spec's, as
 * text. An unregistered or unreviewed slug is a 404, and so is every tool on the services build (marketplace only, like the rent tools).
 */
export const revalidate = 3600

type Params = { params: Promise<{ lang: string; slug: string }> }

const TEXT = {
  example: { en: 'With these figures:', vi: 'Với các số sau:' },
  cannot: { en: 'Cannot compute with these figures', vi: 'Không tính được với các số này' },
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { lang, slug } = await params
  const spec = IS_SERVICES ? null : liveTool(slug)
  if (!spec) return {}
  return toolPageMetadata(`/tools/${slug}`, lang, { title: spec.title, description: spec.description })
}

export default async function Page({ params }: Params) {
  if (IS_SERVICES) notFound()
  const { lang, slug } = await params
  const spec = liveTool(slug)
  if (!spec) notFound()
  const locale = moneyLocale(lang)
  const ex = runTool(spec, spec.example.inputs)
  const paragraphs = (c: Copy) => {
    const en = c.en.split(/\n\s*\n/)
    const vi = c.vi.split(/\n\s*\n/)
    // Paired by position; a language with fewer paragraphs keeps its text whole rather than pair the wrong ones.
    return en.length === vi.length ? en.map((p, i) => ({ en: p.trim(), vi: vi[i].trim() })) : [{ en: c.en, vi: c.vi }]
  }
  const lines = (c: Copy) => {
    const en = c.en.split('\n')
    const vi = c.vi.split('\n')
    return en.length === vi.length ? en.map((l, i) => ({ en: l.trim(), vi: vi[i].trim() })) : [{ en: c.en.replace(/\n/g, ' '), vi: c.vi.replace(/\n/g, ' ') }]
  }
  const more: MoreLink[] = [
    ...spec.related.map((href) => ({ href: localizedHref(href, lang), label: TOOL_LINKS[href] })),
    ...RENT_TOOL_SLUGS.filter((s) => !spec.related.includes(`/${s}`)).map((s) => ({ href: rentToolPath(s, lang), label: RENT_TOOLS[s].label, blurb: RENT_TOOLS[s].blurb })),
  ]
  if (!spec.related.includes('/tools')) more.push({ href: localizedHref('/tools', lang), label: TOOL_LINKS['/tools'] })

  return (
    <ToolPageShell
      lang={lang}
      path={`/tools/${slug}`}
      h1={spec.title}
      intro={spec.intro}
      calculator={<GeneratedToolCalculator spec={spec} />}
      how={
        <>
          {paragraphs(spec.howItWorks).map((c, i) => <P key={i} c={c} />)}
          <Inputs items={spec.inputs.map((i) => ({ term: i.label, def: i.help }))} />
          <Limits items={lines(spec.limitations)} />
        </>
      }
      example={
        <>
          <P c={TEXT.example} />
          <ExampleRows
            rows={[
              ...spec.inputs.map((i) => {
                const v = formatInputValue(i, spec.example.inputs[i.id], locale) // at the input's precision, not an output's
                // A choice prints its own words in each language; any other value is a figure in this page's grouping.
                return typeof v === 'string' ? { label: i.label, value: v } : { label: i.label, value: v[locale] }
              }),
              ...spec.outputs.map((o) => {
                const v = ex.outputs[o.id]
                return { label: o.label, value: v === null ? TEXT.cannot[locale] : formatOutput(v, o.format, locale), strong: true }
              }),
            ]}
          />
          {ex.notes.map((i) => <P key={`n${i}`} c={spec.notes[i].text} />)}
        </>
      }
      faqs={spec.faqs}
      more={more}
    />
  )
}
