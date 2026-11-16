---
name: eno-shop-listings
description: "Manage one eno.vn shop's listings from an AI agent through eno.vn's Partner MCP server: create, edit, mark sold or hidden, delete, bulk-create from a stock list, and sync with your own catalogue by externalId. Use when a seller wants to put their stock on eno.vn or keep it up to date."
---

# Manage an eno.vn shop's listings

Server: `https://eno.vn/api/mcp` (MCP, Streamable HTTP). REST twin: `https://eno.vn/api/v1`, described by `https://eno.vn/openapi.json`.

## Connect

One credential acts for exactly one storefront. Either sign in with eno (OAuth 2.0; the server's 401 points at its metadata), or send `Authorization: Bearer <key>` with a Partner API key issued in the eno.vn dashboard under Developers. Full walkthrough: https://eno.vn/auth.md.

## Tools

- `get_shop` / `update_shop`: the storefront's profile.
- `list_listings`, `get_listing`: the shop's own listings, in any status. Read a listing before `update_listing`.
- `create_listing`, `update_listing`: one listing (title, text, price in VND, district, condition, photos as public image URLs, a job's salary).
- `set_listing_status`: active, sold or hidden. Active again undoes sold or hidden unless refused with a reason code (a held account, a pending licence check).
- `delete_listing`: for good. Ask the seller to confirm first, or use `set_listing_status` hidden instead.
- `bulk_create_listings`: many new listings in one call, one row each.
- `sync_catalogue`: match by your `externalId`. A new one creates, a known one updates in place, a row's status can mark it sold or hidden.

## Rules

- Write access is this shop's own listings only.
- Prices are whole Vietnamese đồng (VND).
- A listing may wait for eno.vn's check before it is live; say so rather than retrying.
- 600 requests per 60 seconds per key; a 429 carries `Retry-After`.
