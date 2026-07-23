#!/bin/bash
# PayPal MCP launcher — mints a fresh OAuth access token from the client credentials
# in .env (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV) and execs the MCP.
# WHY A WRAPPER: @paypal/mcp wants a PAYPAL_ACCESS_TOKEN, which expires (~9h) — a
# static token in .mcp.json would go stale every morning; client credentials don't.
# No secrets live in git: this reads the gitignored .env at launch time.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

if [ -z "${PAYPAL_CLIENT_ID:-}" ] || [ -z "${PAYPAL_CLIENT_SECRET:-}" ]; then
  echo "PayPal MCP: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing from .env" >&2
  exit 1
fi
case "${PAYPAL_ENV:-sandbox}" in
  live) API="https://api-m.paypal.com"; MCP_ENV="PRODUCTION" ;;
  *)    API="https://api-m.sandbox.paypal.com"; MCP_ENV="SANDBOX" ;;
esac

TOKEN=$(curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
  -d 'grant_type=client_credentials' "$API/v1/oauth2/token" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).access_token||"")}catch{console.log("")}})')
if [ -z "$TOKEN" ]; then
  echo "PayPal MCP: token mint failed — check the credentials + PAYPAL_ENV" >&2
  exit 1
fi
exec env PAYPAL_ACCESS_TOKEN="$TOKEN" PAYPAL_ENVIRONMENT="$MCP_ENV" npx -y @paypal/mcp --tools=all
