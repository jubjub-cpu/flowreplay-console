import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const port = Number(process.env.FLOWREPLAY_TEST_PORT || 4197);
const deployed = process.env.FLOWREPLAY_BASE_URL?.trim();
const base = deployed ? `${deployed.replace(/\/$/, "")}/` : `http://127.0.0.1:${port}/`;
const target = process.env.PLAYWRIGHT_MODULE || "playwright";
const specifier = /^[A-Za-z]:[\\/]/.test(target) ? pathToFileURL(target).href : target;
const { chromium } = await import(specifier);
const desktopShot = fileURLToPath(new URL("../docs/screenshots/flowreplay-console-desktop.png", import.meta.url));
const mobileShot = fileURLToPath(new URL("../docs/screenshots/flowreplay-console-mobile.png", import.meta.url));
const importPath = fileURLToPath(new URL("../data/sample-import.json", import.meta.url));
const server = deployed ? null : spawn(process.execPath, ["tools/static-server.mjs", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

async function ready() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("FlowReplay server did not start");
}

async function recoverDeadLetter(page) {
  await page.locator('[data-event="evt_1046"]').click();
  assert.match(await page.locator("#selected-status").innerText(), /dead letter/i);
  await page.getByRole("tab", { name: "Contract" }).click();
  assert.match(await page.locator(".contract-summary").innerText(), /preflight passed/i);
  await page.getByRole("tab", { name: "Attempts" }).click();
  assert.equal(await page.locator(".attempt-list li").count(), 3);
  await page.locator("#build-plan").click();
  assert.match(await page.locator(".plan-summary").innerText(), /delivered/i);
  assert.equal(await page.locator("#approve-replay").isEnabled(), false);
  await page.locator("#recovery-reason").fill("Endpoint owner confirmed the synthetic recovery window.");
  assert.equal(await page.locator("#approve-replay").isEnabled(), true);
  await page.locator("#approve-replay").click();
  assert.match(await page.locator("#selected-status").innerText(), /delivered/i);
  assert.match(await page.locator("#audit-list").innerText(), /Replay approved/);
}

let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await desktop.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => failed.push(request.url()));
  await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(await page.locator("[data-event]").count(), 10);
  assert.equal(await page.locator("#contract-registry tbody tr").count(), 6);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("skip-link")), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => location.hash), "#workspace");
  await recoverDeadLetter(page);
  assert.equal(await page.locator("[data-event]").count(), 11);

  await page.locator('[data-event="evt_1042"]').click();
  await page.locator("#build-plan").click();
  assert.match(await page.locator(".plan-summary").innerText(), /duplicate blocked/i);
  assert.match(await page.locator(".http-preview").innerText(), /0 side effect/);

  await page.locator('[data-event="evt_1049"]').click();
  await page.locator("#build-plan").click();
  assert.match(await page.locator(".plan-summary").innerText(), /contract failed/i);
  assert.equal(await page.locator("#approve-replay").isEnabled(), false);

  const chartPixels = await page.locator("#event-timeline").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 80) if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) count += 1;
    return count;
  });
  assert.ok(chartPixels > 80);

  const download = page.waitForEvent("download");
  await page.locator("#export-report").click();
  assert.match((await download).suggestedFilename(), /flowreplay-evidence\.json$/);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: desktopShot, fullPage: true });

  await page.locator("#event-import").setInputFiles(importPath);
  await page.locator('[data-event="evt_import_01"]').waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-event]").count(), 12);
  assert.match(await page.locator("#audit-list").innerText(), /Event imported/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base, { waitUntil: "networkidle" });
  await recoverDeadLetter(mobilePage);
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await mobilePage.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await mobilePage.screenshot({ path: mobileShot, fullPage: true });
  await mobile.close();

  const errorContext = await browser.newContext();
  const errorPage = await errorContext.newPage();
  await errorPage.route("**/data/events.json", (route) => route.abort());
  await errorPage.goto(base, { waitUntil: "domcontentloaded" });
  await errorPage.getByRole("heading", { name: "The synthetic event workspace could not be loaded." }).waitFor({ state: "visible" });
  assert.equal(await errorPage.getByRole("button", { name: "Retry" }).isVisible(), true);
  await errorContext.close();

  console.log("FLOWREPLAY BROWSER TESTS PASSED");
  console.log(JSON.stringify({ target: deployed ? "deployed" : "local", events: 10, contracts: 6, recovery: true, idempotentNoOp: true, contractBlock: true, jsonImport: true, jsonExport: true, canvas: true, keyboard: true, desktopOverflow: false, mobileOverflow: false, consoleErrors: 0, failedRequests: 0 }));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
