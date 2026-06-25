import { useEffect, useState } from 'react'

// The map view (listings explorer) is a focused mode: while it's open the top
// header + bottom nav stay PINNED instead of hiding on scroll, so they don't drift
// when the map is panned or when locate scrolls the map into view. The explorer
// broadcasts `eno:mapview` { active } on every viewMode change (and false on unmount).
export function useMapViewPinned(): boolean {
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    const on = (e: Event) => setPinned(!!(e as CustomEvent<{ active?: boolean }>).detail?.active)
    window.addEventListener('eno:mapview', on)
    return () => window.removeEventListener('eno:mapview', on)
  }, [])
  return pinned
}
