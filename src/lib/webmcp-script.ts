/**
 * /webmcp.js — WebMCP: the public search MCP server's read-only tools, offered to a BROWSER AGENT on the page itself
 * (`document.modelContext.registerTool()`, `navigator.modelContext` as the fallback). Served by src/app/webmcp.js/route.ts,
 * loaded by a plain `<script src="/webmcp.js" async>` in src/app/[lang]/layout.tsx.
 *
 * ⛔ WHY IT IS WRITTEN OUT LIKE THIS (ora.ai, 2026-11-16). Two shapes were live and scored nothing:
 *   1. a React client component — in a chunk only the RSC payload loads; ora reads only the scripts the HTML names;
 *   2. a static public/webmcp.js that fetched tools/list and registered what came back — ora's reader "found no
 *      registerTool() call that runs on a modelContext read from document or navigator" (a parameter, inside a promise).
 * So this is the shape ora's own pages use: ONE function reads `document.modelContext || navigator.modelContext` into a
 * local and calls `mc.registerTool({...})` with LITERAL tool objects. The literals are generated here from
 * `searchToolDescriptors()` — the same list /api/mcp/search answers tools/list with — so they can never drift from the
 * server, and nothing is fetched before registering.
 * ⛔ THE SAME TOOLS, NOT NEW ONES: only those the server marks `readOnlyHint: true`; every call is a cookie-less
 * (`credentials: 'omit'`) `tools/call` on /api/mcp/search — that endpoint's licensing filter, rate limit and input bounds.
 * ⚠️ NOTHING HAPPENS IN A NORMAL BROWSER: without `modelContext` (at load or the late checks) not one request is made.
 * ⛔ NEVER IN A FRAME: the concierge's window and the app's sheet are pages of this site in a frame, and a <script> runs
 * before React could leave it out — the page around the frame already offers the tools.
 * Listing text is written by users: an agent reading it is reading untrusted text, as on the page itself.
 * Tests: src/lib/webmcp-script.test.ts (runs the generated script).
 */

export type WebMcpDescriptor = {
  name: string
  description: string
  inputSchema: unknown
  annotations?: Record<string, unknown>
}

/**
 * WebMCP's `untrustedContentHint: true` (owner 2026-11-16 "do small fixes"; ora.ai's WebMCP trust rows; the annotation
 * name the ax auditor reads): the tool's answer carries text this site did not write — listing titles and descriptions,
 * by their sellers — so a browser agent reads it as data, never as instructions.
 * ⛔ EVERY TOOL GETS IT BUT THESE (commit gate, opus: an allowlist fails open — a new tool returning reviews or a seller's
 * bio would have been marked trusted): only a tool that answers with nothing but the site's own text is exempt.
 */
export const SITE_TEXT_ONLY_TOOLS: ReadonlySet<string> = new Set(['list_categories'])

/** One `register({...})` call: a JSON object literal (valid JS) plus the `execute` that sends it to the server. */
function registration(t: WebMcpDescriptor): string {
  const annotations = SITE_TEXT_ONLY_TOOLS.has(t.name) ? t.annotations : { ...t.annotations, untrustedContentHint: true }
  const json = JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations })
  return `    register(${json.slice(0, -1)},"execute":function (input, opts) { return call(${JSON.stringify(t.name)}, input, opts); }});`
}

