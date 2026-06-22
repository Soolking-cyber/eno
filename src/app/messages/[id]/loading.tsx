// Thread right-pane skeleton (the layout already provides Header + the list).
export default function ThreadLoading() {
  return (
    <div className="flex h-full w-full flex-col">
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
    </div>
  )
}
