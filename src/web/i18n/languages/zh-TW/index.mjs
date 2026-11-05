/**
 * zh-TW language bundle.
 *
 * Full UI chrome coverage plus operation and category names; long help
texts fall back to Simplified Chinese's English source where not converted.
 *
 * @license Apache-2.0
 */

import operations from "./operations.json" with { type: "json" };
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
        "selectedSuffix": " 個字元)",
        "detected": "(已偵測)",
        "wikiJoin": "({wiki})"
    },
    // Build-time interpolated prefixes (version numbers, timestamps).
    prefixRules: [
        [/^Version /, "版本 "],
        [/^Compile time: /, "編譯時間: "],
        [/^Build time: /, "建置時間: "],
        [/^SHA256 hash: /, "SHA256 雜湊: "],
    ],
};
