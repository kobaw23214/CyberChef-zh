/**
 * fr language bundle.
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
        "selectedSuffix": " sélectionnés)",
        "detected": "(détecté)",
        "wikiJoin": " sur {wiki}"
    },
    // Build-time interpolated prefixes (version numbers, timestamps).
    prefixRules: [
        [/^Version /, "Version "],
        [/^Compile time: /, "Temps de compilation : "],
        [/^Build time: /, "Date de build : "],
        [/^SHA256 hash: /, "Hachage SHA256 : "],
    ],
};
