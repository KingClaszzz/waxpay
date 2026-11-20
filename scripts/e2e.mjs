// Real end-to-end check on test wallets from faucet.nwc.dev (fake sats).
import { NWCClient } from "@getalby/sdk/nwc";
import { LightningAddress } from "@getalby/lightning-tools/lnurl";
const mk = async (b) => (await (await fetch(`https://faucet.nwc.dev?balance=${b}`, { method: "POST" })).text()).trim();
const a = new NWCClient({ nostrWalletConnectUrl: await mk(10000) });
const bUrl = await mk(1000);
const b = new NWCClient({ nostrWalletConnectUrl: bUrl });
const lud16 = new URLSearchParams(bUrl.split("?")[1]).get("lud16");
console.log("before", (await a.getBalance()).balance / 1000, (await b.getBalance()).balance / 1000, lud16);
const ln = new LightningAddress(lud16); await ln.fetch();
const inv = await ln.requestInvoice({ satoshi: 2500, comment: "test" });
const t0 = Date.now(); const r = await a.payInvoice({ invoice: inv.paymentRequest });
console.log("paid in", Date.now() - t0, "ms, preimage", r.preimage.slice(0, 16) + "…", "fees", r.fees_paid);
console.log("after", (await a.getBalance()).balance / 1000, (await b.getBalance()).balance / 1000);
a.close(); b.close(); process.exit(0);
