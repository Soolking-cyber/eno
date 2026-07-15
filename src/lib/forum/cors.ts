import 'server-only'
import { NextResponse } from 'next/server'

const productionForumOrigin = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'

function allowedOrigins(): Set<string> {
  const origins = new Set([productionForumOrigin])
  for (const origin of (process.env.FORUM_DEV_ORIGINS || '').split(',')) {
    if (origin.trim()) origins.add(origin.trim())
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3101')
    origins.add('http://127.0.0.1:3101')
  }
  return origins
}

export function isAllowedForumOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  // Server-to-server and same-origin requests commonly omit Origin. Authentication
  // and authorization still apply; CORS only gates browser cross-origin access.
  return !origin || allowedOrigins().has(origin)
}

export function withForumCors(request: Request, response: NextResponse, methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  const origin = request.headers.get('origin')
  if (origin && allowedOrigins().has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.append('Vary', 'Origin')
  }
  response.headers.set('Access-Control-Allow-Methods', methods)
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.headers.set('Access-Control-Max-Age', '86400')
  return response
}

export function forumJson(
  request: Request,
  body: unknown,
  init?: ResponseInit,
  methods?: string,
) {
  return withForumCors(request, NextResponse.json(body, init), methods)
}

export function forumPreflight(request: Request, methods?: string) {
  if (!isAllowedForumOrigin(request)) return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 })
  return withForumCors(request, new NextResponse(null, { status: 204 }), methods)
}
