/**
 * ko language bundle.
 *
 * UI chrome and categories fully translated. Operation descriptions,
argument labels and long help texts fall back to English until filled in.
 *
 * @license Apache-2.0
 */

const operations = {};
const descriptions = {};
const args = {};
const options = {};
import categories from "./categories.json" with { type: "json" };
import ui from "./ui.json" with { type: "json" };

export default {
    operations,
    descriptions,
    args,
    options,
    categories,
    ui,
    // Runtime-interpolated fragments; {n}/{wiki} are placeholders.
    patterns:     {
        "selectedSuffix": "개 선택됨)",
        "detected": "(감지됨)",
        "wikiJoin": " ({wiki})"
    },
    // Build-time interpolated prefixes (version numbers, timestamps).
    prefixRules: [
        [/^Version /, "버전 "],
        [/^Compile time: /, "컴파일 시각: "],
        [/^Build time: /, "빌드 시각: "],
        [/^SHA256 hash: /, "SHA256 해시: "],
    ],
};
