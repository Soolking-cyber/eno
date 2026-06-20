/** Subtle fade on every route change (App Router re-mounts template on navigation).
 *  CSS-only (tailwindcss-animate) so framer-motion isn't on every navigation's
 *  critical path. No initial opacity:0 hold — content paints immediately. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-in fade-in duration-150">{children}</div>
}
