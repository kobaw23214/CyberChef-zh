/**
 * Extracts every user-facing string that the zh-CN dictionaries cover from
 * the operation sources: operation names, descriptions, argument labels and
 * hints, and dropdown option labels. Writes English source inventories
 * (*.source.json) next to this script for translators. Existing translated
 * dictionaries are never overwritten.
 *
 * Usage (from the project root):
 *   node src/core/config/scripts/generateOpsIndex.mjs   # if not built yet
 *   node src/web/i18n/extract.mjs
 *
 * @license Apache-2.0
 */

/* eslint no-console: ["off"] */

import fs from "fs";
import path from "path";
import * as Ops from "../../core/operations/index.mjs";

const markerRe = /^\[\/?.+\]$/;

const operations = {},
    descriptions = {},
    args = {},
    options = {};

for (const opObj in Ops) {
    const op = new Ops[opObj]();

    operations[op.name] = "";
    if (op.description) descriptions[op.name] = op.description;

    for (const arg of op.args || []) {
        if (arg.name) args[arg.name] = "";
        if (arg.hint) args[arg.hint] = "";

        if (Array.isArray(arg.value)) {
            for (const item of arg.value) {
                if (typeof item === "string") {
                    if (!markerRe.test(item)) options[item] = "";
                } else if (item && typeof item === "object" && typeof item.name === "string") {
                    if (!markerRe.test(item.name)) options[item.name] = "";
                }
            }
        }

        if (Array.isArray(arg.toggleValues)) {
            for (const tv of arg.toggleValues) {
                if (!markerRe.test(tv)) options[tv] = "";
            }
        }
    }
}

const outDir = path.join(process.cwd(), "src/web/i18n/languages/zh-CN");
const write = (name, obj) =>
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 4) + "\n");

write("operations.source.json", operations);
write("args.source.json", args);
write("options.source.json", options);
write("descriptions.source.json", descriptions);

console.log(`operations: ${Object.keys(operations).length}`);
console.log(`descriptions: ${Object.keys(descriptions).length}`);
console.log(`arg labels/hints: ${Object.keys(args).length}`);
console.log(`option labels: ${Object.keys(options).length}`);
