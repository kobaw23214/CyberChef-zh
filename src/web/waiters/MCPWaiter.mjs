/**
 * Waiter for the full-screen MCP management panel.
 *
 * The panel talks to the cyberchef-mcp service over its HTTP management
 * API (/api/operations, /api/records) - the web app itself stays free of
 * any MCP logic (layering: web UI and MCP server only meet over HTTP).
 *
 * The four MCP meta-tools are always-on infrastructure and are shown as a
 * fixed line; what the administrator toggles here is the CyberChef
 * operation catalog exposed to agents via list_operations & co.
 *
 * @license Apache-2.0
 */

import {tUI, getLanguage} from "../i18n/i18n.mjs";

const URL_STORAGE_KEY = "mcpServerUrl";
const POLL_MS = 5000;
const BUILTIN_TOOLS = "list_operations · get_operation · bake · magic";

/**
 * Waiter to handle events related to the MCP management panel.
 */
class MCPWaiter {

    /**
     * MCPWaiter constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     */
    constructor(app, manager) {
        this.app = app;
        this.manager = manager;
        this.connected = false;
        this.pollTimer = null;
        this.filterTimer = null;
        this.opTree = null;
        this.collapsedCategories = new Set();
    }

    /**
     * Localise the static panel chrome and restore the saved service URL.
     */
    initialise() {
        const $ = id => document.getElementById(id);

        $("mcp-title").textContent = tUI("MCP Management");
        $("mcp-connect").textContent = tUI("Connect");
        $("mcp-refresh").textContent = tUI("Refresh");
        $("mcp-tab-manage").textContent = tUI("MCP Management");
        $("mcp-tab-records").textContent = tUI("MCP Call Records");
        $("mcp-ops-heading").textContent = tUI("Operations exposed to agents");
        $("mcp-ops-all").textContent = tUI("Enable all");
        $("mcp-ops-none").textContent = tUI("Disable all");
        $("mcp-ops-search").placeholder = tUI("Search operations...");
        $("mcp-builtin-tools").textContent =
            `${tUI("Built-in tools (always on):")} ${BUILTIN_TOOLS}`;
        $("mcp-records-search").placeholder = tUI("Filter by tool name...");
        $("mcp-th-time").textContent = tUI("Time");
        $("mcp-th-tool").textContent = tUI("Tool");
        $("mcp-th-result").textContent = tUI("Result");
        $("mcp-th-duration").textContent = tUI("Duration");
        $("mcp-th-detail").textContent = tUI("Detail");
        $("mcp-records-clear").textContent = tUI("Clear");
        $("mcp-records-from").title = tUI("From");
        $("mcp-records-to").title = tUI("To");

        // 时间范围预设(值即小时数,"custom" 显示起止输入框)
        const range = $("mcp-records-range");
        range.textContent = "";
        for (const [value, label] of [
            ["all", tUI("All time")],
            ["1", tUI("Last hour")],
            ["24", tUI("Last 24 hours")],
            ["168", tUI("Last 7 days")],
            ["custom", tUI("Custom range...")],
        ]) {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            range.appendChild(opt);
        }

        $("mcp-url").value = localStorage.getItem(URL_STORAGE_KEY) ||
            `http://${location.hostname || "127.0.0.1"}:8090`;

        const closeBtn = $("mcp-close");
        closeBtn.title = tUI("Close");
        closeBtn.setAttribute("aria-label", tUI("Close"));
    }

    /**
     * Switch between the two sheets ("manage" | "records").
     *
     * @param {string} sheet
     */
    switchSheet(sheet) {
        const manage = sheet === "manage";
        document.getElementById("mcp-tab-manage").classList.toggle("active", manage);
        document.getElementById("mcp-tab-records").classList.toggle("active", !manage);
        document.getElementById("mcp-sheet-manage").hidden = !manage;
        document.getElementById("mcp-sheet-records").hidden = manage;
    }

    /**
     * Default URL for the MCP service, without trailing slash.
     *
     * @returns {string}
     */
    get baseUrl() {
        const url = document.getElementById("mcp-url").value.trim();
        return url.replace(/\/+$/, "");
    }

    /**
     * Toggle the panel; connects on first open.
     */
    mcpClick() {
        const overlay = document.getElementById("mcp-overlay");
        if (!overlay.hidden) {
            this.close();
            return;
        }
        overlay.hidden = false;
        this.initialise();
        this.switchSheet("manage");
        this.refresh();
        this.pollTimer = setInterval(() => this.refresh(false, false), POLL_MS);
    }

