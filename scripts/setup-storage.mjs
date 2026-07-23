import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})

const { data: buckets, error: listErr } = await sb.storage.listBuckets()
if (listErr) { console.error('listBuckets error:', listErr.message); process.exit(1) }

if (buckets?.some((b) => b.name === 'listings')) {
  console.log('bucket "listings" already exists')
} else {
  const { error } = await sb.storage.createBucket('listings', { public: true, fileSizeLimit: '10485760' })
  if (error) { console.error('createBucket error:', error.message); process.exit(1) }
  console.log('created public bucket "listings"')
}

// PUBLIC listing-videos bucket — optional ≤60s clips per listing. 50MB cap: this is the
// Supabase PROJECT-WIDE upload ceiling (probed 2026-07-18 — anything higher is rejected
// until the owner raises Project Settings → Storage → upload limit, then this value,
// VIDEO_MAX_BYTES, and the wizard's compression target can grow together). Oversized
// phone clips are compressed client-side to fit (src/lib/video-compress.ts). Existing
// buckets are RECONCILED to this config (idempotent).
{
  const videoConfig = {
    public: true,
    fileSizeLimit: '52428800',
    allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  }
  if (buckets?.some((b) => b.name === 'listing-videos')) {
    const { error } = await sb.storage.updateBucket('listing-videos', videoConfig)
    if (error) { console.error('updateBucket error:', error.message); process.exit(1) }
    console.log('bucket "listing-videos" reconciled (50MB cap)')
  } else {
    const { error } = await sb.storage.createBucket('listing-videos', videoConfig)
    if (error) { console.error('createBucket error:', error.message); process.exit(1) }
    console.log('created public bucket "listing-videos"')
  }
}

// PRIVATE dispute-evidence bucket — receipts/screenshots carry PII; served only via
// short-lived signed URLs minted in party/admin-gated routes (src/lib/dispute.ts).
if (buckets?.some((b) => b.name === 'evidence')) {
  console.log('bucket "evidence" already exists')
} else {
  const { error } = await sb.storage.createBucket('evidence', { public: false, fileSizeLimit: '10485760' })
  if (error) { console.error('createBucket error:', error.message); process.exit(1) }
  console.log('created PRIVATE bucket "evidence"')
}

// PRIVATE business-verification bucket — business licence / passport / bank statement,
// sensitive PII (PDPL Decree 13/2023). Accepts images AND PDF (a licence is often a PDF),
// so unlike the image-only buckets it allows application/pdf. Served only via short-lived
// signed URLs minted in admin-gated review routes; objects deleted after the review
// decision + a dispute window (retention job). 15 MB cap matches the upload route.
if (buckets?.some((b) => b.name === 'business-verification')) {
  console.log('bucket "business-verification" already exists')
} else {
  const { error } = await sb.storage.createBucket('business-verification', {
    public: false,
    fileSizeLimit: '15728640',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  })
  if (error) { console.error('createBucket error:', error.message); process.exit(1) }
  console.log('created PRIVATE bucket "business-verification"')
}
