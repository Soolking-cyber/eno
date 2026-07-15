const MARKETPLACE_API_URL = (
  process.env.MARKETPLACE_API_URL
  || process.env.NEXT_PUBLIC_MARKETPLACE_URL
  || 'https://eno.vn'
).replace(/\/$/, '')

const ALLOWED_ROOTS = new Set(['forum', 'itineraries'])

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  // API helpers use marketplace-native paths (`/api/forum/...`). Accept that
  // shape as well as the shorter `/forum/...` form without ever widening the
  // proxy beyond the explicit allowlist.
  const targetPath = path[0] === 'api' ? path.slice(1) : path
  if (!targetPath.length || !ALLOWED_ROOTS.has(targetPath[0])) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const incoming = new URL(request.url)
  const target = new URL(`/api/${targetPath.map(encodeURIComponent).join('/')}${incoming.search}`, MARKETPLACE_API_URL)
  const headers = new Headers()
  for (const name of ['accept', 'authorization', 'content-type']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    cache: 'no-store',
    redirect: 'manual',
  })
  const responseHeaders = new Headers()
  const contentType = response.headers.get('content-type')
  if (contentType) responseHeaders.set('Content-Type', contentType)
  responseHeaders.set('Cache-Control', 'no-store')
  return new Response(response.body, { status: response.status, headers: responseHeaders })
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
export const DELETE = proxy
