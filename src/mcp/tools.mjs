/**
 * The four meta-tools exposed over MCP. They are always-on infrastructure
 * and cannot be disabled; what administrators toggle is the underlying
 * operation catalog (see buildOperationTree / McpState).
 *
 * Operations are NOT exposed one-by-one: agents would drown in 500+ tools.
 * Instead agents search the catalog (list_operations), inspect parameters
 * (get_operation), then execute (bake / magic). Disabled operations are
 * hidden from every tool in this layer.
 *
 * Layering: this module only consumes the Node API layer (src/node) and core
 * config data. The zh-CN dictionaries under src/web/i18n are plain data
 * assets shared with the web layer - importing them here does not couple the
 * server to browser code.
 *
 * @license Apache-2.0
 */

import chef, {bake} from "../node/index.mjs";
import Dish from "../core/Dish.mjs";
import OperationConfig from "../core/config/OperationConfig.json" with { type: "json" };
import Categories from "../core/config/Categories.json" with { type: "json" };
import {toHex} from "../core/lib/Hex.mjs";
import {toBase64} from "../core/lib/Base64.mjs";
import MagicLib from "../core/lib/Magic.mjs";
import {sentenceToCamelCase} from "../node/apiUtils.mjs";
import {LANGUAGES} from "../web/i18n/i18n.mjs";
import {McpToolError, LIMITS, sanitise} from "./toolUtils.mjs";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Language bundles are shared data assets with the web layer and are loaded
// lazily (one import per language, cached for the process lifetime).
const bundleCache = new Map();

/**
 * Loads the dictionary bundle for a language (null for English).
 *
 * @param {string} lang
 * @returns {Promise<Object|null>}
 */
async function getBundle(lang) {
    const supported = hasOwn(LANGUAGES, lang) && lang !== "en";
    if (!supported) return null;
    if (!bundleCache.has(lang)) {
        bundleCache.set(lang,
            import(`../web/i18n/languages/${lang}/index.mjs`).then(m => m.default));
    }
    return bundleCache.get(lang);
}

// Reverse lookups (localised operation name -> canonical English name) for
// every language that translates operation names, built once on first use.
let reverseMapsPromise = null;

/**
 *
 */
async function getReverseMaps() {
    if (!reverseMapsPromise) {
        reverseMapsPromise = (async () => {
            const maps = [];
            for (const code of Object.keys(LANGUAGES)) {
                if (code === "en") continue;
                const bundle = await getBundle(code).catch(() => null);
                if (!bundle || !bundle.operations) continue;
                const map = Object.create(null);
                for (const en in bundle.operations) {
                    const local = bundle.operations[en];
                    if (local && local !== en) map[local] = en;
                }
                maps.push(map);
            }
            return maps;
        })();
    }
    return reverseMapsPromise;
}

// Operation name -> category names containing it.
const opCategories = Object.create(null);
for (const cat of Categories) {
    for (const op of cat.ops) {
        if (!hasOwn(opCategories, op)) opCategories[op] = [];
        opCategories[op].push(cat.name);
    }
}

/**
 * Normalises a requested language: "en" is explicit English, anything not in
 * the registry falls back to the fork default.
 *
 * @param {string} lang
 * @returns {string}
 */
function requestedLang(lang) {
    if (lang === "en") return "en";
    return hasOwn(LANGUAGES, lang) ? lang : "zh-CN";
}

// Language codes accepted by the tools' `lang` parameters.
const LANG_ENUM = Object.keys(LANGUAGES);

/**
 * Resolve an operation name (English canonical, localised, case/space-
 * insensitive) to its canonical English name in the config.
 *
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function resolveOpName(name) {
    const wanted = sanitise(name);
    if (hasOwn(OperationConfig, name)) return name;
    for (const opName of Object.keys(OperationConfig)) {
        if (sanitise(opName) === wanted) return opName;
    }
    const maps = await getReverseMaps();
    for (const map of maps) {
        if (hasOwn(map, name)) return map[name];
    }
    return null;
}

/**
 * Localised description: plain text, HTML tags stripped. `bundle` may be
 * null (English) or a language bundle without an entry for this operation -
 * both fall back to the English source.
 *
 * @param {string} opName
 * @param {Object|null} bundle
 * @returns {string}
 */
