import { RouteFade } from './route-fade'

/** Subtle fade on every route change (App Router re-mounts template on navigation).
 *  CSS-only so framer-motion isn't on every navigation's critical path. No initial
 *  opacity:0 hold — content paints immediately.
 *  ⚠️ The fade is SUPPRESSED on BACK/FORWARD (popstate). The wrapper is a client
 *  component purely for that; the page tree below it stays server-rendered. See
 *  route-fade.tsx for why the flag lives on <html> and not in React state. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <RouteFade>{children}</RouteFade>
}
