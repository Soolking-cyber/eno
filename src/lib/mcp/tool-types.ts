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
  scope: 'listings:read' | 'listings:write' | 'analytics:read' | 'media:write' | 'messages:read' | 'messages:write'
  annotations: ToolAnnotations
  input: z.ZodType
  /** The result object's shape (see OUTPUT SCHEMAS in tools.ts). */
  output: z.ZodType
  handler: (auth: ApiAuth, args: Record<string, unknown>) => Promise<unknown>
}
