'use client'

import { useEffect } from 'react'

/** Listing-image protection. Mounted once globally. Disables right-click "save"
 *  and drag on protected photos, and flashes a diagonal "eno.vn" watermark over
 *  every protected image (via the CSS `.show-watermark` class on <html>) the
 *  moment someone attempts to save / copy / drag / screenshot — so the watermark
 *  is absent in normal viewing but brands any capture attempt.
 *
 *  Honest scope: this deters casual scraping. OS-level screenshots (macOS ⌘⇧4)
 *  and direct fetches of the image URL can't be intercepted in the browser —
 *  defeating those needs a server-baked watermark, which we can add later. */
export function ImageShield() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const flash = () => {
      document.documentElement.classList.add('show-watermark')
      clearTimeout(timer)
      timer = setTimeout(() => document.documentElement.classList.remove('show-watermark'), 1400)
    }

    const inProtected = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('[data-protected]')

    // Right-click / long-press on a protected photo → block the save menu + flash.
    const onContextMenu = (e: MouseEvent) => {
      if (inProtected(e.target)) { e.preventDefault(); flash() }
    }
    // Dragging a protected <img> out → block (would otherwise drop the raw file).
    const onDragStart = (e: DragEvent) => {
      if (inProtected(e.target)) { e.preventDefault(); flash() }
    }
    // Copy (⌘/Ctrl+C) anywhere → flash (can't tell if a photo is being grabbed).
    const onCopy = () => flash()
    // Screenshot / save shortcuts we can observe: PrintScreen (Win), ⌘/Ctrl+S,
    // and the macOS screenshot combos ⌘⇧3/4/5 (the capture itself isn't blockable,
    // but the watermark is already on screen when the key fires).
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'PrintScreen') return flash()
      if ((e.metaKey || e.ctrlKey) && (k === 's' || k === 'S')) return flash()
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && ['3', '4', '5'].includes(k)) return flash()
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('dragstart', onDragStart)
    document.addEventListener('copy', onCopy)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return null
}
