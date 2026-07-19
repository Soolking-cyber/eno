import type { Metadata } from 'next'
import Link from 'next/link'
import { FileCheck2 } from 'lucide-react'
import { getVisaAdmin } from '@/lib/visa/auth'
import { getVisaDb } from '@/lib/visa/db'
import type { VisaApplicationRow, VisaDocumentRow } from '@/lib/visa/records'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Visa cases — eno.forum admin', robots: { index: false, follow: false } }

export default async function VisaAdminPage() {
  const admin = await getVisaAdmin()
  if (!admin) return <AdminDenied />
  const db = getVisaDb()
  const [{ data: applications }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('*').order('updated_at', { ascending: false }).limit(200),
    db.from('visa_documents').select('*').order('created_at'),
  ])
  const rows = (applications || []) as VisaApplicationRow[]
  const docs = (documents || []) as VisaDocumentRow[]
  const active = rows.filter((item) => !['draft', 'needs_changes', 'approved', 'rejected', 'cancelled'].includes(item.status))
  const drafts = rows.filter((item) => ['draft', 'needs_changes'].includes(item.status))
  const closed = rows.filter((item) => ['approved', 'rejected', 'cancelled'].includes(item.status))
  const render = (items: VisaApplicationRow[]) => items.length ? <Card className="divide-y divide-border py-0">{items.map((item) => {
    const kinds = docs.filter((document) => document.application_id === item.id).map((document) => document.kind)
    return <Link key={item.id} href={`/admin/visas/${item.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-tint"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><FileCheck2 className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-bold text-foreground">{item.id.slice(0, 8)}</span><Badge variant={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'destructive' : item.status === 'needs_changes' ? 'warning' : 'neutral'} className="capitalize">{item.status.replaceAll('_', ' ')}</Badge></span><span className="mt-1 block text-xs text-body">{kinds.join(', ') || 'No documents'} · user {item.user_id.slice(0, 8)}</span></span><time className="text-xs text-ink-4">{new Date(item.updated_at).toLocaleDateString('en-GB')}</time></Link>
  })}</Card> : <p className="px-2 py-5 text-sm text-body">No cases here.</p>
  return <div className="min-h-screen bg-background"><AdminBar admin={admin} /><main className="mx-auto w-full max-w-6xl px-3 py-8 sm:px-6 lg:px-8"><h1 className="text-3xl font-bold tracking-tight">Visa assistance</h1><p className="mt-2 max-w-3xl text-sm text-body">Private review queue. Never invent an answer, accept a declaration, solve a challenge, pay, or submit without the applicant&apos;s recorded approval and a human review of the live official form.</p><h2 className="mt-8 text-xs font-bold uppercase tracking-wider text-ink-4">Active · {active.length}</h2><div className="mt-2">{render(active)}</div><h2 className="mt-8 text-xs font-bold uppercase tracking-wider text-ink-4">Drafts and changes · {drafts.length}</h2><div className="mt-2">{render(drafts)}</div><h2 className="mt-8 text-xs font-bold uppercase tracking-wider text-ink-4">Closed · {closed.length}</h2><div className="mt-2">{render(closed)}</div></main></div>
}

function AdminBar({ admin }: { admin: string }) { return <header className="border-b border-border bg-card"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-3 sm:px-6 lg:px-8"><Link href="/"><img src="/logo.svg" alt="eno" width={1200} height={300} className="h-7 w-auto" /></Link><span className="text-xs font-semibold text-body">Visa admin · {admin}</span></div></header> }
function AdminDenied() { return <main className="mx-auto max-w-lg px-6 py-24 text-center"><LockIcon /><h1 className="mt-4 text-2xl font-bold">Admin access required</h1><p className="mt-2 text-sm text-body">Sign in as support@eno.vn or another trained operator on the server allowlist.</p><Link href="/" className="mt-5 inline-flex h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-bold">Back to forum</Link></main> }
function LockIcon() { return <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-xl">🔒</span> }
