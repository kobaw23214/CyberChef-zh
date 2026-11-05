/**
 * Multi-language i18n core tests: registry, lazy loading, per-key English
 * fallback and runtime patterns.
 *
 * @license Apache-2.0
 */

/* eslint no-console: 0 */

import assert from "assert";
import it from "../assertionHandler.mjs";
import TestRegister from "../../lib/TestRegister.mjs";
import {
    LANGUAGES,
    setLanguage,
    getLanguage,
    loadLanguage,
    momentLocale,
    tUI,
    tOperation,
    tCategory,
    formatPattern,
} from "../../../src/web/i18n/i18n.mjs";

/**
 *
 */
async function use(lang) {
    setLanguage(lang);
    await loadLanguage(lang);
}

TestRegister.addApiTests([

    it("i18n: registry covers all supported languages", async () => {
        assert.strictEqual(Object.keys(LANGUAGES).length, 8);
        assert.deepStrictEqual(
            Object.keys(LANGUAGES).sort(),
            ["de", "en", "es", "fr", "ja", "ko", "zh-CN", "zh-TW"]);
        for (const code in LANGUAGES) {
            assert(LANGUAGES[code].name.length > 0);
            assert(LANGUAGES[code].moment.length > 0);
        }
    }),

    it("i18n: unknown language codes normalise to the default", async () => {
        setLanguage("xx-XX");
        assert.strictEqual(getLanguage(), "zh-CN");
        assert.strictEqual(momentLocale(), "zh-cn");
    }),

    it("i18n: zh-CN full bundle lookups", async () => {
        await use("zh-CN");
        assert.strictEqual(tUI("Options"), "选项");
        assert.strictEqual(tOperation("From Base64"), "Base64 解码");
        assert.strictEqual(tCategory("Utils"), "实用工具");
        assert.strictEqual(formatPattern("detected", {}, " (detected)"), "(已检测)");
        assert.strictEqual(formatPattern("selectedSuffix", {}, " selected)"), " 个字符)");
    }),

    it("i18n: zh-TW full chrome and operation names", async () => {
        await use("zh-TW");
        assert.strictEqual(tUI("Options"), "選項");
        assert.strictEqual(tOperation("From Base64"), "Base64 解碼");
        assert.strictEqual(tOperation("Regular expression"), "正規表示式");
        assert.strictEqual(tCategory("Utils"), "公用程式");
        assert.strictEqual(momentLocale(), "zh-tw");
    }),

    it("i18n: ja/ko/de/fr/es translate the chrome", async () => {
        await use("ja");
        assert.strictEqual(tUI("Options"), "オプション");
        assert.strictEqual(tUI("MCP Management"), "MCP 管理");
        assert.strictEqual(formatPattern("detected", {}, " (detected)"), "(検出済み)");

        await use("ko");
        assert.strictEqual(tUI("Options"), "옵션");
        assert.strictEqual(tUI("Enable all"), "모두 활성화");

        await use("de");
        assert.strictEqual(tUI("Options"), "Optionen");
        assert.strictEqual(tUI("Baking time"), "Backzeit");
        assert.strictEqual(formatPattern("detected", {}, " (detected)"), "(erkannt)");

        await use("fr");
        assert.strictEqual(tUI("Options"), "Options");
        assert.strictEqual(tUI("Clear"), "Vider");

        await use("es");
        assert.strictEqual(tUI("Options"), "Opciones");
        assert.strictEqual(tUI("Connected"), "Conectado");
    }),

    it("i18n: missing keys fall back to the English source", async () => {
        await use("de");
        // Long help paragraphs are intentionally untranslated in v1.
        assert.strictEqual(tUI("This string does not exist"), "This string does not exist");
        // German has no operation dictionary yet.
        assert.strictEqual(tOperation("From Base64"), "From Base64");
        assert.strictEqual(tCategory("Data format"), "Datenformat");
    }),

    it("i18n: English bypasses bundles entirely", async () => {
        await use("en");
        assert.strictEqual(tUI("Options"), "Options");
        assert.strictEqual(tOperation("From Base64"), "From Base64");
        assert.strictEqual(momentLocale(), "en");
        assert.strictEqual(formatPattern("detected", {}, " (detected)"), " (detected)");
    }),

    it("i18n: switching languages switches lookups", async () => {
        await use("zh-CN");
        assert.strictEqual(tUI("Close"), "关闭");
        await use("ja");
        assert.strictEqual(tUI("Close"), "閉じる");
        await use("zh-CN");
        assert.strictEqual(tUI("Close"), "关闭");
    }),

]);
