/**
 * MCP protocol wiring for the CyberChef tool layer.
 *
 * The four meta-tools are always-on infrastructure; a per-session Server
 * instance is created by the entry point (one Protocol per transport, per
 * SDK requirements). Operation enablement is injected into every tool call
 * via the dispatcher context.
 *
 * @license Apache-2.0
 */

import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import TOOLS from "./tools.mjs";
import {LIMITS} from "./toolUtils.mjs";

/**
 * @param {import("./state.mjs").default} state
 * @param {Object} serverInfo - {name, version}
 * @returns {Server}
 */
export function createMcpServer(state, serverInfo) {
    const server = new Server(serverInfo, {
        capabilities: {
            tools: {},
        },
    });

    const toolIndex = Object.create(null);
    for (const tool of TOOLS) toolIndex[tool.name] = tool;

    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: TOOLS.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async request => {
        const name = request.params.name;
        const args = request.params.arguments || {};
        const tool = toolIndex[name];
        if (!tool) {
            return errorResult(`Unknown tool: ${name}`);
        }

        const ctx = {
            isOperationEnabled: opName => state.isOperationEnabled(opName),
        };
        const started = Date.now();
        let result;
        try {
            result = await withTimeout(tool.run(args, ctx), LIMITS.callTimeoutMs);
        } catch (err) {
            state.record({
                tool: name,
                args,
                ok: false,
                durationMs: Date.now() - started,
                error: err.message || String(err),
            });
            return errorResult(err.message || String(err));
        }

        let serialised;
        try {
            serialised = JSON.stringify(result);
        } catch (err) {
            serialised = undefined;
        }
        state.record({
            tool: name,
            args,
            ok: true,
            durationMs: Date.now() - started,
            result: serialised,
        });

        return {
            content: [{
                type: "text",
                text: serialised === undefined ? String(result) : serialised,
            }],
        };
    });

    return server;
}

/**
 * Reject a promise that runs past the call timeout. This cannot cancel
 * synchronous CPU-bound operations, but stops transports hanging forever.
 *
 * @param {Promise} promise
 * @param {number} ms
 * @returns {Promise}
 */
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve, reject) =>
            setTimeout(() => reject(new Error(
                `Tool call timed out after ${ms}ms (MCP_TIMEOUT_MS)`
            )), ms)),
    ]);
}

/**
 *
 */
function errorResult(message) {
    return {
        isError: true,
        content: [{type: "text", text: message}],
    };
}
