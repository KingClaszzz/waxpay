import type { Command, Lang } from "./parse";

export type AiResult = Command & { note?: string };

/** Asks the server-side AI to read a free-form sentence. Throws if the AI is unreachable. */
export async function askAi(text: string, contacts: string[]): Promise<AiResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 300), contacts: contacts.slice(0, 200) }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `AI ${res.status}`);
    const lang = (data.lang === "en" || data.lang === "wo" ? data.lang : "fr") as Lang;
    const note = typeof data.note === "string" ? data.note : undefined;
    switch (data.kind) {
      case "send":
        return { kind: "send", amount: Number(data.amount), unit: data.unit === "sats" ? "sats" : "xof", to: String(data.to), lang, note };
      case "receive":
        return { kind: "receive", amount: Number(data.amount), unit: data.unit === "sats" ? "sats" : "xof", lang, note };
      case "balance":
      case "help":
        return { kind: data.kind, lang, note };
      default:
        return { kind: "unknown", lang, note };
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Short, unambiguous commands go through the instant rule parser; anything longer or with
 * several numbers goes to the AI, which handles prose, number words and Wolof amounts.
 */
export function needsAi(text: string, ruleKind: Command["kind"]): boolean {
  if (ruleKind === "unknown") return true;
  const words = text.trim().split(/\s+/).length;
  const numberGroups = (text.match(/\d[\d\s.,]*/g) ?? []).length;
  return words > 8 || numberGroups > 1;
}
