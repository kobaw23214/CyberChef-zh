#############################################
# All-in-one image: Web UI (nginx) + MCP server (node) in one container #
#############################################
# Target: linux/arm64 (built by build-arm64.sh with the repository root as
# context). One container exposes :8080 (Web UI) and :8090 (MCP + management
# API); see src/mcp/container/ for the nginx config and entrypoint.
#
# The generated config artifacts (OperationConfig.json, src/node/index.mjs,
# src/core/config/modules/) are not tracked in git and are regenerated here.
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# --ignore-scripts: postinstall (grunt) needs the full source tree, run later
RUN npm ci --ignore-scripts

COPY . .

# Web production build + Node config generation.
#
# NOTE: devDependencies are deliberately kept. Many operations import
# libraries that upstream classifies as devDependencies (they bundle them
# with webpack for distribution); the MCP server runs the source directly
# and needs the same node_modules the test suite uses.
RUN npm run postinstall && \
    npm run build && \
    node src/core/config/scripts/generateConfig.mjs && \
    node src/node/config/scripts/generateNodeIndex.mjs

########################################
# Runtime: nginx + node in one container #
########################################
FROM node:24-alpine

LABEL maintainer="CyberChef zh fork"

RUN apk add --no-cache nginx

WORKDIR /app

ENV NODE_ENV=production \
    MCP_STATE_DIR=/data \
    MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8090

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/build/prod /usr/share/nginx/html
COPY src/mcp/container/nginx.conf /etc/nginx/nginx.conf
COPY src/mcp/container/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080 8090

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
    CMD wget -q --spider http://127.0.0.1:8080/ && \
        wget -q --spider http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