    /**
     * Close the panel and stop polling.
     */
    close() {
        document.getElementById("mcp-overlay").hidden = true;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.filterTimer) {
            clearTimeout(this.filterTimer);
            this.filterTimer = null;
        }
    }

    /**
     * @param {string} path
     * @param {Object} options - fetch options
     * @returns {Promise<Object>} parsed JSON response
     */
    async api(path, options) {
        const res = await fetch(this.baseUrl + path, options);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return await res.json();
    }

    /**
     * Probe the service, then load the operation tree and records.
     * Polling passes loadOperations=false so an in-progress search or
     * scroll position is not clobbered every few seconds.
     *
     * @param {boolean} [loadOperations=true]
     * @param {boolean} [showErrors=true]
     */
    async refresh(loadOperations = true, showErrors = true) {
        try {
            await this.api("/api/health");
            this.setConnected(true);
            const tasks = [this.loadRecords()];
            if (loadOperations) tasks.push(this.loadOperations());
            await Promise.all(tasks);
        } catch (err) {
            this.setConnected(false);
            if (showErrors) {
                this.renderRecords([]);
            }
        }
    }

    /**
     *
     */
    setConnected(on) {
        this.connected = on;
        const dot = document.getElementById("mcp-status");
        dot.classList.toggle("mcp-status-on", on);
        dot.classList.toggle("mcp-status-off", !on);
        dot.title = on ? tUI("Connected") : tUI("Not connected");
    }

    /**
     * Fetch the operation tree and render it (keeping any active filter).
     */
    async loadOperations() {
        this.opTree = await this.api(`/api/operations?lang=${encodeURIComponent(getLanguage())}`);
        this.renderOperations();
    }

    /**
     * Render the category/operation tree into the panel, honouring the
     * search box filter (matches English name, localised name, category).
     * Categories are rendered as collapsible groups; the collapsed state
     * lives in `collapsedCategories` (by category name) and survives
     * re-renders. While a search filter is active all groups are expanded
     * so matches stay visible.
     */
    renderOperations() {
        const list = document.getElementById("mcp-ops-list");
        list.textContent = "";
        if (!this.opTree) return;

        document.getElementById("mcp-ops-count").textContent =
            `${this.opTree.enabled} / ${this.opTree.total}`;

        const needle = document.getElementById("mcp-ops-search").value.trim().toLowerCase();
        const searching = needle.length > 0;
        const matches = (op, catName) => {
            if (!needle) return true;
            return op.name.toLowerCase().includes(needle) ||
                (op.nameLocal && op.nameLocal.toLowerCase().includes(needle)) ||
                catName.toLowerCase().includes(needle);
        };

        let rendered = 0;
        this.opTree.categories.forEach((cat, catIndex) => {
            const ops = cat.ops.filter(op => matches(op, cat.name));
            if (!ops.length) return;

            const collapsed = !searching && this.collapsedCategories.has(cat.name);
            const catLi = document.createElement("li");
            catLi.className = "mcp-ops-category" + (collapsed ? " mcp-collapsed" : "");
            catLi.dataset.catName = cat.name;

            // Sticky header: arrow (collapse) + tri-state checkbox + label
            // (collapse) + enabled/total count.
            const header = document.createElement("div");
            header.className = "mcp-cat-header";
            header.dataset.catIndex = catIndex;

            const arrow = document.createElement("span");
            arrow.className = "mcp-cat-arrow";
            arrow.textContent = collapsed ? "▸" : "▾";

            const catToggle = document.createElement("input");
            catToggle.type = "checkbox";
            catToggle.className = "mcp-cat-toggle";
            catToggle.id = `mcp-cat-${catIndex}`;
            catToggle.addEventListener("change", () =>
                this.toggleCategory(catIndex, catToggle.checked));

            const catLabel = document.createElement("span");
            catLabel.className = "mcp-cat-label";
            catLabel.textContent = cat.nameLocal ? `${cat.nameLocal} (${cat.name})` : cat.name;

            const catCount = document.createElement("span");
            catCount.className = "mcp-cat-count";

            header.append(arrow, catToggle, catLabel, catCount);
            // 点箭头或分类名 = 折叠/展开(不影响勾选)
            header.addEventListener("click", e => {
                if (e.target === catToggle) return;
                this.toggleCategoryCollapse(cat.name);
            });

            const group = document.createElement("ul");
            group.className = "mcp-ops-group";
            for (const op of ops) {
                const opLi = document.createElement("li");
                opLi.className = "mcp-ops-item";

                const toggle = document.createElement("input");
                toggle.type = "checkbox";
                toggle.className = "mcp-op-toggle";
                toggle.checked = op.enabled;
                toggle.id = `mcp-op-${op.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
                toggle.addEventListener("change", () =>
                    this.toggleOperation(op.name, toggle.checked, opLi));

                const label = document.createElement("label");
                label.htmlFor = toggle.id;
                label.className = "mcp-op-label" + (op.enabled ? "" : " mcp-op-disabled");
                label.textContent = op.nameLocal ? `${op.nameLocal} (${op.name})` : op.name;

                opLi.append(toggle, label);
                group.appendChild(opLi);
                rendered++;
            }

            catLi.append(header, group);
            list.appendChild(catLi);
        });

        this.updateCategoryStates();

        if (!rendered) {
            const empty = document.createElement("li");
            empty.className = "mcp-ops-empty";
            empty.textContent = tUI("No matching operations.");
            list.appendChild(empty);
        }
    }

    /**
     * Collapse or expand one category group in place (no re-render, so the
     * scroll position is preserved).
     *
     * @param {string} catName
     */
    toggleCategoryCollapse(catName) {
        const catLi = document.querySelector(
            `#mcp-ops-list .mcp-ops-category[data-cat-name="${CSS.escape(catName)}"]`);
        if (!catLi) return;
        const collapsing = !catLi.classList.contains("mcp-collapsed");
        catLi.classList.toggle("mcp-collapsed", collapsing);
        const arrow = catLi.querySelector(".mcp-cat-arrow");
        if (arrow) arrow.textContent = collapsing ? "▸" : "▾";
        if (collapsing) {
            this.collapsedCategories.add(catName);
        } else {
            this.collapsedCategories.delete(catName);
        }
    }

    /**
     * Refresh every rendered category header (tri-state checkbox and
     * enabled/total count) from the cached tree.
     */
    updateCategoryStates() {
        if (!this.opTree) return;
        for (const header of document.querySelectorAll("#mcp-ops-list .mcp-cat-header[data-cat-index]")) {
            const cat = this.opTree.categories[Number(header.dataset.catIndex)];
            const box = header.querySelector(".mcp-cat-toggle");
            if (!cat || !box) continue;
            const enabled = cat.ops.filter(op => op.enabled).length;
            box.checked = enabled > 0 && enabled === cat.ops.length;
            box.indeterminate = enabled > 0 && enabled < cat.ops.length;
            const count = header.querySelector(".mcp-cat-count");
            if (count) count.textContent = `${enabled}/${cat.ops.length}`;
        }
    }

    /**
     * Tree-style category toggle: enable or disable every operation in the
     * category, then re-render (duplicate appearances in other categories
     * are updated in the cached tree as well).
     *
     * @param {number} catIndex
     * @param {boolean} enabled
     */
    async toggleCategory(catIndex, enabled) {
        const cat = this.opTree && this.opTree.categories[catIndex];
        if (!cat) return;
        const names = cat.ops.map(op => op.name);
        try {
            await this.api("/api/operations/bulk", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({names, enabled}),
            });
            const nameSet = new Set(names);
            for (const other of this.opTree.categories) {
                for (const op of other.ops) {
                    if (nameSet.has(op.name)) op.enabled = enabled;
                }
            }
            this.recount();
            this.renderOperations();
        } catch (err) {
            await this.loadOperations();
        }
    }

    /**
     * Enable or disable a single operation. On failure the tree reloads so
     * the checkbox snaps back to the server-side truth.
     *
     * @param {string} name
     * @param {boolean} enabled
     * @param {HTMLLIElement} li - row to restyle on success
     */
    async toggleOperation(name, enabled, li) {
        try {
            await this.api(`/api/operations/${encodeURIComponent(name)}/enabled`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({enabled}),
            });
            if (this.opTree) {
                for (const cat of this.opTree.categories) {
                    for (const op of cat.ops) {
                        if (op.name === name) op.enabled = enabled;
                    }
                }
                this.recount();
                this.updateCategoryStates();
            }
            const label = li && li.querySelector(".mcp-op-label");
            if (label) label.classList.toggle("mcp-op-disabled", !enabled);
        } catch (err) {
            await this.loadOperations();
        }
    }

    /**
     * Recompute the enabled-operations count after an in-place toggle.
     */
    recount() {
        if (!this.opTree) return;
        const seen = new Set();
        let enabled = 0;
        for (const cat of this.opTree.categories) {
            for (const op of cat.ops) {
                if (seen.has(op.name)) continue;
                seen.add(op.name);
                if (op.enabled) enabled++;
            }
        }
        this.opTree.enabled = enabled;
        document.getElementById("mcp-ops-count").textContent =
            `${enabled} / ${this.opTree.total}`;
    }

    /**
     * Bulk enable/disable all operations.
     *
     * @param {boolean} enabled
     */
    async setAllOperations(enabled) {
        try {
            await this.api("/api/operations/all", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({enabled}),
            });
            await this.loadOperations();
        } catch (err) {
            // Status dot already reflects the outage.
        }
    }

    /**
     * Search box handler: re-render the cached tree with the new filter.
     */
    searchChange() {
        this.renderOperations();
    }

    /**
     * Build the /api/records query from the current filter controls.
     *
     * @returns {string} query string with leading "?"
     */
    recordsQuery() {
        const params = new URLSearchParams();
        params.set("limit", "200");
        const tool = document.getElementById("mcp-records-search").value.trim();
        if (tool) params.set("tool", tool);

        const range = document.getElementById("mcp-records-range").value;
        if (range === "custom") {
            const from = document.getElementById("mcp-records-from").value;
            const to = document.getElementById("mcp-records-to").value;
            // datetime-local 是本地时间,转成 ISO 交给服务端比较
            if (from) params.set("from", new Date(from).toISOString());
            if (to) params.set("to", new Date(`${to}:59`).toISOString());
        } else if (range !== "all") {
            params.set("from", new Date(Date.now() - Number(range) * 3600_000).toISOString());
        }
        return `?${params.toString()}`;
    }

    /**
     *
     */
    async loadRecords() {
        const data = await this.api(`/api/records${this.recordsQuery()}`);
        this.renderRecords(data.records || []);
    }

    /**
     * Any records-filter control changed: reload (debounced for typing).
     */
    recordsFilterChange() {
        const custom = document.getElementById("mcp-records-range").value === "custom";
        document.getElementById("mcp-records-from").hidden = !custom;
        document.getElementById("mcp-records-to").hidden = !custom;
        if (this.filterTimer) clearTimeout(this.filterTimer);
        this.filterTimer = setTimeout(() => {
            this.filterTimer = null;
            this.loadRecords().catch(() => {});
        }, 250);
    }

    /**
     * @param {Object[]} records - newest first
     */
    renderRecords(records) {
        const body = document.getElementById("mcp-records-body");
        body.textContent = "";

        if (!records.length) {
            const row = body.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 5;
            cell.textContent = tUI("No call records yet.");
            return;
        }

        for (const rec of records.slice(0, 100)) {
            const row = body.insertRow();

            const time = row.insertCell();
            time.className = "mcp-col-time";
            time.textContent = rec.ts ? rec.ts.replace("T", " ").slice(0, 19) : "";

            const tool = row.insertCell();
            tool.className = "mcp-col-tool";
            tool.textContent = rec.tool;

            const result = row.insertCell();
            result.className = "mcp-col-result";
            result.textContent = rec.ok ? "✓" : "✗";
            result.classList.add(rec.ok ? "mcp-record-ok" : "mcp-record-fail");

            const duration = row.insertCell();
            duration.className = "mcp-col-duration";
            duration.textContent = `${rec.durationMs ?? 0} ms`;

            const detail = row.insertCell();
            const detailText = rec.ok ? rec.outputPreview : `${rec.error || ""}\n${rec.argsPreview || ""}`;
            const pre = document.createElement("span");
            pre.className = "mcp-record-detail";
            pre.style.whiteSpace = "pre-wrap";
            pre.textContent = (detailText || "").slice(0, 500);
            detail.appendChild(pre);
        }
    }

    /**
     * "Connect" button: persist the URL and refresh immediately.
     */
    connectClick() {
        localStorage.setItem(URL_STORAGE_KEY, this.baseUrl);
        this.refresh();
    }

    /**
     * "Clear" button for the call records.
     */
    async clearRecordsClick() {
        try {
            await this.api("/api/records/clear", {method: "POST"});
            await this.loadRecords();
        } catch (err) {
            // Status dot already reflects the outage.
        }
    }
}

export default MCPWaiter;
