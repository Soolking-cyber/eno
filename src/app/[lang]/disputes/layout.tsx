import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'

// Private surface — dispute case rooms must never be crawled or indexed.
// Its pages are client components: this layout names them, in the language the HTML is rendered in.
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, { title: `Disputes | ${SITE_NAME}`, robots: { index: false, follow: false } }, { title: `Khiếu nại | ${SITE_NAME}` })
}

export default function DisputesLayout({ children }: { children: React.ReactNode }) {
  return children
}
