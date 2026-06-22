import { Header } from '@/components/marketplace/header'

export default function ThreadLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-0 sm:px-6">
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
          <div className="h-9 w-9 shrink-0 rounded-full shimmer" />
          <div className="h-4 w-32 rounded shimmer" />
        </div>
        <div className="flex-1 space-y-2 px-4 py-4">
          {[['start', 'w-40'], ['end', 'w-28'], ['start', 'w-52'], ['end', 'w-36']].map(([side, w], i) => (
            <div key={i} className={`flex ${side === 'end' ? 'justify-end' : 'justify-start'}`}>
              <div className={`h-9 ${w} rounded-2xl shimmer`} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
