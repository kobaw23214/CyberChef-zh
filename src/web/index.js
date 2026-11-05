/**
 * @author n1474335 [n1474335@gmail.com]
 * @copyright Crown Copyright 2016
 * @license Apache-2.0
 */

// Styles
import "./stylesheets/index.js";

// Libs
import "arrive";
import "snackbarjs";
import "bootstrap-material-design/js/index";
import "bootstrap-colorpicker";
import moment from "moment-timezone";
import * as CanvasComponents from "../core/lib/CanvasComponents.mjs";

// Localise relative durations (e.g. "Last build" notice)
moment.locale("zh-cn");

// CyberChef
import App from "./App.mjs";
import Categories from "../core/config/Categories.json" with { type: "json" };
import OperationConfig from "../core/config/OperationConfig.json" with { type: "json" };
import {setLanguage, loadLanguage, momentLocale, decorateCategories, decorateOperations, applyStaticTranslations} from "./i18n/i18n.mjs";


/**
 * Main function used to build the CyberChef web app.
 */
async function main() {
    const defaultFavourites = [
        "To Base64",
        "From Base64",
        "To Hex",
        "From Hex",
        "To Hexdump",
        "From Hexdump",
        "URL Decode",
        "Regular expression",
        "Entropy",
        "Fork",
        "Magic"
    ];

    const defaultOptions = {
        language:           "zh-CN",
        hiddenOperations:   [],
        updateUrl:           true,
        showHighlighter:     true,
        wordWrap:            true,
        showErrors:          true,
        errorTimeout:        4000,
        attemptHighlight:    true,
        theme:               "classic",
        useMetaKey:          false,
        logLevel:            "info",
        autoMagic:           true,
        imagePreview:        true,
        syncTabs:            true,
        showCatCount:        false,
    };

    // Apply the saved UI language before anything renders
    let language = "zh-CN";
    try {
        language = JSON.parse(localStorage.getItem("options") || "{}").language || "zh-CN";
    } catch (err) {}
    setLanguage(language);
    // Load the language bundle before anything renders so that decorations
    // and the static chrome translation hit the dictionaries.
    await loadLanguage(language);
    moment.locale(momentLocale());

    // Translate the static chrome before the app boots so that Bootstrap
    // tooltips pick up the translated titles when they initialise
    applyStaticTranslations();

    document.removeEventListener("DOMContentLoaded", main, false);
    window.app = new App(
        decorateCategories(Categories),
        decorateOperations(OperationConfig),
        defaultFavourites,
        defaultOptions
    );
    window.app.setup();
}

window.compileTime = moment.tz(COMPILE_TIME, "DD/MM/YYYY HH:mm:ss z", "UTC").valueOf();
window.compileMessage = COMPILE_MSG;

// Make libs available to operation outputs
window.CanvasComponents = CanvasComponents;

document.addEventListener("DOMContentLoaded", main, false);

