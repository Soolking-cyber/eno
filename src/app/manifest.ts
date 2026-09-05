import type { MetadataRoute } from 'next'
import { SITE_NAME } from '@/lib/edition'

/**
 * PWA manifest — served at /manifest.webmanifest and auto-linked in <head> by Next.
 * Required for "Add to Home Screen", which is the ONLY way iOS Safari allows web
 * push (the daily availability reminders). Android/desktop also use it for install.
 *
 * ⚠️ THE NAME IS PER-EDITION. Both fields were hardcoded "eno.vn", and this file renders on BOTH
 * deployments — so installing eno.forum to a home screen put the LICENSED marketplace's name on
 * the icon, and the OS install prompt offered "eno.vn" to someone who was on eno.forum. That is a
 * more durable leak than any on-page one: it survives on the device after the tab is closed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // `name` deliberately leads with the bare site name and no em-dash suffix, so the manifest
    // agrees CHARACTER FOR CHARACTER with short_name, the <title> prefix, og:site_name and the
    // Google OAuth consent screen's "App name" field. It previously read
    // "eno.vn — Expat Marketplace in Vietnam", which is a THIRD spelling of the app's name on a
    // page whose whole problem is Google reporting that the configured name "does not match the
    // app name on your home page" — the descriptive half belongs in `description`, which already
    // carries it.
    name: SITE_NAME,
    short_name: SITE_NAME,
    description:
      'Marketplace for expats and internationals in Vietnam — housing, jobs, motorbikes, services and moving sales.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    // Match the rendered light-mode chrome (<meta theme-color> is #ffffff). A manifest
    // theme_color can't media-match, so the blue value made the install splash/toolbar
    // jump to a white shell — pick the light value.
    theme_color: '#ffffff',
    lang: 'en',
    categories: ['shopping', 'business', 'lifestyle'],
    // ⚠️ THE STAMP FOLLOWS THE MARK. Raster icons have no content hash of their own, so a redrawn
    // mark would sit behind Cloudflare, browser and installed-PWA caches until expiry. Same value as
    // the /logo-mark.svg call sites — bump them together (scripts/brand-icons.sh says how).
    icons: [
      { src: '/icon-192.png?v=c781b0dc', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png?v=c781b0dc', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png?v=c781b0dc', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press quick actions on the installed icon (Android/desktop).
    shortcuts: [
      { name: 'Post a listing', short_name: 'Post', url: '/post', icons: [{ src: '/icon-192.png?v=c781b0dc', sizes: '192x192', type: 'image/png' }] },
      { name: 'Saved', short_name: 'Saved', url: '/saved', icons: [{ src: '/icon-192.png?v=c781b0dc', sizes: '192x192', type: 'image/png' }] },
      { name: 'Messages', short_name: 'Messages', url: '/messages', icons: [{ src: '/icon-192.png?v=c781b0dc', sizes: '192x192', type: 'image/png' }] },
    ],
  }
}
