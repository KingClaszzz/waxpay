// Records the demo video: drives the real app (test wallets, fake sats) scene by scene,
// timed to the narration. Usage:
//   node scripts/record-demo.mjs <scenes.timed.json> <out-dir> [base-url]
// Writes <out-dir>/screen.webm and <out-dir>/timeline.json (scene start offsets in seconds).
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [scenesPath, outDir, base = "http://localhost:4173/"] = process.argv.slice(2);
const scenes = Object.fromEntries(JSON.parse(readFileSync(scenesPath, "utf8")).map((s) => [s.id, s]));
const NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m"; // a public account
const W = 1600, H = 900, GAP = 0.6;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: outDir, size: { width: W, height: H } } });

// Visible cursor + click ripple (headless recordings have no pointer).
await ctx.addInitScript(() => {
  const install = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.9L4 20z" fill="#14120f" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-100px,-100px)" });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`), true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 18 + "px", top: e.clientY - 18 + "px", width: "36px", height: "36px", borderRadius: "50%", border: "3px solid #0b52d6", zIndex: "2147483646", pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
});

const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const sleep = (s) => page.waitForTimeout(Math.max(0, s * 1000));
const timeline = [];
const slow = [];
let pos = { x: W / 2, y: H / 2 };

async function moveTo(locator, { dx = 0.5, dy = 0.5 } = {}) {
  await locator.waitFor({ state: "visible", timeout: 60000 });
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const x = b.x + b.width * dx, y = b.y + b.height * dy;
  await page.mouse.move(x, y, { steps: 22 });
  pos = { x, y };
}
async function click(locator, opts) {
  await moveTo(locator, opts);
  await sleep(0.25);
  await page.mouse.down();
  await sleep(0.08);
  await page.mouse.up();
}
/** Runs a scene; `at(s)` waits until s seconds into the scene's narration. */
async function scene(id, fn) {
  const start = now();
  timeline.push({ id, start });
  const at = (s) => sleep(start + s - now());
  await fn(at);
  await at(scenes[id].duration + GAP);
  // Scenes where the screen must keep pace with the narration (waiting at the end is cut in editing).
  const strict = ["intro", "problem", "pay", "ai", "collect", "security", "outro"];
  if (strict.includes(id) && now() - start > scenes[id].duration + GAP + 4) slow.push(id);
  console.log(`${id.padEnd(9)} start ${start.toFixed(1)}s  took ${(now() - start).toFixed(1)}s  (voice ${scenes[id].duration}s)`);
}

const card = (inner) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#f6f5f1;color:#14120f;font-family:Geist,system-ui,sans-serif}
body{display:grid;place-items:center;text-align:center}.w{display:flex;flex-direction:column;align-items:center;gap:22px}
img{height:96px}.t{font-size:34px;font-weight:500;letter-spacing:-.02em;max-width:900px;line-height:1.25}
.m{font-family:'Geist Mono',monospace;font-size:20px;color:#6e6a5f}.u{font-family:'Geist Mono',monospace;font-size:26px;color:#0b52d6}
.s{font-size:15px;color:#9a958a;margin-top:30px}</style></head><body><div class="w">${inner}</div></body></html>`;
const logo = `<img src="${base}brand/wordmark.png" alt="WaxPay">`;

// ---------------------------------------------------------------- scenes
// Pre-roll: the recorder's first seconds come out grey/blank, so warm up and cut this part in editing.
await page.goto(base, { waitUntil: "networkidle" });
await sleep(2.5);
await page.setContent(card(`${logo}<div class="t">Lightning payments by sentence,<br>in CFA francs.</div><div class="m">Dakar Bitcoin Hack 2026</div>`), { waitUntil: "networkidle" });
await sleep(1.5);

await scene("intro", async () => {
  await page.setContent(card(`${logo}<div class="t">Lightning payments by sentence,<br>in CFA francs.</div><div class="m">Dakar Bitcoin Hack 2026</div>`), { waitUntil: "networkidle" });
});

await scene("problem", async (at) => {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.mouse.move(700, 420, { steps: 10 });
  await at(6.5);
  for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 95); await sleep(0.05); }
  await at(9.5);
  await page.locator("#why").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById("why").scrollIntoView({ behavior: "smooth", block: "start" }));
  await moveTo(page.locator(".tile.wide"));
});

