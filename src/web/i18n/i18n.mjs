/**
 * Multi-language localisation layer for the web UI.
 *
 * Languages live under `languages/<code>/` as self-contained bundles
 * (dictionaries plus a few runtime patterns). Bundles are loaded lazily via
 * dynamic import, so each language is a separate webpack chunk and only the
 * selected language is downloaded. "en" is the source language and has no
 * bundle: every dictionary lookup falls back to the English source whenever
 * a language has no entry for a key, so dictionaries can be filled in
 * incrementally.
 *
 * Operation names, category names and argument names double as identifiers
 * throughout the app (recipe configs, favourites, drag and drop), so the
 * English source values are preserved and translated display values are
 * attached alongside them (`display` fields) before the configs reach the
 * rest of the UI.
 *
 * @license Apache-2.0
 */

export const LANGUAGES = {
    "zh-CN": {name: "中文(简体)", moment: "zh-cn"},
    "zh-TW": {name: "中文(繁體)", moment: "zh-tw"},
    "ja":    {name: "日本語", moment: "ja"},
    "ko":    {name: "한국어", moment: "ko"},
    "de":    {name: "Deutsch", moment: "de"},
    "fr":    {name: "Français", moment: "fr"},
    "es":    {name: "Español", moment: "es"},
    "en":    {name: "English", moment: "en"},
};

const DEFAULT_LANGUAGE = "zh-CN";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

let language = DEFAULT_LANGUAGE;
let bundle = null;               // active language bundle (null = English fallback)
let uiMap = Object.create(null);
let prefixRules = [];

// Resolved bundles by language code; loaded exactly once per session.
const bundleCache = new Map();

/**
 * Maps any input to a supported language code.
 *
 * @param {string} lang
 * @returns {string}
 */
export function normaliseLang(lang) {
    return hasOwn(LANGUAGES, lang) ? lang : DEFAULT_LANGUAGE;
}

/**
 * Loads a language bundle (cached) and activates it when it is also the
 * currently selected language. English needs no bundle.
 *
 * @param {string} lang
 * @returns {Promise<Object|null>} the bundle, or null for English
 */
export async function loadLanguage(lang) {
    const code = normaliseLang(lang);
    if (code === "en") {
        if (language === "en") {
            bundle = null;
            rebuildLookup();
        }
        return null;
    }
    if (!bundleCache.has(code)) {
        bundleCache.set(code,
            import(`./languages/${code}/index.mjs`).then(m => m.default));
    }
    const loadedBundle = await bundleCache.get(code);
    if (language === code) {
        bundle = loadedBundle;
        rebuildLookup();
    }
    return loadedBundle;
}

/**
 * Sets the active UI language. Call `loadLanguage` afterwards (e.g. before
 * the first render) so lookups hit the bundle instead of the fallback.
 *
 * @param {string} lang - a key of LANGUAGES; unknown codes fall back to the
 * default language
 */
export function setLanguage(lang) {
    language = normaliseLang(lang);
    bundle = null;
    rebuildLookup();
}

/**
 * The active UI language code.
 *
 * @returns {string}
 */
export function getLanguage() {
    return language;
}

/**
 * Legacy helper: whether the UI is displayed in Simplified Chinese.
 * Prefer language-neutral lookups (`t*`, `formatPattern`) in new code.
 *
 * @returns {boolean}
 */
export function isZh() {
    return language === "zh-CN";
}

/**
 * The moment.js locale code for a language.
 *
 * @param {string} [lang] - defaults to the active language
 * @returns {string}
 */
export function momentLocale(lang = language) {
    return LANGUAGES[normaliseLang(lang)].moment;
}

/**
 * Rebuilds the whole-string and prefix lookup tables from the bundle.
 */
function rebuildLookup() {
    uiMap = Object.create(null);
    prefixRules = [];
    if (bundle && bundle.ui) {
        for (const k in bundle.ui) {
            const nk = normalize(k);
            const prev = uiMap[nk];
            // Whitespace-variant keys ("Options" vs "Options ") normalise to
            // the same entry; keep the first mapping when the values only
            // differ cosmetically.
            if (prev !== undefined && prev.trim() === bundle.ui[k].trim()) continue;
            uiMap[nk] = bundle.ui[k];
        }
    }
    if (bundle && Array.isArray(bundle.prefixRules)) {
        prefixRules = bundle.prefixRules;
    }
}

// Empty values fall back to the English source so that the dictionaries can
// be filled in incrementally. Without an active bundle everything falls back.
const lookup = (dict, key, fallback) => {
    if (!bundle || !dict) return fallback;
    const v = hasOwn(dict, key) ? dict[key] : undefined;
    return (typeof v === "string" && v.length) ? v : fallback;
};

/**
 * Translates an operation name for display.
 *
 * @param {string} name
 * @returns {string}
 */
export function tOperation(name) {
    return lookup(bundle?.operations, name, name);
}

/**
 * Returns the localised description for an operation, or the English fallback.
 *
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
export function tDescription(name, fallback) {
    return lookup(bundle?.descriptions, name, fallback);
}

/**
 * Translates an argument label or hint for display.
 *
 * @param {string} name
 * @returns {string}
 */
export function tArg(name) {
    return lookup(bundle?.args, name, name);
}

