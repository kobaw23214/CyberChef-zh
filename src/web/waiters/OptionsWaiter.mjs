/**
 * @author n1474335 [n1474335@gmail.com]
 * @copyright Crown Copyright 2016
 * @license Apache-2.0
 */

import Utils from "../../core/Utils.mjs";

/**
 * Waiter to handle events related to the CyberChef options.
 */
class OptionsWaiter {

    /**
     * OptionsWaiter constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     */
    constructor(app, manager) {
        this.app = app;
        this.manager = manager;
    }

    /**
     * Loads options and sets values of switches and inputs to match them.
     *
     * @param {Object} options
     */
    load(options) {
        Object.assign(this.app.options, options);

        // Sync the hidden operations set from the stored options
        this.app.hiddenOperations = new Set(this.app.options.hiddenOperations || []);

        // Set options to match object
        document.querySelectorAll("#options-body input[type=checkbox]").forEach(cbox => {
            cbox.checked = this.app.options[cbox.getAttribute("option")];
        });

        document.querySelectorAll("#options-body input[type=number]").forEach(nbox => {
            nbox.value = this.app.options[nbox.getAttribute("option")];
            nbox.dispatchEvent(new CustomEvent("change", {bubbles: true}));
        });

        document.querySelectorAll("#options-body select").forEach(select => {
            const val = this.app.options[select.getAttribute("option")];
            if (val) {
                select.value = val;
                select.dispatchEvent(new CustomEvent("change", {bubbles: true}));
            } else {
                select.selectedIndex = 0;
            }
        });

        // Initialise options
        this.setWordWrap();
        this.manager.ops.setCatCount();
    }


    /**
     * Handler for options click events.
     * Displays the options pane.
     *
     * @param {event} e
     */
    optionsClick(e) {
        e.preventDefault();
        $("#options-modal").modal();
    }


    /**
     * Handler for reset options click events.
     * Resets options back to their default values.
     */
    resetOptionsClick() {
        this.load(this.app.doptions);
        this.app.setHiddenOperations([]);
    }


    /**
     * Handler for switch change events.
     *
     * @param {event} e
     */
    switchChange(e) {
        const el = e.target;
        const option = el.getAttribute("option");
        const state = el.checked;

        this.updateOption(option, state);
    }


    /**
     * Handler for number change events.
     *
     * @param {event} e
     */
    numberChange(e) {
        const el = e.target;
        const option = el.getAttribute("option");
        const val = parseInt(el.value, 10);

        this.updateOption(option, val);
    }


    /**
     * Handler for select change events.
     *
     * @param {event} e
     */
    selectChange(e) {
        const el = e.target;
        const option = el.getAttribute("option");
        // The UI language is applied at boot; reload to switch fully. Skip
        // when the value did not actually change (load() re-dispatches).
        const reload = option === "language" && this.app.options.language !== el.value;

        this.updateOption(option, el.value);

        if (reload) {
            setTimeout(() => location.reload(), 100);
        }
    }

    /**
     * Modifies an option value and saves it to local storage.
     *
     * @param {string} option - The option to be updated
     * @param {string|number|boolean} value - The new value of the option
     */
    updateOption(option, value) {
        log.debug(`Setting ${option} to ${value}`);
        this.app.options[option] = value;

        if (this.app.isLocalStorageAvailable())
            localStorage.setItem("options", JSON.stringify(this.app.options));
    }


    /**
     * Sets or unsets word wrap on the input and output depending on the wordWrap option value.
     */
    setWordWrap() {
        this.manager.input.setWordWrap(this.app.options.wordWrap);
        this.manager.output.setWordWrap(this.app.options.wordWrap);
    }


    /**
     * Theme change event listener
     *
     * @param {Event} e
     */
    themeChange(e) {
        const themeClass = e.target.value;
        this.changeTheme(themeClass);
    }


    /**
     * Changes the theme by setting the class of the <html> element.
     *
     * @param (string} theme
     */
    changeTheme(theme) {
        document.querySelector(":root").className = theme;

        // Update theme selection
        const themeSelect = document.getElementById("theme");
        let themeOption = themeSelect.querySelector(`option[value="${theme}"]`);

        if (!themeOption) {
            const preferredColorScheme = this.getPreferredColorScheme();
            document.querySelector(":root").className = preferredColorScheme;
            themeOption = themeSelect.querySelector(`option[value="${preferredColorScheme}"]`);
        }

        themeSelect.selectedIndex = themeOption.index;
    }

    /**
     * Applies the user's preferred color scheme using the `prefers-color-scheme` media query.
     */
    applyPreferredColorScheme() {
        const themeFromStorage = this.app?.options?.theme;
        let theme = themeFromStorage;
        if (!theme) {
            theme = this.getPreferredColorScheme();
        }
        this.changeTheme(theme);
    }

