const { chromium } = require("playwright");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const artifacts = path.join(root, "artifacts", "visual-qa");
const opsUrl = pathToFileURL(path.join(root, "salgil-ops-web", "index.html")).href;
const fieldUrl = pathToFileURL(path.join(root, "salgil-field-web", "index.html")).href;
const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
];
const captureManifest = [];

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function capture(page, viewportName, screenName) {
  const file = path.join(artifacts, `${viewportName}-${screenName}.png`);
  await page.evaluate(async () => {
    const main = document.querySelector("main");
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
    if (main) main.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    document.scrollingElement.scrollTop = 0;
    document.scrollingElement.scrollLeft = 0;
    if (main) {
      main.scrollTop = 0;
      main.scrollLeft = 0;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const fullPage = viewportName !== "desktop" || !screenName.startsWith("ops-");
  await page.screenshot({ path: file, fullPage });
  const scrollTop = await page.evaluate(() => ({ page: document.scrollingElement.scrollTop, main: document.querySelector("main")?.scrollTop || 0 }));
  expect(scrollTop.page === 0 && scrollTop.main === 0, `${viewportName}-${screenName}: capture did not start at top`);
  const topShell = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { top: Math.round(bounds.top), left: Math.round(bounds.left), width: Math.round(bounds.width), height: Math.round(bounds.height) };
    };
    return {
      contextBar: rect(".context-bar"),
      sideNav: rect(".side-nav"),
      operationsBrand: rect(".side-nav .brand"),
      mobileMenu: rect("#mobile-menu"),
      fieldHeader: rect(".app-header"),
    };
  });
  if (screenName.startsWith("ops-")) {
    expect(topShell.contextBar?.top === 0, `${viewportName}-${screenName}: operations header is not at top`);
    if (viewportName === "desktop") {
      expect(topShell.sideNav?.top === 0 && topShell.operationsBrand?.top >= 0, `${viewportName}-${screenName}: desktop brand shell is out of frame`);
    } else {
      expect(topShell.mobileMenu?.top >= 0 && topShell.mobileMenu?.top < 20, `${viewportName}-${screenName}: compact header is out of frame`);
    }
  } else {
    expect(topShell.fieldHeader?.top === 0, `${viewportName}-${screenName}: field header is not at top`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 1, `${viewportName}-${screenName}: horizontal overflow ${overflow}px`);
  captureManifest.push({ capture: `${viewportName}-${screenName}.png`, scrollTop, topShell, overflow });
}

async function openOpsView(page, view) {
  const button = page.locator(`[data-view="${view}"]:visible`);
  if (!(await button.isVisible())) await page.locator("#mobile-menu").click();
  await page.locator(`[data-view="${view}"]:visible`).click();
}

async function verifyOps(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${opsUrl}#situation`);
  expect(await page.locator("#replan-feedback").evaluate((element) => getComputedStyle(element).display === "none"), "Hidden replanning feedback must not occupy layout space");
  await page.waitForSelector(".leaflet-tile-loaded", { timeout: 10000 });
  expect(await page.locator(".leaflet-tile-loaded").count() > 0, "Operational basemap tiles did not load");
  for (const layerName of ["communities", "hazards", "routes", "shelters", "teams", "constraints"]) {
    await page.locator(`[data-map-layer="${layerName}"]`).uncheck();
    expect(await page.evaluate((name) => !window.SALGIL_MAP_DEBUG.map.hasLayer(window.SALGIL_MAP_DEBUG.layers[name]), layerName), `${layerName} layer remained visible`);
    await page.locator(`[data-map-layer="${layerName}"]`).check();
    expect(await page.evaluate((name) => window.SALGIL_MAP_DEBUG.map.hasLayer(window.SALGIL_MAP_DEBUG.layers[name]), layerName), `${layerName} layer did not return`);
  }
  await page.locator('.spatial-village[data-village="Wolwe"]').click();
  expect(await page.locator("#detail-community").textContent() === "Wolwe", "Map inspector did not follow community selection");
  await page.locator('.spatial-village[data-village="Sangchon"]').click();
  await capture(page, viewport.name, "ops-situation");

  await openOpsView(page, "contact");
  expect(await page.locator("#start-contact").isDisabled(), "Contact must be blocked before approval");
  await capture(page, viewport.name, "ops-contact-ready");

  await openOpsView(page, "plan");
  await page.locator("#approve-plan").click();
  expect(await page.locator("#plan-state").textContent().then((text) => text.includes("Approved")), "Plan approval state missing");
  await capture(page, viewport.name, "ops-plan-approved-tone-inset");

  await openOpsView(page, "contact");
  await page.locator("#start-contact").click();
  expect(await page.locator("#no-answer-count").textContent() === "2", "No-answer result missing");
  const contactTotal = await page.locator("#safe-count, #help-count, #no-answer-count").allTextContents();
  expect(contactTotal.map(Number).reduce((sum, count) => sum + count, 0) === 76, "Contact result total mismatch");
  await capture(page, viewport.name, "ops-contact-results");

  await page.locator('[data-go="patrol"]').click();
  await capture(page, viewport.name, "ops-patrol-ready");
  await page.locator("#open-report").click();
  await page.locator("#report-form button[type=submit]").click();
  expect(await page.locator("#replan-feedback").isVisible(), "Replanning notice missing");
  expect(await page.locator("#plan-state").textContent().then((text) => text.includes("Reapproval required")), "Reapproval state missing");
  expect(await page.locator("#start-contact").isDisabled(), "Contact must pause after replanning");
  expect(await page.locator("#route-cell").textContent().then((text) => text.includes("north bypass")), "Updated route missing");
  expect(await page.evaluate(() => window.SALGIL_MAP_DEBUG.layers.routes.getLayers().length === 3), "Revised map route missing");
  expect(await page.evaluate(() => window.SALGIL_MAP_DEBUG.layers.constraints.getLayers().length === 2), "New map constraint missing");
  await capture(page, viewport.name, "ops-patrol-replan");
  await openOpsView(page, "situation");
  expect(await page.locator("#map-revision-banner").isVisible(), "Revised route banner missing");
  await capture(page, viewport.name, "ops-map-revised");
  expect(errors.length === 0, `Ops page errors: ${errors.join(", ")}`);
  await page.close();
}

async function verifyField(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fieldUrl);
  await capture(page, viewport.name, "field-normal");
  await page.locator("#start-safety-check").click();
  expect(await page.locator("#resident-feedback").isVisible(), "Safety check receipt missing");

  await page.locator('[data-mode="alert"]').click();
  expect(await page.locator('[data-mode-panel="alert"]').isVisible(), "Alert state did not open");
  await capture(page, viewport.name, "field-alert");
  await page.locator('[data-alert-action="share"]').click();
  expect(await page.locator("#resident-feedback").isVisible(), "Alert share receipt missing");

  await page.locator("#show-safe-route").click();
  expect(await page.locator('[data-mode-panel="route"]').isVisible(), "Route state did not open");
  await capture(page, viewport.name, "field-route");
  await page.locator("#request-help").click();
  expect(await page.locator("#resident-feedback").isVisible(), "Resident help receipt missing");
  await page.locator("#evacuation-action").click();
  expect(await page.locator("#evacuation-action").textContent() === "Confirm shelter arrival", "Evacuation progress action missing");

  await page.locator('[data-role="patrol"]').click();
  await capture(page, viewport.name, "field-patrol");
  await page.locator("#start-task").click();
  await capture(page, viewport.name, "field-patrol-report");
  await page.locator(".check input").check();
  await page.locator("#field-report-form button[type=submit]").click();
  expect(await page.locator("#patrol-feedback").isVisible(), "Field report receipt missing");
  expect(errors.length === 0, `Field page errors: ${errors.join(", ")}`);
  await page.close();
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    for (const viewport of viewports) {
      await verifyOps(browser, viewport);
      await verifyField(browser, viewport);
    }
    fs.writeFileSync(path.join(artifacts, "capture-manifest.json"), `${JSON.stringify(captureManifest, null, 2)}\n`);
  } finally {
    await browser.close();
  }
  process.stdout.write(`PASS: ${viewports.length * 12} responsive state captures\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