/**
 * Whether a dropdown option label has a translation in the active language.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function hasOption(name) {
    if (!bundle) return false;
    const v = hasOwn(bundle.options || {}, name) ? bundle.options[name] : undefined;
    return typeof v === "string" && v.length > 0;
}

/**
 * Translates a dropdown option label for display. Option labels double as
 * argument values for plain `option` args and toggle strings, so renderers
 * must keep the English value alongside the translated label.
 *
 * @param {string} name
 * @returns {string}
 */
export function tOption(name) {
    return lookup(bundle?.options, name, name);
}

/**
 * Translates a category name for display.
 *
 * @param {string} name
 * @returns {string}
 */
export function tCategory(name) {
    return lookup(bundle?.categories, name, name);
}

/**
 * Translates a static UI string (button labels, messages, tooltips).
 *
 * @param {string} text
 * @returns {string}
 */
export function tUI(text) {
    const hit = uiMap[normalize(text)];
    if (typeof hit === "string" && hit.length) return hit;
    for (const [re, replacement] of prefixRules) {
        if (re.test(text)) return text.replace(re, replacement);
    }
    return text;
}

/**
 * Formats a runtime pattern from the active language bundle. Patterns are
 * short templates with `{placeholder}` holes defined per language (for
 * example `"{n} 个字符)"`); unknown patterns in the active language fall
 * back to English wording supplied by the caller.
 *
 * @param {string} name - pattern key, e.g. "detected"
 * @param {Object} [params] - placeholder values
 * @param {string} [fallback] - English wording when the pattern is missing
 * @returns {string}
 */
export function formatPattern(name, params = {}, fallback = "") {
    const pattern = bundle?.patterns?.[name];
    let out = (typeof pattern === "string" && pattern.length) ? pattern : fallback;
    for (const key in params) {
        out = out.split(`{${key}}`).join(String(params[key]));
    }
    return out;
}

/**
 * The runtime pattern set of the active language (may be empty).
 *
 * @returns {Object}
 */
export function getPatterns() {
    return (bundle && bundle.patterns) || {};
}

const normalize = s => s.replace(/\s+/g, " ").trim();

const TRANSLATABLE_ATTRS = ["title", "placeholder", "aria-label", "data-help-title", "data-help", "data-content", "data-original-title"];

/**
 * Translates the static page chrome in place: text nodes and translatable
 * attributes are matched (whitespace-normalised, whole-string) against the
 * ui dictionary. Material icon ligature text is skipped so that icon buttons
 * are never disturbed. No-op when English is selected.
 *
 * @param {Element} [root]
 */
export function applyStaticTranslations(root = document) {
    if (language === "en") {
        document.documentElement.lang = "en";
        return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        // Material icons render through their text content (ligatures);
        // translating them would break the icon.
        if (node.parentElement?.closest(".material-icons")) continue;

        const raw = node.nodeValue;
        const trimmed = raw.trim();
        if (!trimmed) continue;

        const hit = uiMap[normalize(trimmed)];
        if (typeof hit === "string" && hit.length) {
            node.nodeValue = raw.replace(trimmed, hit);
            continue;
        }
        for (const [re, replacement] of prefixRules) {
            if (re.test(trimmed)) {
                node.nodeValue = raw.replace(trimmed, trimmed.replace(re, replacement));
                break;
            }
        }
    }

    root.querySelectorAll("*").forEach(el => {
        for (const attr of TRANSLATABLE_ATTRS) {
            if (!el.hasAttribute(attr)) continue;
            const hit = uiMap[normalize(el.getAttribute(attr))];
            if (typeof hit === "string" && hit.length) {
                el.setAttribute(attr, hit);
            }
        }
    });

    document.documentElement.lang = language;
}

/**
 * Attaches localised display names to category configs.
 *
 * @param {CatConf[]} categories
 * @returns {CatConf[]}
 */
export function decorateCategories(categories) {
    return categories.map(c => ({...c, display: tCategory(c.name)}));
}

/**
 * Attaches localised display names, descriptions and argument labels to
 * operation configs. English identifiers are left untouched.
 *
 * @param {Object.<string, OpConf>} operations
 * @returns {Object.<string, OpConf>}
 */
export function decorateOperations(operations) {
    const decorated = Object.create(null);

    for (const name in operations) {
        const config = operations[name];
        decorated[name] = {
            ...config,
            display: tOperation(name),
            description: tDescription(name, config.description),
            args: config.args.map(decorateArg)
        };
    }

    return decorated;
}

/**
 * Attaches display labels to a single argument config.
 *
 * Item lists ({name, value} etc.) carry semantic values in `value`; only the
 * item labels are translated. Plain string lists (`option` args and toggle
 * values) are translated at render time so that the English value survives
 * in the DOM as the argument value.
 *
 * @param {Object} arg
 * @returns {Object}
 */
function decorateArg(arg) {
    const out = {...arg, display: tArg(arg.name)};
    if (arg.hint) {
        out.hint = tArg(arg.hint);
    }

    if (Array.isArray(arg.value) && arg.value.length &&
        typeof arg.value[0] === "object" && arg.value[0] !== null &&
        Object.prototype.hasOwnProperty.call(arg.value[0], "name")) {
        out.value = arg.value.map(item =>
            (item && Object.prototype.hasOwnProperty.call(item, "name")) ? {...item, name: tOption(item.name)} : item
        );
    }

    return out;
}