function localDescription(opName, bundle) {
    const local = bundle?.descriptions?.[opName];
    const raw = (typeof local === "string" && local.length) ?
        local : OperationConfig[opName].description;
    return raw.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim();
}

/**
 * Normalise an OperationConfig arg entry into a predictable shape for agents.
 *
 * @param {Object} arg
 * @param {Object|null} bundle - language bundle for localised labels
 * @returns {Object}
 */
function describeArg(arg, bundle) {
    const localName = bundle?.args?.[arg.name];
    const out = {
        name: arg.name,
        nameLocal: (typeof localName === "string" && localName.length) ? localName : undefined,
        type: arg.type,
    };
    const subheads = (list) => list.filter(v => typeof v === "object" && v !== null);

    if (arg.type === "option" || arg.type === "editableOption") {
        const options = subheads(arg.value).map(v => ({name: v.name, value: v.value}));
        if (options.length) {
            out.options = options;
            out.default = options[arg.defaultIndex ?? 0]?.value;
        } else {
            out.default = arg.value;
        }
    } else if (arg.type === "toggleString") {
        out.default = arg.value ?? "";
        out.toggleOptions = (arg.toggleValues || []).filter(v => typeof v === "object");
        out.defaultToggled = out.toggleOptions[0];
        out.valueForm = 'string | {"string": "...", "option": "' + (arg.toggleValues?.[0] ?? "Hex") + '"} | ["value", "format"]';
    } else {
        out.default = arg.value;
    }
    return out;
}

/**
 * Convert a NodeDish to the requested wire format.
 *
 * @param {import("../node/NodeDish.mjs").default} dish
 * @param {string} outputType - "string" | "byteArray" | "hex" | "base64"
 * @returns {string|number[]}
 */
function serialiseDish(dish, outputType) {
    switch (outputType) {
        case "byteArray": {
            return dish.get(Dish.typeEnum("byteArray"));
        }
        case "hex": {
            const bytes = dish.get(Dish.typeEnum("byteArray"));
            return toHex(bytes, "");
        }
        case "base64": {
            const bytes = dish.get(Dish.typeEnum("byteArray"));
            return toBase64(bytes);
        }
        default:
            return String(dish.get(Dish.typeEnum("string")));
    }
}

/**
 * Decode a Magic result sample (string or ArrayBuffer) to printable text.
 *
 * @param {string|ArrayBuffer} data
 * @param {number} max
 * @returns {string}
 */
function sampleToText(data, max = 120) {
    if (!data) return "";
    let text;
    if (typeof data === "string") {
        text = data;
    } else {
        const bytes = new Uint8Array(data).slice(0, max);
        text = new TextDecoder("utf8", {fatal: false}).decode(bytes);
    }

    return text.slice(0, max).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ".");
}

/**
 * Enforce the shared input size limit.
 *
 * @param {string} input
 */
function checkInputSize(input) {
    const size = typeof input === "string" ? input.length :
        Array.isArray(input) ? input.length : 0;
    if (size > LIMITS.maxInputChars) {
        throw new McpToolError(
            `Input too large: ${size} chars/bytes (limit ${LIMITS.maxInputChars}).`
        );
    }
}

/**
 * Resolve + enablement-check one recipe step.
 *
 * @param {Object} step
 * @param {Object} ctx - {isOperationEnabled}
 * @returns {Promise<string>} canonical op name
 */
async function resolveEnabledStep(step, ctx) {
    if (!step || typeof step.op !== "string") {
        throw new McpToolError(`Invalid recipe step: ${JSON.stringify(step)}`);
    }
    const opName = await resolveOpName(step.op);
    if (!opName) {
        throw new McpToolError(`Unknown operation in recipe: ${step.op}`);
    }
    if (ctx.isOperationEnabled && !ctx.isOperationEnabled(opName)) {
        throw new McpToolError(`Operation disabled by administrator: ${opName}`);
    }
    return opName;
}

