/**
 * /webmcp.js — WebMCP: the public search MCP server's read-only tools, plus two that act for the signed-in visitor (below),
 * offered to a BROWSER AGENT on the page itself
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
 * ⚠️ TWO WRITE TOOLS SINCE 2026-11-19 (owner chose "save + start a message" for ora's WebMCP coverage row, "covers 2 of the 4
 * things an agent needs … cannot create a record or start a job or update or move an existing record" — hence the verbs):
 * update_saved_listings (the Saved list) and start_seller_chat (opens or continues a chat with a listing's seller). They run in the VISITOR'S OWN
 * SESSION — a same-origin fetch with cookies to the endpoints the page's own buttons call (/api/saved-listings,
 * /api/conversations), so every rate limit and gate applies unchanged and a signed-out visitor gets "sign in first". A
 * message carries `agent: "webmcp"`: the route then applies the MCP agents' rules (src/lib/agent-text.ts — the 🤖 AI label,
 * no contact or payment details, no offer, never a teacher). Neither is read-only, and start_seller_chat is consequential.
 * Both carry untrustedContentHint like every tool not in SITE_TEXT_ONLY_TOOLS (ora 2026-11-19 read a chat tool's answer as
 * other people's words, and the rule fails closed).
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

/** A tool's annotations as registered: untrustedContentHint on every tool but the site-text-only ones (above). */
function withUntrustedHint(t: WebMcpDescriptor): Record<string, unknown> | undefined {
  return SITE_TEXT_ONLY_TOOLS.has(t.name) ? t.annotations : { ...t.annotations, untrustedContentHint: true }
}

/** One `register({...})` call: a JSON object literal (valid JS) plus the `execute` that sends it to the server. */
function registration(t: WebMcpDescriptor): string {
  const json = JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: withUntrustedHint(t) })
  return `    register(${json.slice(0, -1)},"execute":function (input, opts) { return call(${JSON.stringify(t.name)}, input, opts); }});`
}

/** A listing id as the site writes it (src/lib/listing-ids.ts SAVED_LISTING_ID_RE). */
const LISTING_ID = { type: 'string', description: 'The listing id, as in /listings/<id>.', pattern: '^[A-Za-z0-9_-]{1,64}$' }

/** The two write tools (header): literal objects, like the read tools, each calling its own function in the script. */
export const WRITE_TOOLS: { tool: WebMcpDescriptor; fn: 'saveListing' | 'messageSeller' }[] = [
  {
    fn: 'saveListing',
    tool: {
      name: 'update_saved_listings',
      description: "Update the signed-in visitor's Saved list on this site: save a listing to it, or remove it with saved: false. The visitor must be signed in.",
      inputSchema: {
        type: 'object',
        properties: { listing_id: LISTING_ID, saved: { type: 'boolean', description: 'true to save (the default), false to remove it from Saved.' } },
        required: ['listing_id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  },
  {
    fn: 'messageSeller',
    tool: {
      name: 'start_seller_chat',
      description: "Start (or continue) a chat with a listing's seller: sends one message in the signed-in visitor's name, labelled as written by an AI assistant (🤖 AI). Contact or payment details, offers and teachers' profiles are refused. The visitor must be signed in.",
      inputSchema: {
        type: 'object',
        properties: {
          listing_id: LISTING_ID,
          message: { type: 'string', description: 'What to say to the seller in plain words: no phone numbers, emails, links or account numbers.', minLength: 1, maxLength: 1800 },
        },
        required: ['listing_id', 'message'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, consequentialHint: true },
    },
  },
]

export function buildWebmcpScript(tools: WebMcpDescriptor[]): string {
  const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true)
  return `/* WebMCP: this site's public search tools (read-only) and two that act for the signed-in visitor (save a listing,
   message a seller), for a browser agent. Source: src/lib/webmcp-script.ts */
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

  /* The two write tools: the visitor's OWN session (same-origin, cookies), on the endpoints the page's own buttons call,
     so their rate limits and checks apply unchanged. A failure answers as a tool error, never a thrown promise. */
  function site(path, init, opts) {
    return Promise.resolve().then(function () {
      return fetch(path, Object.assign({ credentials: "same-origin", signal: deadline(opts && opts.signal) }, init));
    }).then(function (res) {
      return res.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
        return { status: res.status, body: body };
      });
    });
  }
  function answer(text, isError) { return { content: [{ type: "text", text: text }], isError: !!isError }; }
  var SIGN_IN = "Sign in on " + location.hostname + " first: this tool acts for the signed-in visitor.";
  function saveListing(input, opts) {
    var id = String((input && input.listing_id) || "");
    var save = !(input && input.saved === false);
    return site("/api/saved-listings", { method: "GET" }, opts).then(function (r) {
      if (r.status === 401 || r.status === 403) return answer(SIGN_IN, true);
      if (r.status !== 200 || !r.body || !r.body.uid) return answer("Could not read the Saved list (HTTP " + r.status + ").", true);
      var write = { uid: r.body.uid };
      write[save ? "add" : "remove"] = [id];
      return site("/api/saved-listings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(write) }, opts).then(function (w) {
        if (w.status === 401 || w.status === 403) return answer(SIGN_IN, true);
        if (w.status >= 300) return answer("Not changed: " + ((w.body && w.body.error) || ("HTTP " + w.status)) + ".", true);
        return answer((save ? "Saved: " : "Removed from Saved: ") + location.origin + "/listings/" + id);
      });
    }).catch(function (e) { return answer("Not changed: " + e.message, true); });
  }
  function messageSeller(input, opts) {
    var id = String((input && input.listing_id) || "");
    var text = String((input && input.message) || "").trim();
    return site("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingId: id, message: text, agent: "webmcp" }) }, opts).then(function (r) {
      if (r.status === 401) return answer(SIGN_IN, true);
      var code = r.body && r.body.error;
      if (code === "contact_in_text") return answer("Not sent: keep phone numbers, emails, outside links and account numbers out of an agent's message; people arrange those themselves in the app.", true);
      if (r.status >= 300 || !r.body || !r.body.id) return answer("Not sent: " + (code || ("HTTP " + r.status)) + ".", true);
      return answer("Sent to the seller, labelled as an AI assistant's (🤖 AI). The chat: " + location.origin + "/messages/" + r.body.id);
    }).catch(function (e) { return answer("Not sent: " + e.message, true); });
  }

  /* Per tool: in (the browser took it) or pending (its registerTool has not settled — never called twice meanwhile). A
     refusal, now or later, leaves the tool out of both, so the next pass tries it again; the others are never held up. */
  var done = {};
  var pending = {};
  function registerEnoTools() {
    /* ora's own shape: document.modelContext, navigator only as the trailing fallback. ⛔ No second assignment from navigator
       (ora 2026-11-17 read one as "every tool registers through the deprecated navigator alias"): a document.modelContext
       without registerTool registers nothing, and the later passes below try again. */
    var mc = document.modelContext || navigator.modelContext;
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
${WRITE_TOOLS.map((w) => `    register(${JSON.stringify({ ...w.tool, annotations: withUntrustedHint(w.tool) }).slice(0, -1)},"execute":function (input, opts) { return ${w.fn}(input, opts); }});`).join('\n')}
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