    /**
     * Get the user's preferred color scheme using the `prefers-color-scheme` media query.
     */
    getPreferredColorScheme() {
        const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)").matches;
        return prefersDarkScheme ? "dark" : "classic";
    }

    /**
     * Changes the console logging level.
     *
     * @param {Event} e
     */
    logLevelChange(e) {
        const level = e.target.value;
        log.setLevel(level, false);
        this.manager.worker.setLogLevel();
        this.manager.input.setLogLevel();
        this.manager.output.setLogLevel();
        this.manager.background.setLogLevel();
    }


    /**
     * Handler for the 'Manage operations' button.
     * Builds the operations visibility tree and displays the modal.
     *
     * @param {event} e
     */
    manageOperationsClick(e) {
        e.preventDefault();
        this.buildOperationsTree();
        $("#ops-tree-modal").modal();
    }


    /**
     * Builds the category/operation checkbox tree used to control which
     * operations are displayed in the Operations list.
     */
    buildOperationsTree() {
        const treeEl = document.getElementById("ops-tree");
        let html = "";

        for (let i = 0; i < this.app.categories.length; i++) {
            const cat = this.app.categories[i];
            html += `<div class="ops-tree-category" data-catname="${cat.name}">
                <label style="font-weight: bold; cursor: pointer; display: block; margin: 6px 0 2px 0">
                    <input type="checkbox" class="ops-tree-cat-checkbox" data-cat="${i}">
                    ${Utils.escapeHtml(cat.display || cat.name)}
                    <span class="ops-tree-count" style="font-weight: normal; color: #888"></span>
                </label>
                <div class="ops-tree-ops" style="margin-left: 22px; display: flex; flex-wrap: wrap;">`;

            for (const opName of cat.ops) {
                if (!(opName in this.app.operations)) continue;
                const display = this.app.operations[opName].display || opName;
                html += `<label class="ops-tree-op" data-search="${Utils.escapeHtml((display + " " + opName).toLowerCase())}" style="margin: 1px 16px 1px 0; cursor: pointer; font-weight: normal">
                    <input type="checkbox" class="ops-tree-op-checkbox" data-op="${Utils.escapeHtml(opName)}">
                    ${Utils.escapeHtml(display)}
                </label>`;
            }

            html += `</div></div>`;
        }

        treeEl.innerHTML = html;
        this.updateTreeStates();

        // Wire handlers (off first so re-opening the modal doesn't stack them)
        $(treeEl).off("change", ".ops-tree-op-checkbox").on("change", ".ops-tree-op-checkbox", () => this.applyTree());
        $(treeEl).off("change", ".ops-tree-cat-checkbox").on("change", ".ops-tree-cat-checkbox", e => {
            const checked = e.target.checked;
            $(treeEl).find(`.ops-tree-op-checkbox[data-cat-group="${$(e.target).data("cat")}"]`).prop("checked", checked);
            this.applyTree();
        });

        // Category checkbox affects the operations rendered under its block
        $(treeEl).find(".ops-tree-category").each((_, catBlock) => {
            const catIdx = $(".ops-tree-cat-checkbox", catBlock).data("cat");
            $(".ops-tree-op-checkbox", catBlock).attr("data-cat-group", catIdx);
        });

        const searchEl = document.getElementById("ops-tree-search");
        $(searchEl).off("input").on("input", () => this.filterTree(searchEl.value));

        $("#ops-tree-all").off("click").on("click", () => {
            $(treeEl).find(".ops-tree-op-checkbox").prop("checked", true);
            this.applyTree();
        });
        $("#ops-tree-none").off("click").on("click", () => {
            $(treeEl).find(".ops-tree-op-checkbox").prop("checked", false);
            this.applyTree();
        });
    }


    /**
     * Reads the checkbox tree, hides the unchecked operations and refreshes
     * the checkbox states (category tri-state and counts).
     */
    applyTree() {
        const hidden = [];
        document.querySelectorAll("#ops-tree .ops-tree-op-checkbox").forEach(cb => {
            if (!cb.checked) hidden.push(cb.getAttribute("data-op"));
        });

        this.app.setHiddenOperations(hidden);
        this.updateTreeStates();
    }


    /**
     * Updates the operation checkboxes, category tri-state checkboxes and
     * visible/total counts from the currently hidden operations.
     */
    updateTreeStates() {
        document.querySelectorAll("#ops-tree .ops-tree-category").forEach(catBlock => {
            const ops = Array.from(catBlock.querySelectorAll(".ops-tree-op-checkbox"));
            if (!ops.length) return;

            ops.forEach(cb => {
                cb.checked = !this.app.isOperationHidden(cb.getAttribute("data-op"));
            });

            const visible = ops.filter(cb => cb.checked).length;
            const catCb = catBlock.querySelector(".ops-tree-cat-checkbox");
            catCb.checked = visible === ops.length;
            catCb.indeterminate = visible > 0 && visible < ops.length;
            catBlock.querySelector(".ops-tree-count").textContent = ` (${visible}/${ops.length})`;
        });
    }


    /**
     * Filters the tree to operations matching the given search term.
     *
     * @param {string} term
     */
    filterTree(term) {
        const needle = term.trim().toLowerCase();

        document.querySelectorAll("#ops-tree .ops-tree-op").forEach(el => {
            el.style.display = (!needle || el.getAttribute("data-search").includes(needle)) ? "" : "none";
        });

        document.querySelectorAll("#ops-tree .ops-tree-category").forEach(catBlock => {
            const anyVisible = Array.from(catBlock.querySelectorAll(".ops-tree-op"))
                .some(el => el.style.display !== "none");
            catBlock.style.display = anyVisible ? "" : "none";
        });
    }
}

export default OptionsWaiter;
