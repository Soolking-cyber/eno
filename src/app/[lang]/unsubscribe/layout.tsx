import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'

// Private surface — tokenized email-unsubscribe links must never be indexed.
// Its pages are client components: this layout names them, in the language the HTML is rendered in.
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, { title: `Unsubscribe | ${SITE_NAME}`, robots: { index: false, follow: false } }, { title: `Hủy đăng ký | ${SITE_NAME}` })
}

export default function UnsubscribeLayout({ children }: { children: React.ReactNode }) {
  return children
}
