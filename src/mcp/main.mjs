#!/usr/bin/env node
/* eslint no-console: ["off"] */
/**
 * CyberChef MCP server entry point.
 *
 * Transports:
 *   stdio  for local agents (default)
 *   http   Streamable HTTP on /mcp for remote agents, plus the JSON
 *          management API on /api/* used by the CyberChef web UI panel
 *          (tool enablement + call records).
 *
 * Configuration (environment variables):
 *   MCP_TRANSPORT   stdio | http
 *   MCP_HOST        http bind address (default 127.0.0.1)
 *   MCP_PORT        http port (default 8090)
 *   MCP_STATE_DIR   state directory (default .mcp-state under repo root)
 *
 * Usage:
 *   node src/mcp/main.mjs                      # stdio
 *   node src/mcp/main.mjs --transport http     # HTTP on 127.0.0.1:8090
 *
 * @license Apache-2.0
 */

import fs from "fs";
import http from "http";
import path from "path";
import {randomUUID} from "crypto";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {createMcpServer} from "./server.mjs";
import McpState from "./state.mjs";
import {
    buildOperationTree,
    allOperationNames,
    resolveOperationName,
} from "./tools.mjs";

const MCP_PATH = "/mcp";

const serverInfo = (() => {
    const pkg = JSON.parse(fs.readFileSync(
        new URL("../../package.json", import.meta.url), "utf8"));
    return {name: "cyberchef-mcp", version: pkg.version};
})();

/**
 *
 */
function parseArgs() {
    const opts = {
        transport: process.env.MCP_TRANSPORT === "http" ? "http" : "stdio",
        host: process.env.MCP_HOST || "127.0.0.1",
        port: Number(process.env.MCP_PORT || 8090),
    };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--transport" && argv[i + 1]) opts.transport = argv[++i];
        else if (argv[i] === "--host" && argv[i + 1]) opts.host = argv[++i];
        else if (argv[i] === "--port" && argv[i + 1]) opts.port = Number(argv[++i]);
    }
    return opts;
}

const stateDir = process.env.MCP_STATE_DIR ||
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../.mcp-state");
const state = new McpState(stateDir);

// ─── stdio ──────────────────────────────────────────────────────────────────

/**
 *
 */
async function runStdio() {
    const transport = new StdioServerTransport();
    await createMcpServer(state, serverInfo).connect(transport);
}

// ─── HTTP (MCP + management API) ────────────────────────────────────────────

// One Protocol instance per session: the SDK forbids connecting a single
// Server to multiple transports. All instances share the same state, so
// enablement changes broadcast listChanged to every live session.
const transports = new Map(); // sessionId -> StreamableHTTPServerTransport
const sessionServers = new Set(); // live per-session Server instances

/**
 *
 */
