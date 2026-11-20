export type Contact = {
  name: string;
  address: string;
  /** Test-wallet connection, only for demo contacts (lets us show their balance). */
  nwc?: string;
  display?: string;
  picture?: string;
  npub?: string;
};
export type Payment = {
  id: string;
  dir: "out" | "in";
  who: string;
  sats: number;
  xof: number;
  at: number;
  preimage?: string;
  feesSats?: number;
};

const KEY = "waxpay:v2";

export type Saved = { contacts: Contact[]; payments: Payment[]; demo?: boolean };

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { contacts: [], payments: [] };
    const s = JSON.parse(raw) as Partial<Saved>;
    return { contacts: Array.isArray(s.contacts) ? s.contacts : [], payments: Array.isArray(s.payments) ? s.payments : [], demo: !!s.demo };
  } catch {
    return { contacts: [], payments: [] };
  }
}

export function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: app keeps working in memory */
  }
}

export function clearAll() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("waxpay:v1");
  } catch {
    /* ignore */
  }
}
