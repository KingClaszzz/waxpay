import { SimplePool } from "nostr-tools/pool";
import * as nip19 from "nostr-tools/nip19";
import { queryProfile } from "nostr-tools/nip05";

export const RELAYS = ["wss://purplepag.es", "wss://relay.primal.net", "wss://nos.lol"];

export type NostrProfile = { pubkey: string; name: string; lud16?: string; picture?: string; nip05?: string };

/** Accepts npub, nprofile, 64-hex or a NIP-05 identifier (name@domain). */
export async function resolvePubkey(input: string): Promise<string> {
  const s = input.trim().replace(/^nostr:/i, "");
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (/^(npub|nprofile)1/.test(s)) {
    const d = nip19.decode(s);
    if (d.type === "npub") return d.data;
    if (d.type === "nprofile") return d.data.pubkey;
  }
  if (s.includes("@")) {
    const p = await queryProfile(s);
    if (p?.pubkey) return p.pubkey;
    throw new Error(`no Nostr account found for ${s}`);
  }
  throw new Error("enter an npub or a NIP-05 address like name@domain.com");
}

function parseProfile(pubkey: string, content: string): NostrProfile | null {
  try {
    const m = JSON.parse(content) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const name = str(m.display_name) ?? str(m.name) ?? str(m.displayName) ?? nip19.npubEncode(pubkey).slice(0, 12);
    const lud16 = str(m.lud16);
    return { pubkey, name: name.slice(0, 40), lud16: lud16 && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(lud16) ? lud16.toLowerCase() : undefined, picture: str(m.picture), nip05: str(m.nip05) };
  } catch {
    return null;
  }
}

async function withPool<T>(fn: (pool: SimplePool) => Promise<T>): Promise<T> {
  const pool = new SimplePool();
  try {
    return await fn(pool);
  } finally {
    pool.close(RELAYS);
  }
}

export async function fetchProfiles(pubkeys: string[]): Promise<NostrProfile[]> {
  if (pubkeys.length === 0) return [];
  return withPool(async (pool) => {
    const events = await pool.querySync(RELAYS, { kinds: [0], authors: pubkeys }, { maxWait: 4000 });
    const latest = new Map<string, { created_at: number; content: string }>();
    for (const e of events) {
      const prev = latest.get(e.pubkey);
      if (!prev || e.created_at > prev.created_at) latest.set(e.pubkey, e);
    }
    return [...latest.entries()].map(([pk, e]) => parseProfile(pk, e.content)).filter((p): p is NostrProfile => !!p);
  });
}

/** People the user follows on Nostr who have a Lightning address. */
export async function fetchPayableFollows(pubkey: string, limit = 300): Promise<NostrProfile[]> {
  const follows = await withPool(async (pool) => {
    const ev = await pool.get(RELAYS, { kinds: [3], authors: [pubkey] }, { maxWait: 4000 });
    if (!ev) return [];
    return ev.tags.filter((t) => t[0] === "p" && /^[0-9a-f]{64}$/.test(t[1] ?? "")).map((t) => t[1]).slice(0, limit);
  });
  const profiles: NostrProfile[] = [];
  for (let i = 0; i < follows.length; i += 100) {
    profiles.push(...(await fetchProfiles(follows.slice(i, i + 100))));
  }
  return profiles.filter((p) => p.lud16);
}

/** Short, chat-friendly contact name: "Awa Ndiaye" -> "awa". */
const SKIP = new Set(["the", "a", "an", "not", "mr", "mrs", "dr", "le", "la", "les", "el", "il", "just", "its", "it", "i", "im"]);

export function contactKey(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ._-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const pick = words.find((w) => !SKIP.has(w) && w.length > 1) ?? words[0];
  return (pick || "nostr").slice(0, 24);
}
