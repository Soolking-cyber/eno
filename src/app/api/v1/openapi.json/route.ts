import { NextResponse } from 'next/server'
import { SITE_NAME } from '@/lib/edition'

// ⚠️ SAME DERIVATION AS layout.tsx AND THE llms.txt ROUTE. next.config.ts asserts
// NEXT_PUBLIC_APP_URL matches the edition, so this is the one value guaranteed to describe
// THIS deployment.
const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Machine-readable OpenAPI 3.1 description of the partner API, for client codegen + tooling.
// Hand-maintained alongside the routes (kept intentionally compact; the human guide lives
// at /developers). Served at GET /api/v1/openapi.json AND at the conventional /openapi.json.
//
// ⛔ EVERY OPERATION CARRIES A UNIQUE operationId, AND THEY MUST STAY STABLE. This is the
// name an LLM tool-caller and every codegen client derives its function from, so renaming
// one is a breaking change to code we do not control — treat them like a public API symbol,
// not like a label. An agent audit on 2026-08-23 found 18 of 18 operations missing them,
// which is why the spec scored as unusable for function calling despite being complete in
// every other respect: descriptions, responses and securitySchemes were all already there.
export const SPEC = {
  openapi: '3.1.0',
  info: {
    title: `${SITE_NAME} Partner API`,
    version: '1.0.0',
    description: 'Manage your eno.vn storefront programmatically. API-key auth; one key acts for one shop and only ever sees that shop\'s data.',
  },
  // ⛔ DERIVED, NOT HARDCODED — THIS FILE IS SHARED BY BOTH DEPLOYMENTS. It read
  // 'https://eno.vn/api/v1' as a literal, and /api/v1 compiles into both editions, so
  // eno.forum served a spec titled "eno.vn Partner API" pointing every generated client
  // at the other domain. Found 2026-08-23, the same shape as the static llms.txt that
  // introduced eno.forum as eno.vn — and worse here, because a spec is consumed by
  // codegen and tool-callers that will not notice the name is wrong.
  servers: [{ url: `${SITE_ORIGIN}/api/v1` }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'An `eno_live_…` key from your dashboard → Developers. Scopes: listings:read, analytics:read, listings:write, media:write.' },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
      Listing: { type: 'object', description: 'A serialized listing (id, title, price, status, verified, images, category, …).' },
      ListingInput: {
        type: 'object',
        required: ['categorySlug', 'title', 'price'],
        properties: {
          categorySlug: { type: 'string' }, title: { type: 'string', minLength: 3 }, price: { type: 'number', minimum: 0 },
          description: { type: 'string' }, district: { type: 'string' }, condition: { type: 'string' },
          images: { type: 'array', items: { type: 'string' }, description: 'Public URLs — re-hosted to first-party storage' },
          externalId: { type: 'string', description: 'Your own id (for sync/upsert)' },
        },
      },
    },
  },
  paths: {
    '/oauth/token': {
      post: { operationId: 'createAccessToken',
        summary: 'Exchange an API key for a short-lived bearer token (client-credentials)',
        security: [],
        requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', required: ['grant_type', 'client_secret'], properties: { grant_type: { type: 'string', enum: ['client_credentials'] }, client_id: { type: 'string', description: 'The key prefix (optional; verified if sent)' }, client_secret: { type: 'string', description: 'The full eno_live_… key' }, scope: { type: 'string', description: 'Space-separated subset of the key scopes (optional)' } } } } } },
        responses: { '200': { description: 'access_token (JWT, expires_in 3600), token_type, scope' }, '400': { description: 'unsupported_grant_type / invalid_scope' }, '401': { description: 'invalid_client' } },
      },
    },
    '/shop': {
      get: { operationId: 'getShop', summary: 'Get your storefront profile + trust + live listing count', security: [{ bearerAuth: [] }], responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } } },
      patch: { operationId: 'updateShop', summary: 'Edit your storefront profile (sparse)', responses: { '200': { description: 'OK' } } },
    },
    '/listings': {
      get: { operationId: 'listListings', summary: 'List your listings (all statuses), keyset-paginated', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }, { name: 'cursor', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      post: { operationId: 'createListing', summary: 'Create a listing', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ListingInput' } } } }, responses: { '201': { description: 'Created' }, '422': { description: 'Invalid input' } } },
    },
    '/listings/{id}': {
      get: { operationId: 'getListing', summary: 'Get one of your listings', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } } },
      patch: { operationId: 'updateListing', summary: 'Edit a listing (sparse)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      delete: { operationId: 'deleteListing', summary: 'Delete a listing', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/listings/{id}/status': {
      post: { operationId: 'setListingStatus', summary: 'Set availability: active | sold | hidden', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'sold', 'hidden'] } } } } } }, responses: { '200': { description: 'OK' } } },
    },
    '/listings/{id}/confirm': {
      post: { operationId: 'confirmListing', summary: 'Confirm still available (bumps feed recency)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/listings/bulk': {
      post: { operationId: 'bulkCreateListings', summary: 'Create up to 200 listings (send Idempotency-Key)', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { listings: { type: 'array', items: { $ref: '#/components/schemas/ListingInput' } } } } } } }, responses: { '200': { description: 'Per-row results' } } },
    },
    '/listings/sync': {
      post: { operationId: 'syncListings', summary: 'Upsert your catalogue by externalId; mode full retires absent listings', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { mode: { type: 'string', enum: ['partial', 'full'] }, listings: { type: 'array', items: { $ref: '#/components/schemas/ListingInput' } } } } } } }, responses: { '200': { description: 'created/updated/retired counts + per-row results' } } },
    },
    '/media': {
      post: { operationId: 'uploadMedia', summary: 'Upload an image (multipart file or raw body); returns a first-party URL', responses: { '200': { description: 'OK' } } },
    },
    '/analytics/summary': {
      get: { operationId: 'getAnalyticsSummary', summary: 'Shop rollup: total views/leads + counts by status', responses: { '200': { description: 'OK' } } },
    },
    '/analytics/listings': {
      get: { operationId: 'listListingAnalytics', summary: 'Per-listing daily views/leads (deltas), keyset-paginated', parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }, { name: 'cursor', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/webhooks': {
      get: { operationId: 'listWebhooks', summary: 'List your webhook endpoints (+ delivery health)', responses: { '200': { description: 'OK' } } },
      post: { operationId: 'createWebhook', summary: 'Register a signed-event endpoint (secret returned once)', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string' } } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/webhooks/{id}': {
      delete: { operationId: 'deleteWebhook', summary: 'Unregister a webhook', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
  },
} as const

export function GET() {
  return NextResponse.json(SPEC, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
