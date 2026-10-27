import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { MessagesShell } from './messages-shell'

// /messages had no title of its own — its layout and page are client components — so the tab read the site-wide home
// title in both languages (sweep 2026-10-22; /saved had the same, E-TITLE). This server layout names it, in the language
// the HTML is rendered in, and renders the client shell (messages-shell.tsx) exactly as the layout did.
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, { title: `Messages | ${SITE_NAME}` }, { title: `Tin nhắn | ${SITE_NAME}` })
}

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return <MessagesShell>{children}</MessagesShell>
}
