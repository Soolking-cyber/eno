/**
 * ── AN AI AGENT ACTING FOR A PERSON (2026-11-17, agent messaging) ──────────────────────────────────────────────────────
 *
 * The MCP server (src/lib/mcp/messaging-tools.ts) authenticates the person's sign-in token and checks the tool's scope,
 * then calls a chat route's handler IN PROCESS with a Request it built and marked with `asAgent()`. A route that opted in
 * (`route({ agent: true })`, src/lib/api/handler.ts) takes the caller from that mark instead of the session, so every
 * rule the route holds for a person — blocks, enforcement gates, offer guards, notifications — holds for the agent, and
 * a rule added to the route later holds for it too.
 *
 * ⛔ IN PROCESS ONLY. The mark is a module-private WeakMap keyed by the Request OBJECT: no header, cookie or body can set
 * it, so a request from the network can never claim to be an agent, and a route that did not opt in ignores the mark
 * (and, with no session, answers 401).
 */
export type AgentActor = { profileId: string; keyId: string }

const DELEGATED = new WeakMap<Request, AgentActor>()

/** Marks `req` as sent by an agent for `actor.profileId`. Only for a Request built in this process, never one received. */
export function asAgent(req: Request, actor: AgentActor): Request {
  DELEGATED.set(req, actor)
  return req
}

/** The agent `req` was marked for, or null (every request that came from the network). */
export function agentOf(req: Request): AgentActor | null {
  return DELEGATED.get(req) ?? null
}
