// Quick visual check: landing + app onboarding at desktop and mobile widths. Usage: node scripts/shots.mjs <dir>
import { chromium } from "playwright-core";
const out = process.argv[2] ?? ".";
const b = await chromium.launch({ channel: "msedge", headless: true });
for (const [n, vp] of [["desktop", { width: 1366, height: 800 }], ["mobile", { width: 390, height: 760 }]]) {
  for (const scheme of ["light", "dark"]) {
    const p = await b.newPage({ viewport: vp, colorScheme: scheme });
    await p.goto("http://localhost:4173/");
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${n}-${scheme}-landing.png` });
    await p.goto("http://localhost:4173/#/app");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${n}-${scheme}-app.png` });
    await p.close();
  }
}
await b.close();