// ─── Tool implementations ───────────────────────────────────────────────────

/**
 *
 */
async function runListOperations(args, ctx) {
    const lang = requestedLang(args.lang);
    const bundle = await getBundle(lang);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), LIMITS.maxListResults);
    const query = args.query ? sanitise(args.query) : null;

    const matches = [];
    for (const opName of Object.keys(OperationConfig)) {
        if (ctx.isOperationEnabled && !ctx.isOperationEnabled(opName)) {
            continue;
        }
        const localName = bundle?.operations?.[opName] || "";
        if (query) {
            const enDesc = OperationConfig[opName].description;
            if (!sanitise(opName).includes(query) &&
                !sanitise(enDesc).includes(query) &&
                !(localName && localName.includes(args.query))) {
                continue;
            }
        }
        if (args.category &&
            !(opCategories[opName] || []).some(c =>
                sanitise(c) === sanitise(args.category) ||
                bundle?.categories?.[c] === args.category)) {
            continue;
        }
        matches.push({
            name: opName,
            nameLocal: localName || undefined,
            description: localDescription(opName, bundle),
            inputType: OperationConfig[opName].inputType,
            outputType: OperationConfig[opName].outputType,
        });
    }

    const result = {
        total: matches.length,
        returned: Math.min(matches.length, limit),
        operations: matches.slice(0, limit),
    };

    // A category filter that matches nothing is almost always a near-miss
    // name ("Encryption" for "Encryption / Encoding"). Returning the real
    // categories — near matches first, with localised names and op counts —
    // costs one field and saves the caller the discovery detour of an
    // unfiltered listing.
    if (args.category && matches.length === 0) {
        const wanted = sanitise(args.category);
        result.categoryHint = Categories
            .filter(cat => (cat.ops || []).length > 0)
            .map(cat => ({
                name: cat.name,
                nameLocal: bundle?.categories?.[cat.name] || undefined,
                ops: cat.ops.length,
                close: sanitise(cat.name).includes(wanted) || wanted.includes(sanitise(cat.name)),
            }))
            .sort((a, b) => Number(b.close) - Number(a.close) || a.name.localeCompare(b.name));
    }
    return result;
}

/**
 *
 */
async function runGetOperation(args, ctx) {
    const lang = requestedLang(args.lang);
    const bundle = await getBundle(lang);
    const opName = await resolveOpName(args.name || "");
    if (!opName || !hasOwn(OperationConfig, opName)) {
        throw new McpToolError(`Unknown operation: ${args.name}`);
    }
    if (ctx.isOperationEnabled && !ctx.isOperationEnabled(opName)) {
        throw new McpToolError(`Operation disabled by administrator: ${opName}`);
    }
    const conf = OperationConfig[opName];
    const nodeSupported = typeof chef[sentenceToCamelCase(opName)] === "function";
    const localName = bundle?.operations?.[opName];

    return {
        name: opName,
        nameLocal: (typeof localName === "string" && localName.length) ? localName : undefined,
        description: localDescription(opName, bundle),
        infoURL: conf.infoURL || undefined,
        inputType: conf.inputType,
        outputType: conf.outputType,
        flowControl: conf.flowControl,
        nodeSupported,
        categories: opCategories[opName] || [],
        args: (conf.args || []).map(arg => describeArg(arg, bundle)),
    };
}

/**
 *
 */
