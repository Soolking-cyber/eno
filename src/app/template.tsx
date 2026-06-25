/** Per-navigation wrapper (App Router re-mounts template on route change). Kept as a
 *  plain passthrough: the bottom-nav uses the View Transitions API for a directional
 *  slide, and an opacity fade here would taint the transition's snapshot of the
 *  incoming page (captured mid-fade). Other navigations are instant. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}
