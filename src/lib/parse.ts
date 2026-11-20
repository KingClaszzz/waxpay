export type Unit = "sats" | "xof";
export type Lang = "fr" | "en" | "wo";

export type Command =
  | { kind: "send"; amount: number; unit: Unit; to: string; lang: Lang }
  | { kind: "receive"; amount: number; unit: Unit; lang: Lang }
  | { kind: "balance"; lang: Lang }
  | { kind: "add_contact"; name: string; address: string; lang: Lang }
  | { kind: "help"; lang: Lang }
  | { kind: "unknown"; lang: Lang };

export const MAX_INPUT = 200;

const SEND_FR = ["envoie", "envoyer", "envoyez", "envoi", "paye", "payer", "paie", "payez", "transfere", "transferer"];
const SEND_EN = ["send", "pay", "transfer"];
const SEND_WO = ["yonnee", "yonne", "yobal"];
const RECV_FR = ["recevoir", "facture", "demande", "demander", "reclame"];
const RECV_EN = ["receive", "invoice", "request"];
const BAL_FR = ["solde", "combien"];
const BAL_EN = ["balance"];
const BAL_WO = ["xaalis"];
const ADD_FR = ["ajoute", "ajouter", "enregistre"];
const ADD_EN = ["add", "save"];
const HELP = ["aide", "help"];

const SATS_UNITS = ["sats", "sat", "satoshi", "satoshis"];
const XOF_UNITS = ["f", "fcfa", "cfa", "franc", "francs", "xof"];

const LN_ADDRESS = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Lowercase, strip accents, keep letters/digits/@/./space so "yónnee" == "yonnee". */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9@._+\- ?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Join digit groups like "1 000" or "1.000" or "2k" into a number. */
function readAmount(tokens: string[], start: number): { value: number; end: number } | null {
  let i = start;
  let raw = "";
  while (i < tokens.length && /^\d[\d.,]*k?$/.test(tokens[i])) {
    raw += tokens[i];
    i++;
    if (raw.endsWith("k")) break;
  }
  if (!raw) return null;
  let mult = 1;
  if (raw.endsWith("k")) {
    mult = 1000;
    raw = raw.slice(0, -1);
  }
  // Treat "." and "," as thousand separators: amounts here are whole sats/francs.
  const digits = raw.replace(/[.,]/g, "");
  const value = Number(digits) * mult;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, end: i };
}

function findAmount(tokens: string[]): { value: number; unit: Unit; idx: number[] } | null {
  for (let i = 0; i < tokens.length; i++) {
    const a = readAmount(tokens, i);
    if (!a) continue;
    const used = [];
    for (let j = i; j < a.end; j++) used.push(j);
    let unit: Unit = "sats";
    const next = tokens[a.end];
    if (next && XOF_UNITS.includes(next)) {
      unit = "xof";
      used.push(a.end);
    } else if (next && SATS_UNITS.includes(next)) {
      used.push(a.end);
    }
    return { value: a.value, unit, idx: used };
  }
  return null;
}

const has = (tokens: string[], words: string[]) => tokens.some((t) => words.includes(t));

const FILLER = new Set(["a", "au", "pour", "to", "for", "de", "des", "moi", "me", "stp", "svp", "please", "ci", "ak"]);

export function parseCommand(input: string): Command {
  const text = normalize(input.slice(0, MAX_INPUT));
  const tokens = text.split(" ").filter(Boolean);

  const lang: Lang = has(tokens, [...SEND_WO, ...BAL_WO])
    ? "wo"
    : has(tokens, [...SEND_EN, ...RECV_EN, ...BAL_EN, ...ADD_EN, "help", "to", "my"])
      ? "en"
      : "fr";

  if (tokens.length === 0) return { kind: "unknown", lang };
  if (has(tokens, HELP)) return { kind: "help", lang };

  if (has(tokens, [...ADD_FR, ...ADD_EN])) {
    const address = tokens.find((t) => LN_ADDRESS.test(t));
    const verbIdx = tokens.findIndex((t) => [...ADD_FR, ...ADD_EN].includes(t));
    const name = tokens.slice(verbIdx + 1).find((t) => !LN_ADDRESS.test(t) && !FILLER.has(t) && t !== "contact");
    if (address && name) return { kind: "add_contact", name, address, lang };
    return { kind: "unknown", lang };
  }

  if (has(tokens, [...BAL_FR, ...BAL_EN, ...BAL_WO]) && !findAmount(tokens)) {
    return { kind: "balance", lang };
  }

  const amount = findAmount(tokens);

  if (has(tokens, [...RECV_FR, ...RECV_EN]) && amount) {
    return { kind: "receive", amount: amount.value, unit: amount.unit, lang };
  }

  const sendVerbs = [...SEND_FR, ...SEND_EN, ...SEND_WO];
  if (has(tokens, sendVerbs) && amount) {
    const skip = new Set(amount.idx);
    const rest = tokens.filter((t, i) => !skip.has(i) && !sendVerbs.includes(t) && !FILLER.has(t));
    const to = rest.find((t) => LN_ADDRESS.test(t)) ?? rest[0];
    if (to) return { kind: "send", amount: amount.value, unit: amount.unit, to, lang };
  }

  return { kind: "unknown", lang };
}

export function isLightningAddress(s: string): boolean {
  return LN_ADDRESS.test(s);
}
