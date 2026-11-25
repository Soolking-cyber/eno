/**
 * Spread on the element that holds one group of ui/disclosure rows: ↑ / ↓ / Home / End move only between the rows inside it.
 * ⛔ A MODULE OF ITS OWN, WITHOUT 'use client', ON PURPOSE (commit gate, 2026-11-25). The home FAQ is a Server Component, and a
 * plain object exported from a 'use client' module reaches it as a client-reference proxy, not the object: the spread wrote
 * nothing, so the built HTML had no group and the FAQ's arrow keys did nothing in production, while jsdom (no RSC boundary)
 * passed. Both sides import it from here.
 */
export const DISCLOSURE_GROUP = { 'data-disclosure-group': '' } as const
