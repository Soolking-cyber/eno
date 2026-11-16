# eno-vn-mcp

The [eno.vn](https://eno.vn) MCP servers for MCP clients that start a local (stdio) server. eno.vn is Vietnam's
classifieds marketplace for expats and locals.

This package is a bridge to eno.vn's hosted servers, not a separate implementation. Each message your client sends is
forwarded to eno.vn, so the tools, their schemas and their rules are always the hosted ones. Clients that connect to a
remote server can add the URLs from <https://eno.vn/developers/mcp> directly and do not need this package.

## Servers

| `--server` | What it does | Key |
|---|---|---|
| `search` | Search live eno.vn listings and open one. The default without `ENO_API_KEY`. | none |
| `docs` | Search and read eno.vn's documentation for agents. | none |
| `shop` | Manage your eno.vn shop: listings, catalogue sync, analytics, webhooks. The default with `ENO_API_KEY`. | `ENO_API_KEY` |

## Set up

Claude Desktop, Cursor and most other clients:

```json
{
  "mcpServers": {
    "eno-vn": { "command": "npx", "args": ["-y", "eno-vn-mcp"] }
  }
}
```

To manage your shop, add your key, created in **dashboard → Developers** on eno.vn (business accounts):

```json
{
  "mcpServers": {
    "eno-vn-shop": { "command": "npx", "args": ["-y", "eno-vn-mcp"], "env": { "ENO_API_KEY": "eno_live_…" } }
  }
}
```

The key is live from the moment it is issued: there is no sandbox. It is sent to the shop server only, never to `search`
or `docs`, and no tool ever asks the model for it.

## Environment

- `ENO_API_KEY`: your `eno_live_…` key.
- `ENO_BASE_URL`: another origin, for example a local copy of eno.vn. The default is `https://eno.vn`.

Node 18 or later. No dependencies.

## Licence

MIT. Docs: <https://eno.vn/developers/mcp>. Support: support@eno.vn.

Also in the official MCP Registry as [vn.eno/search](https://registry.modelcontextprotocol.io/v0/servers?search=vn.eno).
