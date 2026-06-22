import { Header } from '@/components/marketplace/header'

export default function MessagesLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-3 py-4 sm:px-6">
        <div className="h-7 w-32 rounded shimmer" />
        <div className="mt-4 divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <div className="h-11 w-11 shrink-0 rounded-full shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-1/3 rounded shimmer" />
                <div className="h-3 w-2/3 rounded shimmer" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
