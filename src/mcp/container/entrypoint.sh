#!/bin/sh
# All-in-one container entrypoint: nginx serves the Web UI on :8080 while the
# MCP server listens on :8090. If either process dies the container exits so
# the restart policy brings the whole appliance back.
set -u

mkdir -p /tmp/nginx

nginx -c /etc/nginx/nginx.conf -g 'daemon off;' &
NGINX_PID=$!

node --no-warnings --openssl-legacy-provider src/mcp/main.mjs \
    --transport http --host 0.0.0.0 --port "${MCP_PORT:-8090}" &
NODE_PID=$!

# wait -n returns as soon as the first background job exits.
wait -n

kill "$NGINX_PID" "$NODE_PID" 2>/dev/null
exit 1
