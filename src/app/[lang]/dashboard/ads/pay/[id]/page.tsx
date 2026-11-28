import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { UcpPayClient } from './pay-client'

const METADATA: Metadata = {
  title: `Pay for an ad | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Thanh toán quảng cáo | ${SITE_NAME}` })
}

/** /dashboard/ads/pay/[id] — a UCP checkout's continue_url (src/lib/ucp/checkout.ts): an AI agent hands the shop here to
 *  pay for an ad on its listing by VietQR bank transfer, signed in. */
export default async function UcpPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <UcpPayClient id={id} />
}