await scene("connect", async (at) => {
  await page.goto(base + "#/app", { waitUntil: "networkidle" });
  // Recording only: a slightly shorter chat log so the whole dashboard fits in 900px.
  await page.addStyleTag({ content: ".chat-log{height:360px!important}" });
  await moveTo(page.getByRole("button", { name: "Connect wallet" }));
  await at(7.2);
  await click(page.getByRole("button", { name: /Create test wallets/ }));
  await page.getByText("Bonjour").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => /\d sats/.test(document.querySelector(".kpis")?.textContent ?? ""), null, { timeout: 60000 });
});

await scene("pay", async (at) => {
  await click(page.locator("#cmd"));
  await page.locator("#cmd").pressSequentially("Envoie 1 000 francs à Awa", { delay: 55 });
  await at(2.6);
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("button", { name: "Confirmer" }).last();
  await moveTo(page.locator(".confirm").last(), { dx: 0.6, dy: 0.35 });
  await at(11.6);
  await click(confirm);
  await page.getByText(/Payé en/).last().waitFor({ timeout: 60000 });
  await moveTo(page.locator(".receipt").last(), { dx: 0.3 });
});

await scene("ai", async (at) => {
  await at(1.5);
  await click(page.getByRole("button", { name: /3 poissons/ }));
  const confirm = page.locator(".confirm").last().getByRole("button", { name: "Confirmer" });
  await confirm.waitFor({ timeout: 60000 }).catch(async (e) => {
    console.log("AI scene chat:", (await page.locator(".chat-log").textContent()).slice(-300));
    throw e;
  });
  await moveTo(page.locator(".ai-bubble").last());
  await at(13.5);
  await click(confirm);
  await page.locator(".confirm").last().getByText(/Payé en/).waitFor({ timeout: 60000 });
});

await scene("collect", async (at) => {
  await click(page.getByRole("button", { name: "Encaisser" }));
  await at(2.5);
  for (const k of ["1", "5", "0", "0"]) { await click(page.getByRole("button", { name: k, exact: true })); await sleep(0.15); }
  await click(page.getByRole("button", { name: /Show QR/ }));
  await page.locator(".collect img").waitFor({ timeout: 60000 });
  await moveTo(page.locator(".collect img"));
  await at(8.0);
  await click(page.getByRole("button", { name: /Awa paie ce QR/ }));
  await page.locator(".paid-screen").waitFor({ timeout: 60000 });
  await moveTo(page.locator(".paid-screen .collect-amount"));
});

await scene("nostr", async () => {
  await click(page.getByRole("button", { name: "Contacts" }));
  await click(page.locator("#nostr-id"));
  await page.locator("#nostr-id").pressSequentially(NPUB, { delay: 8 });
  await click(page.getByRole("button", { name: "Import their follows" }));
  await page.getByText(/Added \d+ contacts? from Nostr/).waitFor({ timeout: 60000 });
  await moveTo(page.locator(".list .row").nth(3));
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 110); await sleep(0.12); }
});

await scene("security", async (at) => {
  await page.mouse.wheel(0, -3000);
  await click(page.getByRole("button", { name: "Activity" }));
  await moveTo(page.locator(".list .row").first(), { dx: 0.4 });
  await at(5);
  await moveTo(page.locator(".list .row").nth(1), { dx: 0.4 });
  await at(9);
  await moveTo(page.locator(".side-foot"));
});

await scene("outro", async () => {
  await page.setContent(card(`${logo}<div class="t">Try it with free test wallets.</div><div class="u">github.com/KingClaszzz/waxpay</div><div class="s">Demo uses test wallets with fake sats · Narration: synthetic voice</div>`), { waitUntil: "networkidle" });
});

// ---------------------------------------------------------------- save
const video = page.video();
await ctx.close();
renameSync(await video.path(), join(outDir, "screen.webm"));
writeFileSync(join(outDir, "timeline.json"), JSON.stringify({ total: now(), preroll: timeline[0].start, scenes: timeline, slow }, null, 1));
await browser.close();
console.log("total", now().toFixed(1), "s", slow.length ? `SLOW: ${slow.join(", ")}` : "");
if (slow.length) process.exit(3);
