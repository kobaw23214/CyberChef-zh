##############################################
# Build the Node API layer for the MCP server #
##############################################
# Target: linux/arm64 (matches the web image build in build-arm64.sh).
# The generated config artifacts (OperationConfig.json, src/node/index.mjs,
# src/core/config/modules/) are not tracked in git and must be regenerated
# here before the runtime stage copies src/.
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# --ignore-scripts: postinstall (grunt) needs the full source tree, run later
RUN npm ci --ignore-scripts

COPY . .

# Re-apply the node_modules patches postinstall normally makes, then
# generate the config artifacts the Node API imports at runtime.
#
# NOTE: devDependencies are deliberately kept. Many operations import
# libraries that upstream classifies as devDependencies (they bundle them
# with webpack for distribution); the MCP server runs the source directly
# and needs the same node_modules the test suite uses.
RUN npm run postinstall && \
    node src/core/config/scripts/generateConfig.mjs && \
    node src/node/config/scripts/generateNodeIndex.mjs

########################################
# Runtime: MCP server (stdio + HTTP)   #
########################################
FROM node:24-alpine

LABEL maintainer="CyberChef zh fork"

WORKDIR /app

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8090 \
    MCP_STATE_DIR=/data

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src

EXPOSE 8090

# --openssl-legacy-provider matches the Node test suite flags so legacy
# crypto operations keep working.
CMD ["node", "--no-warnings", "--openssl-legacy-provider", "src/mcp/main.mjs"]
