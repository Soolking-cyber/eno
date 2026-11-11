# eno-vn

The command-line client for the [eno.vn Partner API](https://eno.vn/developers): manage your eno.vn shop's listings,
catalogue sync, media, analytics and webhooks from a terminal, a script or an AI agent. No dependencies; Node 18+.

```sh
npx eno-vn status                       # no key needed
export ENO_API_KEY=eno_live_…           # dashboard → Developers on eno.vn (business accounts)
npx eno-vn listings --all
npx eno-vn create listing.json
npx eno-vn set-status LISTING_ID sold
npx eno-vn sync catalogue.json --full
```

Every command prints the API's JSON answer on stdout, a refusal included. Exit codes: 0 success, 1 the API refused,
2 usage error, 3 no confirmed answer (network, timeout, redirect, unexpected reply) — a write may have happened, so
check before repeating it. `npx eno-vn help` lists every command.

There is no sandbox and no test key: a key is live from the moment it is issued.

`ENO_BASE_URL` (default https://eno.vn) points the client at another deployment of the same API.

- Guide: https://eno.vn/developers/cli
- API reference: https://eno.vn/developers · OpenAPI: https://eno.vn/openapi.json
- MCP server (for AI agents): https://eno.vn/developers/mcp
