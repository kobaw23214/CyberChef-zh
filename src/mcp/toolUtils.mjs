/**
 * Shared helpers for the MCP tool layer.
 *
 * @license Apache-2.0
 */

/**
 * Limits guarding the MCP surface against resource exhaustion. Overridable
 * via environment variables for trusted environments.
 */
const LIMITS = {
    maxInputChars: Number(process.env.MCP_MAX_INPUT ?? 10 * 1024 * 1024),
    maxOutputChars: Number(process.env.MCP_MAX_OUTPUT ?? 256 * 1024),
    maxRecipeOps: 50,
    maxListResults: 200,
    callTimeoutMs: Number(process.env.MCP_TIMEOUT_MS ?? 30_000),
};

/**
 * Error thrown by tools for expected failures (bad arguments, operation
 * errors). The dispatcher converts these into MCP tool errors.
 */
class McpToolError extends Error {
    /**
     *
     */
    constructor(message) {
        super(message);
        this.name = "McpToolError";
    }
}

/**
 * Lowercase and strip spaces for case/space-insensitive matching
 * (same policy as the Node API's arg name matching).
 *
 * @param {string} str
 * @returns {string}
 */
function sanitise(str) {
    return String(str).toLowerCase().replace(/ /g, "");
}

export {LIMITS, McpToolError, sanitise};
