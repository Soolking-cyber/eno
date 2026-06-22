// Single source of truth for "is this a valid first-party listing image URL".
// Pinned to OUR Supabase project's public `listings` bucket — NOT any
// *.supabase.co project — so a stored avatar/listing image can't point at an
// attacker-controlled bucket (content that bypassed our raster-only upload).
const HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const PREFIX = HOST ? `${HOST}/storage/v1/object/public/listings/` : null

export function isListingImageUrl(url: unknown): url is string {
  return typeof url === 'string' && PREFIX !== null && url.startsWith(PREFIX)
}
