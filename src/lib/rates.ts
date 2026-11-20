/** The CFA franc (XOF) is pegged to the euro by the BCEAO at a fixed rate. */
export const XOF_PER_EUR = 655.957;

export type Rate = { btcEur: number; xofPerSat: number; fetchedAt: number };

export async function fetchRate(): Promise<Rate> {
  const res = await fetch("https://mempool.space/api/v1/prices");
  if (!res.ok) throw new Error(`price feed ${res.status}`);
  const data = (await res.json()) as { EUR?: number };
  if (!data.EUR || data.EUR <= 0) throw new Error("price feed returned no EUR price");
  return rateFromBtcEur(data.EUR);
}

export function rateFromBtcEur(btcEur: number): Rate {
  return { btcEur, xofPerSat: (btcEur * XOF_PER_EUR) / 100_000_000, fetchedAt: Date.now() };
}

export const xofToSats = (xof: number, r: Rate) => Math.max(1, Math.round(xof / r.xofPerSat));
export const satsToXof = (sats: number, r: Rate) => Math.round(sats * r.xofPerSat);

const nf = new Intl.NumberFormat("fr-FR");
export const fmtSats = (n: number) => `${nf.format(n)} sats`;
export const fmtXof = (n: number) => `${nf.format(n)} FCFA`;
