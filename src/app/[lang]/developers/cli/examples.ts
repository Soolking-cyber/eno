/** The commands the page shows, each with what it does. src/lib/eno-vn-cli.test.ts parses every one. */
export const CLI_EXAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['npx eno-vn status', 'Service status and discovery links. Needs no key.'],
  ['npx eno-vn shop', 'Your storefront profile.'],
  ['npx eno-vn listings --all', 'Every listing, every status, following each page.'],
  ['npx eno-vn create listing.json', 'Create a listing from a JSON file. It prints the Idempotency-Key it sent: if the reply is lost, re-run within 24 hours with --idempotency-key and that key, and it never creates twice.'],
  ['npx eno-vn update LISTING_ID changes.json', 'Edit a listing; only the fields you send change.'],
  ['npx eno-vn set-status LISTING_ID sold', 'active, sold or hidden.'],
  ['npx eno-vn upload photo.jpg', 'Upload a photo; prints the URL to put in images[].'],
  ['npx eno-vn bulk listings.json', 'Create up to 200 listings in one call.'],
  ['npx eno-vn sync catalogue.json --full', 'Upsert your catalogue by your own externalId; --full hides what is missing.'],
  ['npx eno-vn analytics', 'Shop totals: views, leads, listings by status.'],
  ['npx eno-vn webhook-add https://your-app/webhooks/eno', 'Register a webhook for every event; prints its secret once.'],
  ['npx eno-vn token --scope "listings:read"', 'Exchange the key for a one-hour OAuth access token.'],
]
