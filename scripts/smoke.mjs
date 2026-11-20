// Drives the built app in headless Edge through every main flow, on desktop and mobile.
// Uses test wallets from faucet.nwc.dev (fake sats). Usage: node scripts/smoke.mjs <screenshot-dir>
import { chromium } from "playwright-core";
const out = process.argv[2] ?? ".";
const base = "http://localhost:4173/";
const NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const log = (...a) => console.log(...a);
for (const [name, vp] of [["desktop", { width: 1366, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text().slice(0, 160)}`));
  await page.goto(base);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/${name}-landing.png`, fullPage: name === "desktop" });

  await page.goto(base + "#/app");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-onboard.png` });
  await page.getByRole("button", { name: /Create test wallets/ }).click();
  await page.getByText("Bonjour").waitFor({ timeout: 45000 }).catch(async (e) => { log(name, "ONBOARD:", (await page.locator("main").textContent()).slice(0, 400)); throw e; });
  await page.waitForFunction(() => /\d sats/.test(document.querySelector(".kpis")?.textContent ?? ""), null, { timeout: 30000 });

  // 1. chat payment in FCFA
  await page.fill("#cmd", "Envoie 1 000 francs à Awa");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Confirmer" }).click();
  await page.getByText(/Payé en/).waitFor({ timeout: 45000 }).catch(async (e) => { log(name, "CONFIRM:", (await page.locator(".chat-log").textContent()).slice(-300)); throw e; });
  log(name, "chat pay:", (await page.locator(".confirm .pill.pos").last().textContent()).trim());

  // 1b. free-form sentence read by the AI (desktop only, to limit API calls)
  if (name === "desktop") {
    const t1 = Date.now();
    await page.getByRole("button", { name: /3 poissons/ }).click();
    await page.getByRole("button", { name: "Confirmer" }).waitFor({ timeout: 45000 });
    log(name, "AI:", (await page.locator(".ai-bubble").last().textContent()).trim(), "|", (await page.locator(".confirm .confirm-amount").last().textContent()).trim(), "in", Date.now() - t1, "ms");
    await page.screenshot({ path: `${out}/${name}-ai.png` });
  }

  // 2. invoice with QR via chat
  await page.getByRole("button", { name: "Facture 500 francs" }).click();
  await page.locator(".confirm img[alt^='Lightning invoice']").waitFor({ timeout: 45000 });
  log(name, "invoice QR rendered");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}-app.png`, fullPage: true });

  // 3. merchant mode: 1 500 FCFA, demo payer pays the QR, screen turns to Payé
  await page.getByRole("button", { name: "Encaisser" }).click();
  for (const k of ["1", "5", "0", "0"]) await page.getByRole("button", { name: k, exact: true }).click();
  await page.getByRole("button", { name: /Show QR/ }).click();
  await page.locator(".collect img").waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${out}/${name}-collect-qr.png`, fullPage: true });
  const t0 = Date.now();
  await page.getByRole("button", { name: /Awa paie ce QR/ }).click();
  await page.locator(".paid-screen").waitFor({ timeout: 40000 }).catch(async (e) => { log(name, "COLLECT TEXT:", (await page.locator(".collect").textContent())); throw e; });
  log(name, "collect: paid screen after", Date.now() - t0, "ms:", (await page.locator(".paid-screen .collect-amount").textContent()).trim());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}-collect-paid.png`, fullPage: true });

  // 4. Nostr import (desktop only, to keep relay load light)
  if (name === "desktop") {
    await page.getByRole("button", { name: "Contacts" }).click();
    await page.fill("#nostr-id", NPUB);
    await page.getByRole("button", { name: "Import their follows" }).click();
    await page.getByText(/Added \d+ contacts? from Nostr|No follows|no Nostr/).waitFor({ timeout: 40000 });
    log(name, "nostr:", (await page.locator(".note[role=status]").textContent()).trim());
    await page.screenshot({ path: `${out}/${name}-contacts.png`, fullPage: false });
  }

  // 5. reload keeps the wallet connected and the history
  await page.reload();
  await page.waitForTimeout(500);
  await page.goto(base + "#/app");
  await page.getByRole("button", { name: "Activity" }).click();
  await page.locator(".row").first().waitFor({ timeout: 20000 });
  log(name, "after reload:", await page.locator(".side-foot .pill.pos").count() ? "connected" : "NOT connected", "| activity rows:", await page.locator(".list .row").count());
  log(name, "scrollWidth", await page.evaluate(() => document.documentElement.scrollWidth));
  await ctx.close();
}
log("errors:", errors.length ? errors : "none");
await browser.close();
