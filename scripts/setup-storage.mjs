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

// PUBLIC listing-videos bucket — optional ≤60s clips per listing. Larger cap (50MB) than
// photos + a video MIME allowlist. Served via public URL for <video> playback.
if (buckets?.some((b) => b.name === 'listing-videos')) {
  console.log('bucket "listing-videos" already exists')
} else {
  const { error } = await sb.storage.createBucket('listing-videos', {
    public: true,
    fileSizeLimit: '52428800',
    allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  })
  if (error) { console.error('createBucket error:', error.message); process.exit(1) }
  console.log('created public bucket "listing-videos"')
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
