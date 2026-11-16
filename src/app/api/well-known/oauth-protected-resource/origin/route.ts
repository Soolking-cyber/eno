import { protectedResourceResponse } from '@/lib/api/protected-resource'

// The ORIGIN's RFC 9728 document (resource = https://eno.vn), served at the BARE /.well-known/oauth-protected-resource by
// a next.config rewrite to THIS PATH, above the `:path*` catch-all. Why the bare path names the origin and not /api/v1:
// src/lib/api/protected-resource.ts.
export const runtime = 'nodejs'

export async function GET() {
  return protectedResourceResponse('origin')
}
