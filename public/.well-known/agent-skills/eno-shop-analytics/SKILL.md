---
name: eno-shop-analytics
description: "Read an eno.vn shop's views and leads, and manage its webhooks, from an AI agent through eno.vn's Partner MCP server. Use when a seller asks how their listings are doing on eno.vn or wants their own system told when a listing changes."
---

# eno.vn shop analytics and webhooks

Server: `https://eno.vn/api/mcp`, with the shop's credential (see the eno-shop-listings skill, or https://eno.vn/auth.md).

## Tools

- `analytics_summary`: the shop's totals in one call: listings active, sold, hidden or waiting for eno.vn's check, with total views and leads (a lead is a buyer opening contact).
- `analytics_listings`: views and leads per listing, day by day (the last 30 days unless you set `from` and `to`), with all-time totals; page with `next_cursor`.
- `list_webhooks`, `register_webhook`, `delete_webhook`: HTTPS endpoints eno.vn POSTs signed events to when this shop's listings are created, updated, change status or are deleted. Remove an endpoint at once if its secret may have leaked.

## Reading the numbers

Views and leads are counted by eno.vn. A lead is a buyer opening contact, not a sale: eno.vn has no checkout, so it never knows whether a deal closed.
