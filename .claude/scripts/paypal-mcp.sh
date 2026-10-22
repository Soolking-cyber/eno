#!/bin/bash
# PayPal MCP launcher — mints a fresh OAuth access token from the client credentials
# in .env (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV) and execs the MCP.
# WHY A WRAPPER: @paypal/mcp wants a PAYPAL_ACCESS_TOKEN, which expires (~9h) — a
# static token in .mcp.json would go stale every morning; client credentials don't.
# No secrets live in git: this reads the gitignored .env at launch time.
#
# ⚠️ WHAT THE MCP IS GIVEN, AND NOTHING ELSE (security review 2026-10-22, item 28):
#   · only the three PAYPAL_* lines are read from .env, never evaluated as shell — sourcing the whole file
#     exported every secret in it (database URL, Supabase service key, …) into a third-party npm package;
#   · the inherited environment is scrubbed to a keep-list before the exec, for the same reason;
#   · the package is pinned to an exact version — `npx -y @paypal/mcp` ran whatever was published last,
#     holding a live PayPal token. To upgrade, check the release, then bump PAYPAL_MCP_VERSION;
#   · the client secret reaches curl through its config on stdin, never its argv (which `ps` shows).
set -euo pipefail
cd "$(dirname "$0")/../.."

PAYPAL_MCP_VERSION=1.8.1

# The value of KEY in .env: the last plain `KEY=value` (or `export KEY=value`) line, one layer of quotes removed.
env_value() {
  local line
  line=$(grep -E "^(export[[:space:]]+)?$1=" .env | tail -n 1) || return 0
  line=${line#*=}
  line=${line%$'\r'}
  case "$line" in
    \"*\") line=${line#\"}; line=${line%\"} ;;
    \'*\') line=${line#\'}; line=${line%\'} ;;
  esac
  printf '%s' "$line"
}

PAYPAL_CLIENT_ID=$(env_value PAYPAL_CLIENT_ID)
PAYPAL_CLIENT_SECRET=$(env_value PAYPAL_CLIENT_SECRET)
PAYPAL_ENV=$(env_value PAYPAL_ENV)

if [ -z "$PAYPAL_CLIENT_ID" ] || [ -z "$PAYPAL_CLIENT_SECRET" ]; then
  echo "PayPal MCP: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing from .env" >&2
  exit 1
fi
case "${PAYPAL_ENV:-sandbox}" in
  live) API="https://api-m.paypal.com"; MCP_ENV="PRODUCTION" ;;
  *)    API="https://api-m.sandbox.paypal.com"; MCP_ENV="SANDBOX" ;;
esac

# A curl config string: backslash and double quote escaped.
cfg_quote() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; }

TOKEN=$(curl -s --config - -d 'grant_type=client_credentials' "$API/v1/oauth2/token" \
  <<<"user = \"$(cfg_quote "$PAYPAL_CLIENT_ID"):$(cfg_quote "$PAYPAL_CLIENT_SECRET")\"" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).access_token||"")}catch{console.log("")}})')
if [ -z "$TOKEN" ]; then
  echo "PayPal MCP: token mint failed — check the credentials + PAYPAL_ENV" >&2
  exit 1
fi

# Keep what npx needs to find node and reach the registry; drop every other inherited variable.
for v in $(compgen -e); do
  case "$v" in
    PATH|HOME|USER|LOGNAME|SHELL|TERM|LANG|LC_*|TMPDIR|NODE_EXTRA_CA_CERTS|npm_config_*|NPM_CONFIG_*|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy) ;;
    *) unset "$v" 2>/dev/null || true ;;
  esac
done
export PAYPAL_ACCESS_TOKEN="$TOKEN" PAYPAL_ENVIRONMENT="$MCP_ENV"
exec npx -y "@paypal/mcp@${PAYPAL_MCP_VERSION}" --tools=all