export function buildWebmcpScript(tools: WebMcpDescriptor[]): string {
  const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true)
  return `/* WebMCP: this site's public search tools (read-only), for a browser agent. Source: src/lib/webmcp-script.ts */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.__enoWebMcp) return;
  if (window.top !== window.self) return;
  window.__enoWebMcp = true;

  var ENDPOINT = "/api/mcp/search";

  /* The JSON-RPC reply to request id 1, from a JSON body or from Server-Sent Events read as they arrive. */
  async function message(res) {
    if ((res.headers.get("content-type") || "").indexOf("text/event-stream") === -1) return JSON.parse(await res.text());
    var reader = res.body && res.body.getReader();
    if (!reader) throw new Error("empty event stream");
    var decoder = new TextDecoder();
    var buffer = "";
    try {
      for (;;) {
        var chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        var events = buffer.split(/\\r?\\n\\r?\\n/);
        buffer = chunk.done ? "" : events.pop() || "";
        for (var i = 0; i < events.length; i++) {
          var data = events[i].split(/\\r?\\n/)
            .filter(function (l) { return l.indexOf("data:") === 0; })
            .map(function (l) { return l.slice(5).replace(/^ /, ""); })
            .join("\\n");
          if (!data) continue;
          var msg = JSON.parse(data);
          if (msg.id === 1) return msg;
        }
        if (chunk.done) throw new Error("no reply in the event stream");
      }
    } finally {
      reader.cancel().catch(function () {});
    }
  }

  /* Every call ends within 10 s, whatever signal the caller passes — combined with it, never replaced by it. */
  function deadline(callerSignal) {
    var timeout = AbortSignal.timeout(10000);
    /* Only a real AbortSignal is combined: a client object's other "signal" must not turn every call into an error. */
    if (!(callerSignal instanceof AbortSignal) || typeof AbortSignal.any !== "function") return timeout;
    return AbortSignal.any([callerSignal, timeout]);
  }

  /* A cookie-less tools/call on the public search server; a failure answers as a tool error, never a thrown promise. */
  function call(name, input, opts) {
    /* Started inside the chain, so a synchronous throw (a bad caller signal, input that will not serialise, a browser
       without AbortSignal.timeout) also answers as a tool error. */
    return Promise.resolve().then(function () {
      return fetch(ENDPOINT, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: name, arguments: input || {} } }),
      signal: deadline(opts && opts.signal),
      });
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return message(res);
      })
      .then(function (body) {
        if (body.error || body.result === undefined) throw new Error((body.error && body.error.message) || "no result");
        return body.result;
      })
      .catch(function (e) {
        return { content: [{ type: "text", text: location.hostname + " search failed: " + e.message }], isError: true };
      });
  }

  /* Per tool: in (the browser took it) or pending (its registerTool has not settled — never called twice meanwhile). A
     refusal, now or later, leaves the tool out of both, so the next pass tries it again; the others are never held up. */
  var done = {};
  var pending = {};
  function registerEnoTools() {
    var mc = document.modelContext || navigator.modelContext;
    if (mc && typeof mc.registerTool !== "function") mc = navigator.modelContext;
    if (!mc || typeof mc.registerTool !== "function") return;
    var register = function (tool) {
      var name = tool.name;
      if (done[name] || pending[name]) return;
      pending[name] = true;
      try {
        Promise.resolve(mc.registerTool(tool)).then(
          function () { done[name] = true; delete pending[name]; },
          function () { delete pending[name]; }
        );
      } catch (e) {
        delete pending[name];
      }
    };
${readOnly.map(registration).join('\n')}
  }

  registerEnoTools();
  /* Passes again later: a modelContext that appears a moment after load, and any tool refused so far. Each pass registers
     only what is not in yet. ⚖️ A DELIBERATE TRADE (commit gate rounds 1–3, codex + opus asked for both): a FIXED, bounded
     set of passes over recovery at any hour — a refusal that lands after the last pass (about 25 minutes in) waits for a
     reload. Every retry-on-refusal scheme tried here either clustered or outgrew its bound. */
  [2000, 10000, 30000, 90000, 300000, 900000, 1500000].forEach(function (delay) { setTimeout(registerEnoTools, delay); });
})();
`
}

export const WEBMCP_HEADERS = {
  'content-type': 'application/javascript; charset=utf-8',
  // 5 minutes in a browser, an hour at the edge. No `?v=` stamp: nginx stamps `eno-public` on everything it serves
  // (infra/vn-node/eno-deploy.sh) and every deploy purges that tag, so after a deploy an older script (older names or input
  // schemas) can live on only in a browser, for at most 5 minutes — and its calls still reach the live server, which
  // answers an unknown tool or argument with a tool error. ⚖️ Accepted (commit gate, codex): the layout cannot hash the
  // descriptors without importing the search tools (and their database client) into every page. Next keeps a route
  // handler's own Cache-Control under `revalidate` — /llms.txt, built the same way, serves its LLMS_HEADERS live.
  // No stale-while-revalidate: a browser must not run an older copy past its 5 minutes (commit gate, codex).
  'cache-control': 'public, max-age=300, s-maxage=3600',
  'x-content-type-options': 'nosniff',
}
