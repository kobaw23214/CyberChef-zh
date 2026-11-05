/**
 * Runtime state for the MCP server layer: operation enablement and call
 * records.
 *
 * The four MCP meta-tools (list_operations, get_operation, bake, magic) are
 * always-on infrastructure; what administrators toggle here are the 505
 * CyberChef operations exposed to agents. Disabled operations are hidden
 * from list_operations/get_operation/magic and rejected in bake.
 *
 * The web management panel reads and writes this state over the HTTP
 * management API - the web layer never imports the MCP server directly.
 *
 * State is persisted as two JSON files under the state directory (defaults to
 * `.mcp-state/` in the repository root, override with the MCP_STATE_DIR
 * environment variable, e.g. a mounted volume in Docker):
 *   - operations.json  sparse map of DISABLED operation names
 *   - records.json     ring buffer of the most recent calls
 *
 * @license Apache-2.0
 */

import fs from "fs";
import path from "path";

const MAX_RECORDS = 500;
const PREVIEW_BYTES = 512;

/**
 * Truncate a value to a short, human-readable preview for the call log.
 *
 * @param {*} value
 * @returns {string}
 */
function preview(value) {
    let text;
    if (typeof value === "string") {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch (err) {
            text = String(value);
        }
    }
    if (text.length > PREVIEW_BYTES) {
        return text.slice(0, PREVIEW_BYTES) + `…(${text.length} chars)`;
    }
    return text;
}

/**
 *
 */
class McpState {

    /**
     * @param {string} stateDir - directory for persisted state
     */
    constructor(stateDir) {
        this.stateDir = stateDir;
        this.operationsFile = path.join(stateDir, "operations.json");
        this.recordsFile = path.join(stateDir, "records.json");
        // Sparse set of disabled operation names; everything else is enabled.
        this.disabledOperations = new Set();
        this.records = [];
        this.recordSeq = 0;

        this.load();
    }

    /**
     *
     */
    load() {
        fs.mkdirSync(this.stateDir, {recursive: true});
        try {
            if (fs.existsSync(this.operationsFile)) {
                const saved = JSON.parse(fs.readFileSync(this.operationsFile, "utf8"));
                if (saved && Array.isArray(saved.disabled)) {
                    this.disabledOperations = new Set(saved.disabled);
                }
            }
        } catch (err) {
            // Corrupt state falls back to defaults rather than refusing to boot.
        }
        try {
            if (fs.existsSync(this.recordsFile)) {
                const saved = JSON.parse(fs.readFileSync(this.recordsFile, "utf8"));
                if (Array.isArray(saved)) {
                    this.records = saved.slice(-MAX_RECORDS);
                    this.recordSeq = this.records.length ?
                        this.records[this.records.length - 1].id : 0;
                }
            }
        } catch (err) {
            // Same policy as above.
        }
    }

    /**
     *
     */
    persistOperations() {
        fs.mkdirSync(this.stateDir, {recursive: true});
        fs.writeFileSync(this.operationsFile, JSON.stringify({
            disabled: [...this.disabledOperations],
        }, null, 2));
    }

    /**
     *
     */
    persistRecords() {
        fs.writeFileSync(this.recordsFile, JSON.stringify(this.records));
    }

    /**
     * @param {string} opName
     * @returns {boolean}
     */
    isOperationEnabled(opName) {
        return !this.disabledOperations.has(opName);
    }

    /**
     * @param {string} opName
     * @param {boolean} on
     */
    setOperationEnabled(opName, on) {
        if (on) {
            this.disabledOperations.delete(opName);
        } else {
            this.disabledOperations.add(opName);
        }
        this.persistOperations();
    }

    /**
     * Bulk enable/disable a named set of operations (panel category
     * checkboxes). Persists once for the whole batch.
     *
     * @param {string[]} opNames
     * @param {boolean} on
     * @returns {number} affected operations
     */
    setOperationsEnabled(opNames, on) {
        let affected = 0;
        for (const name of opNames) {
            if (on) {
                if (this.disabledOperations.delete(name)) affected++;
            } else {
                if (!this.disabledOperations.has(name)) affected++;
                this.disabledOperations.add(name);
            }
        }
        if (affected) this.persistOperations();
        return affected;
    }

    /**
     * Bulk enable/disable (panel "enable all" / "disable all").
     *
     * @param {boolean} on
     * @param {string[]} [allOpNames] - full catalog, stored when disabling all
     */
    setAllOperations(on, allOpNames = []) {
        if (on) {
            this.disabledOperations = new Set();
        } else {
            this.disabledOperations = new Set(allOpNames);
        }
        this.persistOperations();
    }

    /**
     * @returns {number}
     */
    disabledCount() {
        return this.disabledOperations.size;
    }

    /**
     * Append a call record. The input/output are stored as previews only.
     *
     * @param {Object} entry - {tool, args, ok, durationMs, result?, error?}
     * @returns {Object} the stored record
     */
    record(entry) {
        const rec = {
            id: ++this.recordSeq,
            ts: new Date().toISOString(),
            tool: entry.tool,
            ok: !!entry.ok,
            durationMs: entry.durationMs ?? 0,
            argsPreview: preview(entry.args ?? ""),
            outputPreview: entry.ok ? preview(entry.result ?? "") : undefined,
            error: entry.ok ? undefined : String(entry.error ?? "unknown error"),
        };
        this.records.push(rec);
        if (this.records.length > MAX_RECORDS) {
            this.records.splice(0, this.records.length - MAX_RECORDS);
        }
        this.persistRecords();
        return rec;
    }

    /**
     * @param {number} limit
     * @returns {Object[]} newest first
     */
    listRecords(limit = 100) {
        return this.records.slice(-limit).reverse();
    }

    /**
     *
     */
    clearRecords() {
        this.records = [];
        this.recordSeq = 0;
        this.persistRecords();
    }
}

export default McpState;