async function handleMcpRequest(req, res, body) {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId) {
        const transport = transports.get(sessionId);
        if (!transport) {
            res.writeHead(404).end("Session not found. Restart the client.");
            return;
        }
        await transport.handleRequest(req, res, body);
        return;
    }

    // New session: only POST may initialise one.
    if (req.method === "POST") {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: id => transports.set(id, transport),
        });
        const sessionServer = createMcpServer(state, serverInfo);
        sessionServers.add(sessionServer);
        transport.onclose = () => {
            for (const [id, t] of transports) {
                if (t === transport) transports.delete(id);
            }
            sessionServers.delete(sessionServer);
            sessionServer.close().catch(() => {});
        };
        await sessionServer.connect(transport);
        await transport.handleRequest(req, res, body);
    } else {
        res.writeHead(400).end("No valid session. POST to initialise.");
    }
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<Object|undefined>} parsed JSON body
 */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", chunk => {
            size += chunk.length;
            if (size > 20 * 1024 * 1024) {
                reject(new Error("Body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (!chunks.length) return resolve(undefined);
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}

/**
 *
 */
function sendJson(res, status, payload) {
    res.writeHead(status, {"Content-Type": "application/json"});
    res.end(JSON.stringify(payload));
}

/**
 * Parse an optional time filter parameter: ISO string or epoch millis.
 *
 * @param {string|null} value
 * @returns {number|null} epoch millis, or null when absent/invalid
 */
function parseTimeParam(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

/**
 *
 */
async function handleApiRequest(req, res, url, body) {
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    if (parts[0] !== "api") return false;

    if (req.method === "GET" && parts[1] === "health") {
        sendJson(res, 200, {ok: true, name: serverInfo.name, version: serverInfo.version});
    } else if (req.method === "GET" && parts[1] === "operations") {
        const lang = url.searchParams.get("lang") || "zh-CN";
        sendJson(res, 200, await buildOperationTree(state, lang));
    } else if (req.method === "POST" && parts[1] === "operations" && parts[2] === "all") {
        if (typeof body?.enabled !== "boolean") {
            sendJson(res, 400, {error: "Body must be {enabled: boolean}"});
        } else {
            state.setAllOperations(body.enabled, allOperationNames());
            sendJson(res, 200, {enabled: state.disabledCount() === 0});
        }
    } else if (req.method === "POST" && parts[1] === "operations" && parts[2] === "bulk") {
        if (typeof body?.enabled !== "boolean" || !Array.isArray(body?.names) ||
            !body.names.every(n => typeof n === "string")) {
            sendJson(res, 400, {error: "Body must be {names: string[], enabled: boolean}"});
        } else {
            const affected = state.setOperationsEnabled(body.names, body.enabled);
            sendJson(res, 200, {updated: affected, enabled: body.enabled});
        }
    } else if (req.method === "POST" && parts[1] === "operations" && parts[3] === "enabled") {
        const name = decodeURIComponent(parts[2]);
        if (typeof body?.enabled !== "boolean") {
            sendJson(res, 400, {error: "Body must be {enabled: boolean}"});
        } else if (!await resolveOperationName(name)) {
            sendJson(res, 404, {error: `Unknown operation: ${name}`});
        } else {
            state.setOperationEnabled(await resolveOperationName(name), body.enabled);
            sendJson(res, 200, {name, enabled: body.enabled});
        }
    } else if (req.method === "GET" && parts[1] === "records") {
        // Filters: tool (substring, case-insensitive), from/to (ISO or ms
        // timestamps, inclusive). All optional.
        const tool = (url.searchParams.get("tool") || "").trim().toLowerCase();
        const from = parseTimeParam(url.searchParams.get("from"));
        const to = parseTimeParam(url.searchParams.get("to"));
        const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
        sendJson(res, 200, {
            records: state.listRecords(500).filter(rec => {
                if (tool && !rec.tool.toLowerCase().includes(tool)) return false;
                const ts = Date.parse(rec.ts);
                if (from !== null && ts < from) return false;
                if (to !== null && ts > to) return false;
                return true;
            }).slice(0, limit),
        });
    } else if (req.method === "POST" && parts[1] === "records" && parts[2] === "clear") {
        state.clearRecords();
        sendJson(res, 200, {ok: true});
    } else {
        sendJson(res, 404, {error: "Not found"});
    }
    return true;
}

/**
 *
 */
function applyCors(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers",
        "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization, Last-Event-ID");
    if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return true;
    }
    return false;
}

/**
 *
 */
async function runHttp(opts) {
    const server = http.createServer(async (req, res) => {
        try {
            if (applyCors(req, res)) return;

            const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

            if (url.pathname === "/" && req.method === "GET") {
                sendJson(res, 200, {
                    name: serverInfo.name,
                    version: serverInfo.version,
                    mcp: MCP_PATH,
                    management: "/api/operations, /api/records",
                });
                return;
            }

            if (url.pathname === MCP_PATH) {
                const body = req.method === "POST" ? await readJsonBody(req) : undefined;
                await handleMcpRequest(req, res, body);
                return;
            }

            const body = req.method === "POST" ? await readJsonBody(req) : undefined;
            const handled = await handleApiRequest(req, res, url, body);
            if (!handled) sendJson(res, 404, {error: "Not found"});
        } catch (err) {
            if (!res.headersSent) {
                sendJson(res, 500, {error: err.message || "Internal error"});
            } else {
                res.end();
            }
        }
    });

    await new Promise(resolve => server.listen(opts.port, opts.host, resolve));
    console.log(`cyberchef-mcp ${serverInfo.version} (HTTP) listening on ` +
        `http://${opts.host}:${opts.port}${MCP_PATH} | state: ${stateDir}`);
    console.log("WARNING: no authentication configured; bind to a trusted network only.");
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const opts = parseArgs();
if (opts.transport === "http") {
    await runHttp(opts);
} else {
    await runStdio();
}
