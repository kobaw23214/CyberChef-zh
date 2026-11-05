/**
 * MCP layer tests: tool behaviour, operation enablement gating and call
 * records.
 *
 * Exercises the full protocol path through the SDK's in-memory transport,
 * so dispatcher logic (operation disablement, error mapping, recording) is
 * covered along with the tools themselves.
 *
 * @license Apache-2.0
 */

/* eslint no-console: 0 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import it from "../assertionHandler.mjs";
import TestRegister from "../../lib/TestRegister.mjs";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createMcpServer} from "../../../src/mcp/server.mjs";
import McpState from "../../../src/mcp/state.mjs";
import {McpToolError, allOperationNames} from "../../../src/mcp/tools.mjs";
import {LIMITS} from "../../../src/mcp/toolUtils.mjs";

let client, state, stateDir;

/**
 *
 */
async function callTool(name, args) {
    return await client.callTool({name, arguments: args});
}

/**
 *
 */
async function setup() {
    if (client) return;
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberchef-mcp-test-"));
    state = new McpState(stateDir);
    const server = createMcpServer(state, {name: "test-server", version: "0.0.0"});
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({name: "test-client", version: "0.0.0"});
    await client.connect(clientSide);
}

TestRegister.addApiTests([

    it("mcp: lists the four meta-tools with schemas", async () => {
        await setup();
        const {tools} = await client.listTools();
        assert.strictEqual(tools.length, 4);
        for (const tool of tools) {
            assert(tool.description.length > 10);
            assert.strictEqual(tool.inputSchema.type, "object");
        }
        const names = tools.map(t => t.name).sort();
        assert.deepStrictEqual(names,
            ["bake", "get_operation", "list_operations", "magic"]);
    }),

    it("mcp: bake runs a recipe and returns a string", async () => {
        await setup();
        const res = await callTool("bake", {
            input: "aGVsbG8=",
            recipe: [{op: "From Base64"}],
        });
        assert.strictEqual(res.isError, undefined);
        const payload = JSON.parse(res.content[0].text);
        assert.strictEqual(payload.output, "hello");
        assert.strictEqual(payload.truncated, false);
    }),

    it("mcp: bake accepts named args (case/space-insensitive)", async () => {
        await setup();
        const res = await callTool("bake", {
            input: "hello",
            recipe: [
                {op: "To Hex", args: {"Delimiter": "None"}},
            ],
        });
        const payload = JSON.parse(res.content[0].text);
        assert.strictEqual(payload.output, "68656c6c6f");
    }),

    it("mcp: bake hex, base64 and byteArray output types", async () => {
        await setup();
        const hex = await callTool("bake", {
            input: "hi",
            recipe: [],
            outputType: "hex",
        });
        assert.strictEqual(JSON.parse(hex.content[0].text).output, "6869");

        const b64 = await callTool("bake", {
            input: "hi",
            recipe: [],
            outputType: "base64",
        });
        assert.strictEqual(JSON.parse(b64.content[0].text).output, "aGk=");

        const bytes = await callTool("bake", {
            input: "hi",
            recipe: [],
            outputType: "byteArray",
        });
        assert.deepStrictEqual(JSON.parse(bytes.content[0].text).output, [104, 105]);
    }),

    it("mcp: bake rejects unknown operations", async () => {
        await setup();
        const res = await callTool("bake", {
            input: "x",
            recipe: [{op: "No Such Operation"}],
        });
        assert.strictEqual(res.isError, true);
        assert(res.content[0].text.includes("Unknown operation"));
    }),

    it("mcp: bake maps OperationError to a tool error", async () => {
        await setup();
        const res = await callTool("bake", {
            input: "not valid base64!!!",
            recipe: [{op: "From Base64", args: {strictMode: true}}],
        });
        assert.strictEqual(res.isError, true);
        assert(res.content[0].text.length > 0);
    }),

    it("mcp: bake rejects oversized inputs", async () => {
        await setup();
        const big = "a".repeat(LIMITS.maxInputChars + 1);
        const res = await callTool("bake", {
            input: big,
            recipe: [{op: "To Base64"}],
        });
        assert.strictEqual(res.isError, true);
        assert(res.content[0].text.includes("Input too large"));
    }),

    it("mcp: bake rejects over-long recipes", async () => {
        await setup();
        const recipe = Array.from({length: LIMITS.maxRecipeOps + 1},
            () => ({op: "To Base64"}));
        const res = await callTool("bake", {
            input: "x",
            recipe,
        });
        assert.strictEqual(res.isError, true);
        assert(res.content[0].text.includes("Recipe too long"));
    }),

    it("mcp: get_operation describes arguments with options", async () => {
        await setup();
        const res = await callTool("get_operation", {name: "From Base64"});
        const payload = JSON.parse(res.content[0].text);
        assert.strictEqual(payload.name, "From Base64");
        assert(payload.nameLocal);
        assert.strictEqual(payload.nodeSupported, true);
        const alphabet = payload.args.find(a => a.name === "Alphabet");
        assert(alphabet);
        assert(alphabet.options.length >= 2);
        assert(alphabet.options.every(o => typeof o.value === "string"));
    }),

    it("mcp: get_operation resolves Chinese operation names", async () => {
        await setup();
        const res = await callTool("get_operation", {name: "MD5"});
        const payload = JSON.parse(res.content[0].text);
        assert.strictEqual(payload.name, "MD5");
        const zh = await callTool("get_operation", {name: payload.nameLocal});
        assert.strictEqual(JSON.parse(zh.content[0].text).name, "MD5");
    }),

    it("mcp: get_operation rejects unknown names", async () => {
        await setup();
        const res = await callTool("get_operation", {name: "Does Not Exist"});
        assert.strictEqual(res.isError, true);
    }),

    it("mcp: list_operations searches names and descriptions", async () => {
        await setup();
        const res = await callTool("list_operations", {query: "base64", limit: 10});
        const payload = JSON.parse(res.content[0].text);
        assert(payload.total > 3);
        assert(payload.operations.length <= 10);
        assert(payload.operations.some(o => o.name === "From Base64"));
    }),

    it("mcp: list_operations filters by category", async () => {
        await setup();
        const res = await callTool("list_operations",
            {category: "Hashing", limit: 200});
        const payload = JSON.parse(res.content[0].text);
        assert(payload.operations.some(o => o.name === "MD5"));
    }),

    it("mcp: list_operations honours lang=en", async () => {
        await setup();
        const zh = await callTool("list_operations", {query: "MD5"});
        const en = await callTool("list_operations", {query: "MD5", lang: "en"});
        const zhText = JSON.parse(zh.content[0].text).operations[0].description;
        const enText = JSON.parse(en.content[0].text).operations[0].description;
        assert.notStrictEqual(zhText, enText);
    }),

    it("mcp: magic ranks recipes with samples", async () => {
        await setup();
        const res = await callTool("magic", {
            input: "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q=",
            depth: 1,
            limit: 10,
        });
        const payload = JSON.parse(res.content[0].text);
        assert(payload.results.length >= 1);
        assert(payload.results.some(r =>
            r.recipe.length === 1 && r.recipe[0].op === "From Base64"));
        const decoded = payload.results.find(r =>
            r.recipe.length === 1 && r.recipe[0].op === "From Base64");
        assert(decoded.sample.includes("hello world"));
    }),

    it("mcp: meta-tools are always listed", async () => {
        await setup();
        const {tools} = await client.listTools();
        assert.strictEqual(tools.length, 4);
        state.setOperationEnabled("From Base64", false);
        const after = await client.listTools();
        assert.strictEqual(after.tools.length, 4);
        state.setOperationEnabled("From Base64", true);
    }),

    it("mcp: disabled operations are hidden from list_operations", async () => {
        await setup();
        state.setOperationEnabled("To Hex", false);
        const res = await callTool("list_operations", {query: "hex", limit: 200});
        const payload = JSON.parse(res.content[0].text);
        assert(!payload.operations.some(o => o.name === "To Hex"));
        assert(payload.operations.some(o => o.name === "From Hexdump"));
        state.setOperationEnabled("To Hex", true);
    }),

    it("mcp: disabled operations are rejected by get_operation and bake", async () => {
        await setup();
        state.setOperationEnabled("To Hex", false);

        const info = await callTool("get_operation", {name: "To Hex"});
        assert.strictEqual(info.isError, true);
        assert(info.content[0].text.includes("disabled"));

        const run = await callTool("bake", {
            input: "hi",
            recipe: [{op: "To Hex"}],
        });
        assert.strictEqual(run.isError, true);
        assert(run.content[0].text.includes("disabled"));
        // The failed attempt is recorded for the panel.
        assert(state.listRecords(1)[0].error.includes("disabled"));

        state.setOperationEnabled("To Hex", true);
        const ok = await callTool("bake", {input: "hi", recipe: [{op: "To Hex"}]});
        assert.strictEqual(ok.isError, undefined);
    }),

    it("mcp: magic filters candidates that use disabled operations", async () => {
        await setup();
        state.setOperationEnabled("From Base64", false);
        const res = await callTool("magic", {
            input: "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q=",
            depth: 1,
            limit: 30,
        });
        const payload = JSON.parse(res.content[0].text);
        assert(payload.results.every(r =>
            !r.recipe.some(step => step.op === "From Base64")));
        state.setOperationEnabled("From Base64", true);
    }),

    it("mcp: bulk disable empties the catalog, bulk enable restores it", async () => {
        await setup();
        state.setAllOperations(false, allOperationNames());
        const empty = await callTool("list_operations", {limit: 10});
        assert.strictEqual(JSON.parse(empty.content[0].text).total, 0);

        state.setAllOperations(true, allOperationNames());
        const full = await callTool("list_operations", {limit: 1});
        assert.strictEqual(JSON.parse(full.content[0].text).total, allOperationNames().length);
    }),

    it("mcp: calls are recorded with previews", async () => {
        await setup();
        await callTool("bake", {input: "record-me", recipe: [{op: "To Base64"}]});
        const records = state.listRecords(10);
        assert(records.length >= 1);
        const rec = records[0];
        assert.strictEqual(rec.tool, "bake");
        assert.strictEqual(rec.ok, true);
        assert(rec.argsPreview.includes("record-me"));
        assert(rec.outputPreview.includes("cmVjb3JkLW1l"));
        assert(fs.existsSync(path.join(stateDir, "records.json")));
    }),

    it("mcp: operation enablement persists across restarts", async () => {
        await setup();
        state.setOperationEnabled("To Hex", false);
        const reloaded = new McpState(stateDir);
        assert.strictEqual(reloaded.isOperationEnabled("To Hex"), false);
        assert.strictEqual(reloaded.isOperationEnabled("From Base64"), true);
        assert.strictEqual(reloaded.disabledCount(), 1);
    }),

    it("mcp: bulk setOperationsEnabled reports affected and no-ops", async () => {
        await setup();
        const names = ["To Hex", "From Hex", "To Base64"];
        // Baseline: tests share one state instance, normalise first.
        state.setOperationsEnabled(names, true);
        assert.strictEqual(state.setOperationsEnabled(names, false), 3);
        assert(!state.isOperationEnabled("To Hex"));
        assert(!state.isOperationEnabled("From Hex"));
        // Same batch again changes nothing.
        assert.strictEqual(state.setOperationsEnabled(names, false), 0);
        assert.strictEqual(state.setOperationsEnabled(["To Hex"], true), 1);
        state.setOperationsEnabled(names, true);
        assert(state.isOperationEnabled("From Hex"));
    }),

    it("mcp: McpToolError is exported for tool authors", async () => {
        await setup();
        assert(new McpToolError("x") instanceof Error);
    }),

    it("mcp: zh-TW names resolve and localise", async () => {
        await setup();
        const res = await callTool("get_operation", {name: "Base64 解碼"});
        const payload = JSON.parse(res.content[0].text);
        assert.strictEqual(payload.name, "From Base64");

        const tw = await callTool("list_operations", {query: "Base64 解碼", lang: "zh-TW", limit: 5});
        const list = JSON.parse(tw.content[0].text);
        assert(list.operations.some(o => o.name === "From Base64" && o.nameLocal === "Base64 解碼"));
    }),

    it("mcp: unsupported languages fall back, unknown lang defaults", async () => {
        await setup();
        const de = await callTool("get_operation", {name: "From Base64", lang: "de"});
        const payload = JSON.parse(de.content[0].text);
        assert.strictEqual(payload.name, "From Base64");
        // German has no descriptions yet: English source is served.
        assert(payload.description.includes("Base64"));
        assert.strictEqual(payload.nameLocal, undefined);

        const bogus = await callTool("list_operations", {lang: "xx-XX", limit: 1});
        assert.strictEqual(JSON.parse(bogus.content[0].text).total > 0, true);
    }),
]);
