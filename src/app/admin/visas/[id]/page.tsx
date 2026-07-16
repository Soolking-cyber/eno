import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getVisaAdmin } from '@/lib/visa/auth'
import { getVisaDb } from '@/lib/visa/db'
import { serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { VisaAdminCase } from '@/components/visa/visa-admin-case'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Visa case — eno.forum admin', robots: { index: false, follow: false } }

export default async function VisaAdminCasePage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return <main className="mx-auto max-w-lg px-6 py-24 text-center"><h1 className="text-2xl font-bold">Admin access required</h1><Link href="/" className="mt-5 inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-bold">Back to forum</Link></main>
  const { id } = await params
  const db = getVisaDb()
  const [app, docs, events] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id).order('created_at'),
    db.from('visa_events').select('*').eq('application_id', id).order('created_at'),
  ])
  if (!app.data) notFound()
  return <div className="min-h-screen bg-background"><header className="border-b border-border bg-card"><div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-3 sm:px-6 lg:px-8"><Link href="/admin/visas" className="text-sm font-bold text-accent-foreground">← Visa queue</Link><span className="text-xs text-body">{admin}</span></div></header><main className="mx-auto w-full max-w-5xl px-3 py-8 sm:px-6 lg:px-8"><VisaAdminCase initialApplication={serializeVisa(app.data as VisaApplicationRow, (docs.data || []) as VisaDocumentRow[], (events.data || []) as VisaEventRow[])} /></main></div>
}
