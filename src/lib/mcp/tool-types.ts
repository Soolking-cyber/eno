import type { z } from 'zod'
import type { ApiAuth } from '@/lib/api/auth'

/**
 * The signed-in MCP server's tool contract, in its own module so tools.ts (the shop tools) and messaging-tools.ts (the
 * chat tools) can both use it without importing each other. tools.ts re-exports both names.
 */
export class ToolError extends Error {
  constructor(public code: string, message: string, public detail?: string) { super(message) }
}

/** MCP tool annotations: hints only — the scopes are what enforce (tools.ts says what each one means here). */
export type ToolAnnotations = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }

export type McpTool = {
  name: string
  /** Short display label (MCP `Tool.title`): Claude's directory requires one on every tool. */
  title: string
  description: string
  scope: 'listings:read' | 'listings:write' | 'analytics:read' | 'media:write' | 'ads:write' | 'messages:read' | 'messages:write'
  annotations: ToolAnnotations
  input: z.ZodType
  /** The result object's shape (see OUTPUT SCHEMAS in tools.ts). */
  output: z.ZodType
  /** `ctx.meta` is the request's `params._meta` (only promote_listing reads it: the x402 payment, src/lib/mcp/ad-tools.ts). */
  handler: (auth: ApiAuth, args: Record<string, unknown>, ctx?: ToolCallContext) => Promise<unknown>
}

export type ToolCallContext = { meta?: Record<string, unknown> }

/**
 * x402 over MCP (specs/transports-v2/mcp.md, owner 2026-11-23): a paid tool that has not been paid answers a tool result
 * with `isError: true` whose `structuredContent` AND `content[0].text` are the PaymentRequired object — thrown as this, so
 * the route builds exactly that shape (never the `{error}` envelope, and never checked against the tool's outputSchema).
 */
export class ToolPaymentRequired extends Error {
  constructor(public paymentRequired: object) { super('payment_required') }
}

/** A tool answer that also carries result `_meta` (the x402 settlement: `_meta["x402/payment-response"]`). */
export class ToolResultWithMeta {
  constructor(public result: unknown, public meta: Record<string, unknown>) {}
}
