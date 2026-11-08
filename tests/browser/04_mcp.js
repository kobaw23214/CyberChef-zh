/**
 * Tests for the MCP management panel (toolbar button, overlay, close).
 *
 * The panel itself talks to the cyberchef-mcp service which is not part of
 * the test environment, so only the offline behaviour is asserted here:
 * the panel opens from the toolbar, renders its chrome, and closes.
 *
 * @license Apache-2.0
 */

const utils = require("./browserUtils.js");

module.exports = {
    before: browser => {
        utils.openInEnglish(browser);
        browser.waitForElementNotPresent("#preloader", 10000);
    },

    "MCP panel opens from the toolbar": browser => {
        browser.useCss();
        browser.expect.element("#mcp").to.be.visible;
        browser.click("#mcp");
        browser.waitForElementVisible("#mcp-overlay", 5000);
        browser.expect.element("#mcp-title").to.be.visible;
        browser.expect.element("#mcp-url").to.be.visible;
        browser.expect.element("#mcp-tools-list, #mcp-ops-list").to.be.present;
        browser.expect.element("#mcp-records-body").to.be.present;
        // 双 sheet:管理与调用记录
        browser.expect.element("#mcp-tab-manage").to.be.visible;
        browser.expect.element("#mcp-tab-records").to.be.visible;
        browser.expect.element("#mcp-sheet-manage").to.be.visible;
    },

    "MCP panel sheets switch": browser => {
        browser.click("#mcp-tab-records");
        browser.waitForElementVisible("#mcp-sheet-records", 5000);
        browser.expect.element("#mcp-records-search").to.be.visible;
        browser.expect.element("#mcp-records-range").to.be.visible;
        browser.click("#mcp-tab-manage");
        browser.waitForElementVisible("#mcp-sheet-manage", 5000);
    },

    "MCP panel closes": browser => {
        browser.click("#mcp-close");
        browser.waitForElementNotVisible("#mcp-overlay", 5000);
        browser.end();
    },
};
