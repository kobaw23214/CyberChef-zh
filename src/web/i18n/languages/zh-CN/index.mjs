/**
 * Simplified Chinese language bundle (reference translation).
 *
 * Full coverage of every dictionary. Patterns cover the few runtime-built
 * strings that cannot be looked up as whole keys.
 *
 * @license Apache-2.0
 */

import operations from "./operations.json" with { type: "json" };
import descriptions from "./descriptions.json" with { type: "json" };
import args from "./args.json" with { type: "json" };
import options from "./options.json" with { type: "json" };
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
    patterns: {
        selectedSuffix: " 个字符)",
        detected: "(已检测)",
        wikiJoin: "({wiki})",
    },
    // Build-time interpolated prefixes (version numbers, timestamps) can
    // only be matched as prefixes of the live text. [source, replacement].
    prefixRules: [
        [/^Version /, "版本 "],
        [/^Compile time: /, "编译时间:"],
        [/^Build time: /, "构建时间:"],
        [/^SHA256 hash: /, "SHA256 哈希:"],
    ],
};
