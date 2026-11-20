import { NWCClient } from "@getalby/sdk/nwc";
import { LightningAddress } from "@getalby/lightning-tools/lnurl";
import { Invoice } from "@getalby/lightning-tools/bolt11";

/** Hard cap per payment so a mistyped command can't drain a wallet. */
export const MAX_PAYMENT_SATS = 50_000;

export function isNwcUrl(s: string): boolean {
  return /^nostr\+walletconnect:\/\/[0-9a-f]{64}\?/i.test(s.trim()) && /[?&]secret=[0-9a-f]{64}/i.test(s) && /[?&]relay=/.test(s);
}

export function lud16Of(nwcUrl: string): string | undefined {
  try {
    return new URLSearchParams(nwcUrl.split("?")[1] ?? "").get("lud16") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Alby's public NWC faucet: creates a throwaway test wallet holding fake sats. */
export async function createTestWallet(balanceSats: number): Promise<string> {
  const res = await fetch(`https://faucet.nwc.dev?balance=${balanceSats}`, { method: "POST" });
  if (!res.ok) throw new Error(`faucet ${res.status}`);
  const url = (await res.text()).trim();
  if (!isNwcUrl(url)) throw new Error("faucet returned an unexpected response");
  return url;
}

/** What WaxPay needs from a wallet. Implemented over NWC directly or over any WebLN provider. */
export interface WalletApi {
  label: string;
  balanceSats(): Promise<number | null>;
  payInvoice(invoice: string): Promise<{ preimage: string; feesSats?: number }>;
  makeInvoice(sats: number, memo: string): Promise<string>;
  /** undefined when the wallet can't report invoice status. */
  isPaid?: (invoice: string) => Promise<boolean>;
}

type NwcLike = Pick<NWCClient, "getBalance" | "payInvoice" | "makeInvoice" | "lookupInvoice">;

function fromNwcClient(client: NwcLike, label: string): WalletApi {
  return {
    label,
    async balanceSats() {
      return Math.floor((await client.getBalance()).balance / 1000);
    },
    async payInvoice(invoice) {
      const r = await client.payInvoice({ invoice });
      return { preimage: r.preimage, feesSats: Math.ceil((r.fees_paid ?? 0) / 1000) };
    },
    async makeInvoice(sats, memo) {
      return (await client.makeInvoice({ amount: sats * 1000, description: memo.slice(0, 100) })).invoice;
    },
    async isPaid(invoice) {
      const tx = await client.lookupInvoice({ invoice });
      return tx.state === "settled" || !!tx.settled_at;
    },
  };
}

export class NwcWallet {
  readonly client: NWCClient;
  readonly api: WalletApi;
  readonly lud16?: string;
  constructor(nwcUrl: string) {
    this.client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
    this.lud16 = lud16Of(nwcUrl);
    this.api = fromNwcClient(this.client, this.lud16 ?? "NWC wallet");
  }
  close() {
    this.client.close();
  }
}

/** Minimal WebLN surface (Bitcoin Connect gives us one of these for every connector). */
export type WebLNLike = {
  enable?: () => Promise<void>;
  getBalance?: () => Promise<{ balance: number }>;
  sendPayment: (invoice: string) => Promise<{ preimage: string }>;
  makeInvoice: (args: { amount: number; defaultMemo?: string }) => Promise<{ paymentRequest: string }>;
  getInfo?: () => Promise<{ node?: { alias?: string } }>;
  client?: NwcLike & { lud16?: string };
};

export function fromWebLN(p: WebLNLike): WalletApi {
  // NWC connections expose the underlying client: use it for fees and invoice status.
  if (p.client && typeof p.client.lookupInvoice === "function") {
    return fromNwcClient(p.client, p.client.lud16 ?? "Nostr Wallet Connect");
  }
  return {
    label: "Browser wallet",
    async balanceSats() {
      if (!p.getBalance) return null;
      return Math.floor((await p.getBalance()).balance);
    },
    async payInvoice(invoice) {
      return { preimage: (await p.sendPayment(invoice)).preimage };
    },
    async makeInvoice(sats, memo) {
      return (await p.makeInvoice({ amount: sats, defaultMemo: memo.slice(0, 100) })).paymentRequest;
    },
  };
}

export function decodeInvoice(pr: string): { sats: number; description?: string; expired: boolean } {
  const inv = new Invoice({ pr });
  return { sats: inv.satoshi, description: inv.description ?? undefined, expired: inv.hasExpired() };
}

/** Strip "lightning:" URI prefix and whitespace from a scanned or pasted payment string. */
export function cleanPaymentString(s: string): string {
  return s.trim().replace(/^lightning:/i, "").trim();
}

export function isBolt11(s: string): boolean {
  return /^ln(bc|tb|bcrt)[0-9a-z]+$/i.test(s);
}

export async function invoiceForAddress(address: string, sats: number, comment?: string): Promise<string> {
  if (!Number.isInteger(sats) || sats < 1 || sats > MAX_PAYMENT_SATS) {
    throw new Error(`amount must be 1–${MAX_PAYMENT_SATS} sats`);
  }
  const ln = new LightningAddress(address);
  await ln.fetch();
  if (!ln.lnurlpData) throw new Error(`${address} is not a reachable Lightning address`);
  const inv = await ln.requestInvoice({ satoshi: sats, comment: comment?.slice(0, 100) });
  if (inv.satoshi !== sats) throw new Error("invoice amount does not match");
  return inv.paymentRequest;
}

export async function payAddress(w: WalletApi, address: string, sats: number, comment?: string) {
  const invoice = await invoiceForAddress(address, sats, comment);
  return { ...(await w.payInvoice(invoice)), invoice };
}

export async function payBolt11(w: WalletApi, invoice: string) {
  const d = decodeInvoice(invoice);
  if (d.expired) throw new Error("invoice has expired");
  if (d.sats < 1) throw new Error("invoices without an amount aren't supported");
  if (d.sats > MAX_PAYMENT_SATS) throw new Error(`amount above the ${MAX_PAYMENT_SATS} sat limit`);
  return { ...(await w.payInvoice(invoice)), invoice };
}
