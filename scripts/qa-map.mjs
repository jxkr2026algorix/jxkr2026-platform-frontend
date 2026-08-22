/**
 * Visual QA for the map renderer.
 *
 * The shaders are runtime strings and the whole thing is a GPU surface, so
 * neither tsc nor biome can tell you it looks wrong. This drives real Chrome,
 * runs a scenario, and writes screenshots plus a frame-to-frame difference —
 * the difference is how flicker gets measured instead of guessed at.
 *
 *   node scripts/qa-map.mjs [scenario] [outDir]
 *
 * Needs `yarn dev:map` running on 5183.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const scenario = process.argv[2] ?? "rain";
const outDir = process.argv[3] ?? "qa-out";
const base = process.env.MAP_URL ?? "http://localhost:5183";

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${base}/?district=47750`, { waitUntil: "load", timeout: 90_000 });
// The terrain load fetches DEM and imagery tiles before anything renders.
await page.waitForTimeout(18_000);

if (scenario !== "clear") {
  const label = scenario[0].toUpperCase() + scenario.slice(1);
  await page.getByRole("button", { name: label, exact: true }).click().catch(() => {});
  await page.evaluate(() => {
    const slider = document.querySelector("#panel input[type=range]");
    if (!slider) return;
    slider.value = slider.max;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(25_000);
}

const frames = [];
for (let i = 0; i < 6; i++) {
  frames.push(PNG.sync.read(await page.screenshot()));
  await page.waitForTimeout(100);
}
writeFileSync(`${outDir}/${scenario}.png`, PNG.sync.write(frames[0]));

// A still camera should produce near-identical frames. Anything above a few
// percent "strongly changed" is the map flickering.
let worst = 0;
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1].data;
  const b = frames[i].data;
  let big = 0;
  for (let p = 0; p < a.length; p += 4) {
    const d =
      Math.abs(a[p] - b[p]) +
      Math.abs(a[p + 1] - b[p + 1]) +
      Math.abs(a[p + 2] - b[p + 2]);
    if (d > 60) big++;
  }
  worst = Math.max(worst, (big / (a.length / 4)) * 100);
}

const panel = await page.evaluate(
  () => document.querySelector("#panel")?.textContent?.replace(/\s+/g, " ") ?? "",
);
const metrics = /FPS (\d+).*?Flooded area ([\d.]+)%.*?Burning cells (\d+).*?Landslide risk ([\d.]+)/.exec(panel);

console.log(`scenario        ${scenario}`);
console.log(`fps             ${metrics?.[1] ?? "?"}`);
console.log(`flooded area    ${metrics?.[2] ?? "?"}%`);
console.log(`burning cells   ${metrics?.[3] ?? "?"}`);
console.log(`landslide risk  ${metrics?.[4] ?? "?"}`);
console.log(`flicker (worst) ${worst.toFixed(2)}% of pixels`);
console.log(`errors          ${errors.slice(0, 6).join(" | ") || "none"}`);
console.log(`screenshot      ${outDir}/${scenario}.png`);

await browser.close();