async function runBake(args, ctx) {
    if (typeof args.input !== "string" && !Array.isArray(args.input)) {
        throw new McpToolError("Parameter 'input' is required (string, or byteArray as number[]).");
    }
    checkInputSize(args.input);
    if (!Array.isArray(args.recipe)) {
        // An empty array is allowed: it returns the input unchanged, which
        // combined with outputType is useful for plain format conversion.
        throw new McpToolError("Parameter 'recipe' is required: [{op: \"Operation Name\", args: {...}}].");
    }
    if (args.recipe.length > LIMITS.maxRecipeOps) {
        throw new McpToolError(`Recipe too long: ${args.recipe.length} ops (limit ${LIMITS.maxRecipeOps}).`);
    }
    // Resolve (and enablement-check) every step before executing anything.
    const canonical = [];
    for (const step of args.recipe) {
        canonical.push(await resolveEnabledStep(step, ctx));
    }

    const outputType = ["byteArray", "hex", "base64"].includes(args.outputType) ?
        args.outputType : "string";

    // NodeRecipe accepts op names and {op, args} objects; args may be the
    // positional value array (as returned by magic) or an object keyed by
    // argument name (case/space-insensitive).
    const recipe = args.recipe.map((step, i) =>
        step.args === undefined ? canonical[i] : {op: canonical[i], args: step.args});

    let dish;
    try {
        dish = await bake(args.input, recipe);
    } catch (err) {
        if (err && (err.type === "OperationError" || err.type === "ExcludedOperationError" ||
                    err.type === "DishError")) {
            throw new McpToolError(`${err.type}: ${err.message}`);
        }
        // TypeError from NodeRecipe etc.
        throw new McpToolError(err.message || String(err));
    }

    let output = serialiseDish(dish, outputType);
    const serialized = typeof output === "string" ? output : output.join(",");
    let truncated = false;
    if (serialized.length > LIMITS.maxOutputChars) {
        output = output.slice(0, LIMITS.maxOutputChars);
        truncated = true;
    }

    return {
        output,
        outputType,
        truncated,
        length: serialized.length,
    };
}

/**
 *
 */
async function runMagic(args, ctx) {
    if (typeof args.input !== "string" && !Array.isArray(args.input)) {
        throw new McpToolError("Parameter 'input' is required.");
    }
    checkInputSize(args.input);
    const depth = Math.min(Math.max(args.depth ?? 3, 1), 7);
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 30);
    const magicArgs = {
        depth,
        intensiveMode: !!args.intensive,
        extensiveLanguageSupport: !!args.extensiveLanguageSupport,
    };
    if (args.crib) magicArgs.crib = args.crib;

    let dish;
    try {
        dish = await chef.magic(args.input, magicArgs);
    } catch (err) {
        throw new McpToolError(err.message || String(err));
    }

    const options = dish.get(Dish.typeEnum("json")) || [];
    const results = [];
    for (const option of options) {
        // Drop candidates whose recipe uses a disabled operation.
        const usesDisabled = (option.recipe || []).some(step =>
            ctx.isOperationEnabled && !ctx.isOperationEnabled(step.op));
        if (usesDisabled) continue;

        results.push({
            recipe: option.recipe,
            sample: sampleToText(option.data),
            entropy: option.entropy,
            isUTF8: option.isUTF8,
            language: option.languageScores?.length && option.languageScores[0].probability > 0 ?
                MagicLib.codeToLanguage(option.languageScores[0].lang) : undefined,
            fileType: option.fileType ? `${option.fileType.mime} (${option.fileType.ext})` : undefined,
            useful: option.useful || undefined,
            resultLength: option.resultLength,
        });
        if (results.length >= limit) break;
    }

    return {
        total: options.length,
        returned: results.length,
        results,
    };
}

/**
 * Build the category/operation tree for the management API and panel.
 * Note: operations can appear in multiple categories; `enabled` counts
 * unique enabled operations across the whole catalog.
 *
 * @param {import("./state.mjs").default} state
 * @param {string} [lang] - language for nameLocal fields, default zh-CN
 * @returns {Promise<{categories: Object[], total: number, enabled: number}>}
 */
export async function buildOperationTree(state, lang = "zh-CN") {
    const bundle = await getBundle(requestedLang(lang));
    const all = allOperationNames();
    const enabled = all.filter(op => state.isOperationEnabled(op)).length;
    const categories = Categories
        .filter(cat => cat.name !== "Favourites")
        .map(cat => ({
            name: cat.name,
            nameLocal: bundle?.categories?.[cat.name] || undefined,
            ops: cat.ops
                .filter(op => hasOwn(OperationConfig, op))
                .map(op => ({
                    name: op,
                    nameLocal: bundle?.operations?.[op] || undefined,
                    enabled: state.isOperationEnabled(op),
                })),
        }))
        .filter(cat => cat.ops.length > 0);

    return {categories, total: all.length, enabled};
}

