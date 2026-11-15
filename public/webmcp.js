/*
 * WebMCP — the listing-search tools of this site, offered to a BROWSER AGENT on the page itself (WebMCP is the proposed
 * web standard for in-page agent tools: `document.modelContext.registerTool()`, `navigator.modelContext` as a fallback).
 *
 * ⛔ WHY A PLAIN FILE IN public/, LOADED BY A <script src> IN src/app/[lang]/layout.tsx (2026-11-16): the same code shipped
 * as a React client component (webmcp-tools.tsx) was LIVE but invisible to ora.ai, which reads only the scripts a page's
 * HTML names (measured: "scanned 2 of 2 same-origin script bundle(s)"); a client component rides a chunk the RSC payload
 * loads. A same-origin <script src> is also what any other agent-readiness checker reads first. CSP allows it ('self').
 * ⛔ THE SAME TOOLS AS THE PUBLIC SEARCH MCP SERVER, NOT NEW ONES: names, descriptions and input schemas come from
 * `tools/list` on /api/mcp/search, and every call is a `tools/call` there — that endpoint's own read-only tools, licensing
 * filter, rate limit and input bounds. Nothing here can do more than a stranger with curl.
 * ⛔ `credentials: 'omit'`: no cookie, so a signed-in reader's agent sees exactly the public results.
 * ⛔ ONLY A TOOL THE SERVER ITSELF MARKS READ-ONLY (`annotations.readOnlyHint === true`) is offered.
 * ⚠️ NOTHING HAPPENS IN A NORMAL BROWSER: without `modelContext` (now, or at the late checks) not one request is made.
 * ONE loop per document (`window.__enoWebMcp`); any failure waits 1 min doubling to 15, at most 10 attempts.
 * ⛔ NEVER IN A FRAME (commit gate, opus): the concierge's window and the app's sheet are pages of this site in a frame,
 * and a <script> runs before React could leave it out — the page around the frame already offers the tools.
 * CSP: measured 2026-11-16, `script-src 'self' 'unsafe-inline' …` with no 'strict-dynamic', so a same-origin src runs.
 * Tests: src/lib/webmcp-script.test.ts (runs THIS file; it also holds the layout's `?v=` equal to this file's hash).
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.__enoWebMcp) return;
  if (window.top !== window.self) return;
  window.__enoWebMcp = true;

  var ENDPOINT = "/api/mcp/search";
  var BACKOFF_MIN_MS = 60000;
  var BACKOFF_MAX_MS = 15 * 60000;
  var MAX_ATTEMPTS = 10;
  // From the script's own start, which is before React hydrates (commit gate, codex): looked for up to a minute and a half.
  var LATE_CHECKS_MS = [2000, 10000, 30000, 90000];
  /** A registerTool that never settles must not stall the loop (commit gate, codex): it counts as refused after 10 s. */
  var REGISTER_TIMEOUT_MS = 10000;
  /** Names registered in this document (or skipped as not read-only). */
  var registered = new Set();

  /** The JSON-RPC reply to request id 1, from a JSON body or from Server-Sent Events read AS THEY ARRIVE (a server that
   * keeps the stream open after replying must not turn a reply into a timeout). */
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
        var events = buffer.split(/\r?\n\r?\n/);
        buffer = chunk.done ? "" : events.pop() || "";
        for (var i = 0; i < events.length; i++) {
          var data = events[i]
            .split(/\r?\n/)
            .filter(function (l) { return l.indexOf("data:") === 0; })
            .map(function (l) { return l.slice(5).replace(/^ /, ""); })
            .join("\n");
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

  async function rpc(method, params) {
    var res = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      // A request that never settles must not stall the loop: it fails after 10 s and the backoff takes over.
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var body = await message(res);
    if (body.error || body.result === undefined) throw new Error((body.error && body.error.message) || "HTTP " + res.status);
    return body.result;
  }

  /** `document.modelContext` first, `navigator.modelContext` as the trailing compatibility fallback; each checked on its
   * own, so a document object without a usable registerTool does not hide a navigator one that has it. */
  function modelContext() {
    var usable = function (mc) { return mc && typeof mc.registerTool === "function" ? mc : null; };
    return usable(document.modelContext) || usable(navigator.modelContext);
  }

  /** Every page of tools/list (MCP pagination, `nextCursor`), at most 10 pages. */
  async function listTools() {
    var tools = [];
    var cursor;
    for (var page = 0; page < 10; page++) {
      var list = await rpc("tools/list", cursor ? { cursor: cursor } : {});
      tools.push.apply(tools, list.tools || []);
      cursor = typeof list.nextCursor === "string" && list.nextCursor ? list.nextCursor : undefined;
      if (!cursor) break;
    }
    return tools;
  }

  /** Names whose registerTool call has not settled yet (commit gate, codex): never called a second time while pending — a
   * late success is recorded when it lands, a late refusal frees the name for the next attempt. */
  var pending = new Set();

  function withTimeout(promise, ms) {
    var timer;
    return Promise.race([
      promise,
      new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("registerTool timed out")); }, ms); }),
    ]).finally(function () { clearTimeout(timer); });
  }

  async function registerMissing(mc) {
    var tools = await listTools();
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      if (registered.has(t.name) || pending.has(t.name)) continue;
      // Only a tool the SERVER marks read-only: a writing tool added to /api/mcp/search one day is skipped, never offered.
      if (!t.annotations || t.annotations.readOnlyHint !== true) { registered.add(t.name); continue; }
      var name = t.name;
      var definition = {
        name: name,
        description: t.description || name,
        inputSchema: t.inputSchema || { type: "object", properties: {} },
        annotations: t.annotations,
        execute: (function (toolName) {
          return async function (args) {
            try {
              return await rpc("tools/call", { name: toolName, arguments: args || {} });
            } catch (e) {
              return { content: [{ type: "text", text: location.hostname + " search failed: " + e.message }], isError: true };
            }
          };
        })(name),
      };
      // Awaited: an implementation whose registerTool returns a Promise and rejects it is a refusal too. Its outcome is
      // recorded whenever it settles, inside the 10 s or after.
      var op = Promise.resolve().then(function () { return mc.registerTool(definition); });
      pending.add(name);
      op.then(
        (function (n) { return function () { registered.add(n); pending.delete(n); }; })(name),
        (function (n) { return function () { pending.delete(n); }; })(name)
      );
      try {
        await withTimeout(op, REGISTER_TIMEOUT_MS);
      } catch (e) {
        /* refused (tried again next attempt) or still pending (recorded when it settles); the others still register */
      }
    }
    var allIn = tools.length > 0 && tools.every(function (x) { return registered.has(x.name); });
    if (!allIn) throw new Error("a tool was refused");
  }

  function begin(mc) {
    var failures = 0;
    var attempt = async function () {
      try {
        await registerMissing(mc);
      } catch (e) {
        failures++;
        if (failures >= MAX_ATTEMPTS) return;
        setTimeout(function () { void attempt(); }, Math.min(BACKOFF_MIN_MS * Math.pow(2, failures - 1), BACKOFF_MAX_MS));
      }
    };
    void attempt();
  }

  var now = modelContext();
  if (now) { begin(now); return; }
  // A browser (or an agent extension) may expose `modelContext` a moment after the page loads: looked for again, then never.
  var found = false;
  LATE_CHECKS_MS.forEach(function (delay) {
    setTimeout(function () {
      if (found) return;
      var late = modelContext();
      if (late) { found = true; begin(late); }
    }, delay);
  });
})();