/**
 * All canonical operation names (for bulk disable).
 *
 * @returns {string[]}
 */
export function allOperationNames() {
    return Object.keys(OperationConfig);
}

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * Tool definitions consumed by the server. `run` never sees transport
 * details; the dispatcher passes a context with the operation-enablement
 * check.
 */
const TOOLS = [
    {
        name: "list_operations",
        description: "搜索 CyberChef 操作目录(多语言)。按名称或描述关键词、分类过滤,返回操作名/" +
            "中文名/描述/输入输出类型。用 get_operation 查看某个操作的完整参数。被停用的操作不会出现。",
        inputSchema: {
            type: "object",
            properties: {
                query: {type: "string", description: "关键词,匹配操作名(中/英)或描述"},
                category: {type: "string", description: "按分类过滤,如 'Data format'"},
                limit: {type: "number", description: "返回条数,默认 50,最大 200"},
                lang: {type: "string", enum: LANG_ENUM, description: "描述语言,默认 zh-CN"},
            },
        },
        run: runListOperations,
    },
    {
        name: "get_operation",
        description: "查看一个 CyberChef 操作的完整说明:描述、每个参数的类型/默认值/可选值、" +
            "输入输出类型。args 对象按参数名传给 bake(大小写与空格不敏感)。操作名支持中文。",
        inputSchema: {
            type: "object",
            properties: {
                name: {type: "string", description: "操作名(英文或中文),如 'From Base64'"},
                lang: {type: "string", enum: LANG_ENUM, description: "描述语言,默认 zh-CN"},
            },
            required: ["name"],
        },
        run: runGetOperation,
    },
    {
        name: "bake",
        description: "按配方执行 CyberChef 操作链。recipe 为数组,每项 {op: 操作名, args: {参数名: 值}};" +
            "args 省略时使用默认参数。输出类型可选 string/byteArray/hex/base64,超长输出会被截断并标记 truncated。",
        inputSchema: {
            type: "object",
            properties: {
                input: {type: ["string", "array"], description: "输入:字符串,或字节数组(number[])"},
                inputType: {type: "string", enum: ["string", "byteArray"], description: "默认 string"},
                recipe: {
                    type: "array",
                    maxItems: 50,
                    items: {
                        type: "object",
                        properties: {
                            op: {type: "string"},
                            args: {type: ["object", "array"], description: "按参数名传值；toggleString 参数(如 AES 的 Key/IV)的值用 {\"string\",\"option\"} 对象或 [值, 格式] 数组；也接受 magic 返回的顺序数组"},
                        },
                        required: ["op"],
                    },
                },
                outputType: {type: "string", enum: ["string", "byteArray", "hex", "base64"], description: "默认 string"},
            },
            required: ["input", "recipe"],
        },
        run: runBake,
    },
    {
        name: "magic",
        description: "自动探测编码/加密:对输入做启发式分析,返回候选配方(可直接作为 bake 的 recipe)、" +
            "样本片段、熵值、可能语言/文件类型。面对未知数据先用这个。含被停用操作的候选会被过滤。",
        inputSchema: {
            type: "object",
            properties: {
                input: {type: ["string", "array"], description: "输入:字符串,或字节数组(number[])"},
                depth: {type: "number", description: "探测深度 1-7,默认 3"},
                intensive: {type: "boolean", description: "高强度语言分析,较慢,默认 false"},
                extensiveLanguageSupport: {type: "boolean", description: "扩展语言支持,默认 false"},
                crib: {type: "string", description: "已知明文(字符串或正则),过滤结果"},
                limit: {type: "number", description: "返回候选数,默认 10,最大 30"},
            },
            required: ["input"],
        },
        run: runMagic,
    },
];

export default TOOLS;
export {McpToolError, resolveOpName as resolveOperationName};
