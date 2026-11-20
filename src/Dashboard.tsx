import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { connectNWC, disconnect as bcDisconnect, init as bcInit, isConnected, launchModal, onConnected, onConnecting, onDisconnected, requestProvider } from "@getalby/bitcoin-connect";
import { isLightningAddress, parseCommand, type Command, type Lang, MAX_INPUT } from "./lib/parse";
import { fetchRate, fmtSats, fmtXof, satsToXof, xofToSats, type Rate } from "./lib/rates";
import { clearAll, load, save, type Contact, type Payment, type Saved } from "./lib/store";
import {
  cleanPaymentString, createTestWallet, decodeInvoice, fromWebLN, invoiceForAddress, isBolt11, lud16Of, MAX_PAYMENT_SATS,
  NwcWallet, payBolt11, type WalletApi, type WebLNLike,
} from "./lib/wallet";
import { contactKey, fetchPayableFollows, fetchProfiles, resolvePubkey } from "./lib/nostr";
import { askAi, needsAi } from "./lib/ai";
import { QR, Scanner, useVoice } from "./features";
import { Bolt, Icon, Logo } from "./ui";

bcInit({ appName: "WaxPay", showBalance: false });

type ConfirmCard = {
  type: "confirm";
  name: string;
  address?: string;
  invoice?: string;
  memo?: string;
  sats: number;
  xof: number;
  status: "pending" | "paying" | "paid" | "cancelled" | "error";
  stage?: "invoice" | "pay";
  ms?: number;
  preimage?: string;
  feesSats?: number;
  error?: string;
};
type InvoiceCard = { type: "invoice"; invoice: string; sats: number; xof: number };
type Msg = { id: number; from: "user" | "bot"; lang: Lang; text?: string; card?: ConfirmCard | InvoiceCard; thinking?: boolean; ai?: boolean };
type View = "assistant" | "collect" | "contacts" | "activity";

const tr = (lang: Lang, fr: string, en: string) => (lang === "en" ? en : fr);
const SUGGESTIONS = ["Envoie 1 000 francs à Awa", "Awa m'a vendu 3 poissons à 500 F chacun, paie-la", "Yónnee Awa ñaar junni", "Mon solde", "Facture 500 francs"];
let nextId = 1;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ------------------------------------------------------------------ */

function Onboarding({ onDemo, connecting }: { onDemo: (mine: string, awa: string) => void; connecting: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function startDemo() {
    setBusy(true);
    setErr("");
    try {
      const [mine, awa] = await Promise.all([createTestWallet(10_000), createTestWallet(10_000)]);
      if (!lud16Of(awa)) throw new Error("test wallet has no Lightning address");
      onDemo(mine, awa);
    } catch (e) {
      setErr(`Could not create test wallets: ${errText(e)}`);
      setBusy(false);
    }
  }

  return (
    <div className="card onboard rise">
      <div className="eyebrow">Get started</div>
      <h1>Connect a Lightning wallet</h1>
      <p>WaxPay never holds your money. It asks your wallet to pay, and you confirm each payment here first.</p>

      <div className="option">
        <h3>Connect your wallet</h3>
        <p className="muted">Alby extension, Alby Hub, Coinos, Primal, or any wallet that supports Nostr Wallet Connect.</p>
        <button className="btn primary" onClick={() => launchModal()} disabled={busy || connecting}>
          <Bolt size={14} /> {connecting ? "Connecting…" : "Connect wallet"}
        </button>
        <div className="note">Tip: when your wallet asks, set a small spending budget for WaxPay. You can revoke it there at any time.</div>
      </div>

      <div className="option">
        <h3>Or try it with test wallets</h3>
        <p className="muted">Creates two throwaway wallets with fake sats: yours (10,000 sats) and a contact named Awa (10,000 sats).</p>
        <button className="btn ghost" onClick={startDemo} disabled={busy || connecting}>
          {busy ? "Creating wallets…" : "Create test wallets"}
        </button>
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Collect({ api, rate, demoPayer, onPaid }: { api: WalletApi; rate: Rate | null; demoPayer?: Contact; onPaid: (p: Payment) => void }) {
  const [digits, setDigits] = useState("");
  const [inv, setInv] = useState<{ pr: string; sats: number; xof: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "creating" | "waiting" | "paid" | "error">("idle");
  const [err, setErr] = useState("");
  const [simBusy, setSimBusy] = useState(false);
  const xof = Number(digits || "0");
  const sats = rate && xof > 0 ? xofToSats(xof, rate) : 0;

  const press = (k: string) => {
    if (k === "⌫") return setDigits((d) => d.slice(0, -1));
    setDigits((d) => (d + k).replace(/^0+/, "").slice(0, 8));
  };

  async function create() {
    if (!sats) return;
    setStatus("creating");
    setErr("");
    try {
      const pr = await api.makeInvoice(sats, `WaxPay · ${xof} FCFA`);
      setInv({ pr, sats, xof });
      setStatus("waiting");
    } catch (e) {
      setErr(errText(e));
      setStatus("error");
    }
  }

  // Poll the wallet until the invoice is settled.
  useEffect(() => {
    if (status !== "waiting" || !inv || !api.isPaid) return;
    let alive = true;
    const started = Date.now();
    const loop = async () => {
      while (alive && Date.now() - started < 10 * 60_000) {
        try {
          if (await api.isPaid!(inv.pr)) {
            if (!alive) return;
            setStatus("paid");
            onPaid({ id: inv.pr.slice(-16), dir: "in", who: "QR", sats: inv.sats, xof: inv.xof, at: Date.now() });
            return;
          }
        } catch {
          /* transient relay error: keep polling */
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    loop();
    return () => {
      alive = false;
    };
  }, [status, inv, api, onPaid]);

  async function simulate() {
    if (!inv || !demoPayer?.nwc) return;
    setSimBusy(true);
    const w = new NwcWallet(demoPayer.nwc);
    try {
      await w.api.payInvoice(inv.pr);
    } catch (e) {
      setErr(errText(e));
    } finally {
      w.close();
      setSimBusy(false);
    }
  }

  function reset() {
    setDigits("");
    setInv(null);
    setStatus("idle");
    setErr("");
  }

  if (status === "paid" && inv) {
    return (
      <div className="card collect paid-screen rise" role="status">
        <div className="paid-check"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
        <div className="eyebrow" style={{ color: "inherit" }}>Payé · Paid</div>
        <div className="collect-amount">{fmtXof(inv.xof)}</div>
        <div className="muted-inv">{fmtSats(inv.sats)}</div>
        <button className="btn ghost lg" onClick={reset} style={{ marginTop: 20 }}>Nouvelle vente · New sale</button>
      </div>
    );
  }

  if (inv && (status === "waiting" || status === "error")) {
    return (
      <div className="card collect rise">
        <div className="muted" style={{ fontSize: 14 }}>Scannez pour payer · Scan to pay</div>
        <div className="collect-amount">{fmtXof(inv.xof)}</div>
        <div className="muted mono" style={{ marginBottom: 16 }}>{fmtSats(inv.sats)}</div>
        <QR value={inv.pr} label={`Lightning invoice for ${inv.sats} sats`} />
        <div style={{ marginTop: 16 }}>
          {api.isPaid ? (
            <span className="pill warn"><span className="dot pulse" /> En attente du paiement · Waiting for payment</span>
          ) : (
            <span className="pill neg">This wallet can't report payments. Check it in your wallet.</span>
          )}
        </div>
        <div className="collect-actions">
          <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(inv.pr)}><Icon name="copy" size={15} /> Copier · Copy</button>
          {demoPayer?.nwc && (
            <button className="btn ghost sm" onClick={simulate} disabled={simBusy} title="Demo only: pays this QR from Awa's test wallet">
              {simBusy ? "…" : "Démo : Awa paie ce QR"}
            </button>
          )}
          <button className="btn quiet sm" onClick={reset}>Annuler · Cancel</button>
        </div>
        {err && <div className="form-error">{err}</div>}
      </div>
    );
  }

  return (
    <div className="card collect rise">
      <div className="muted" style={{ fontSize: 14 }}>Montant à encaisser · Amount to collect</div>
      <div className="collect-amount" aria-live="polite">{fmtXof(xof)}</div>
      <div className="muted mono" style={{ minHeight: 22 }}>{rate ? (sats ? `≈ ${fmtSats(sats)}` : " ") : "loading rate…"}</div>
      <div className="keypad" role="group" aria-label="Keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "⌫"].map((k) => (
          <button key={k} className="key" onClick={() => press(k)} aria-label={k === "⌫" ? "Delete" : k}>{k}</button>
        ))}
      </div>
      <button className="btn primary lg" style={{ width: "100%" }} onClick={create} disabled={!sats || sats > MAX_PAYMENT_SATS || status === "creating"}>
        {status === "creating" ? "…" : "Afficher le QR · Show QR"}
      </button>
      {sats > MAX_PAYMENT_SATS && <div className="form-error">Max {fmtSats(MAX_PAYMENT_SATS)}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NostrImport({ onAdd }: { onAdd: (c: Contact[]) => void }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run(e: FormEvent, mode: "one" | "follows") {
    e.preventDefault();
    if (!id.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const pk = await resolvePubkey(id);
      const profiles = mode === "one" ? await fetchProfiles([pk]) : await fetchPayableFollows(pk);
      const found = profiles.filter((p) => p.lud16);
      if (found.length === 0) {
        setMsg(mode === "one" ? "This Nostr profile has no Lightning address." : "No follows with a Lightning address were found.");
      } else {
        onAdd(found.map((p) => ({ name: contactKey(p.name), address: p.lud16!, display: p.name, picture: p.picture, npub: p.pubkey })));
        setMsg(`Added ${found.length} contact${found.length === 1 ? "" : "s"} from Nostr.`);
        setId("");
      }
    } catch (e2) {
      setMsg(errText(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <div className="panel-head">Import from Nostr</div>
      <form className="panel-body" onSubmit={(e) => run(e, "one")}>
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Add one person by npub or NIP-05, or import everyone you follow who has a Lightning address. Then pay them by first name.</p>
        <label className="visually-hidden" htmlFor="nostr-id">npub or NIP-05</label>
        <input id="nostr-id" className="text-input" value={id} maxLength={200} onChange={(e) => setId(e.target.value)} placeholder="npub1… or name@domain.com" autoComplete="off" />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn ghost sm" type="submit" disabled={busy || !id.trim()}>Add this person</button>
          <button className="btn ghost sm" type="button" disabled={busy || !id.trim()} onClick={(e) => run(e as unknown as FormEvent, "follows")}>Import their follows</button>
          {busy && <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>Asking Nostr relays…</span>}
        </div>
        {msg && <div className="note" role="status">{msg}</div>}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const [saved, setSaved] = useState<Saved>(() => load());
  const [view, setView] = useState<View>("assistant");
  const [rate, setRate] = useState<Rate | null>(null);
  const [api, setApi] = useState<WalletApi | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [contactBal, setContactBal] = useState<Record<string, number>>({});
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState("");
  const [scan, setScan] = useState(false);
  const [voiceLang, setVoiceLang] = useState<"fr-FR" | "en-US">("fr-FR");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => save(saved), [saved]);

  // Wallet connection via Bitcoin Connect (persists across reloads on its own).
  useEffect(() => {
    const offA = onConnected((p) => {
      setApi(fromWebLN(p as unknown as WebLNLike));
      setConnecting(false);
    });
    const offB = onDisconnected(() => {
      setApi(null);
      setBalance(null);
    });
    const offC = onConnecting(() => setConnecting(true));
    // Already connected before this component mounted (e.g. restored after a reload).
    if (isConnected()) requestProvider().then((p) => setApi(fromWebLN(p as unknown as WebLNLike))).catch(() => {});
    return () => {
      offA();
      offB();
      offC();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const get = () => fetchRate().then((r) => alive && setRate(r)).catch(() => {});
    get();
    const t = setInterval(get, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!api) return;
    api.balanceSats().then(setBalance).catch(() => setBalance(null));
    for (const c of saved.contacts) {
      if (!c.nwc) continue;
      const w = new NwcWallet(c.nwc);
      w.api.balanceSats()
        .then((b) => b !== null && setContactBal((m) => ({ ...m, [c.name]: b })))
        .catch(() => {})
        .finally(() => w.close());
    }
  }, [api, saved.contacts]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    if (api && msgs.length === 0) {
      setMsgs([{ id: nextId++, from: "bot", lang: "fr", text: "Bonjour 👋 Dites-moi qui payer et combien.\nEx. « Envoie 1 000 francs à Awa » · English works too." }]);
    }
  }, [api, msgs.length]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const bot = (lang: Lang, text: string, card?: Msg["card"]) => setMsgs((m) => [...m, { id: nextId++, from: "bot", lang, text, card }]);
  const patchCard = (id: number, patch: Partial<ConfirmCard>) =>
    setMsgs((m) => m.map((x) => (x.id === id && x.card?.type === "confirm" ? { ...x, card: { ...x.card, ...patch } } : x)));

  const addPayment = useCallback((p: Payment) => {
    setSaved((s) => ({ ...s, payments: [p, ...s.payments].slice(0, 200) }));
    setTimeout(() => refreshBalances(), 800);
  }, [refreshBalances]);

  function addContacts(list: Contact[]) {
    setSaved((s) => {
      const map = new Map(s.contacts.map((c) => [c.name, c]));
      for (const c of list) {
        let key = c.name;
        let n = 2;
        while (map.has(key) && map.get(key)!.address !== c.address) key = `${c.name}${n++}`;
        map.set(key, { ...c, name: key });
      }
      return { ...s, contacts: [...map.values()] };
    });
  }

  function toSats(amount: number, unit: "sats" | "xof", lang: Lang): { sats: number; xof: number } | null {
    if (unit === "sats") return { sats: amount, xof: rate ? satsToXof(amount, rate) : 0 };
    if (!rate) {
      bot(lang, tr(lang, "Le taux BTC/FCFA n'est pas encore chargé. Réessayez dans un instant, ou indiquez le montant en sats.", "The BTC/FCFA rate hasn't loaded yet. Try again in a moment, or give the amount in sats."));
      return null;
    }
    return { sats: xofToSats(amount, rate), xof: amount };
  }

  async function resolveRecipient(to: string): Promise<{ name: string; address: string } | null> {
    const contact = saved.contacts.find((c) => c.name === to);
    if (contact) return { name: contact.display ?? contact.name, address: contact.address };
    if (isLightningAddress(to)) return { name: to, address: to };
    if (/^npub1[0-9a-z]+$/.test(to)) {
      const [p] = await fetchProfiles([await resolvePubkey(to)]);
      if (p?.lud16) return { name: p.name, address: p.lud16 };
    }
    return null;
  }

  async function handle(cmd: Command) {
    const { lang } = cmd;
    if (!api) return;
    switch (cmd.kind) {
      case "help":
        return bot(lang, tr(lang,
          "Exemples :\n• Envoie 1 000 francs à Awa\n• Payer 500 sats à fatou@getalby.com\n• Mon solde\n• Facture 2 000 F\n• Ajoute Moussa moussa@getalby.com\nVous pouvez aussi parler 🎤 ou scanner un QR.",
          "Examples:\n• Send 1000 francs to Awa\n• Pay 500 sats to fatou@getalby.com\n• My balance\n• Invoice 2000 F\n• Add Moussa moussa@getalby.com\nYou can also speak 🎤 or scan a QR."));
      case "balance": {
        try {
          const b = await api.balanceSats();
          if (b === null) return bot(lang, tr(lang, "Ce portefeuille ne partage pas son solde.", "This wallet doesn't share its balance."));
          setBalance(b);
          return bot(lang, tr(lang, `Votre solde : ${fmtSats(b)}`, `Your balance: ${fmtSats(b)}`) + (rate ? ` (≈ ${fmtXof(satsToXof(b, rate))})` : ""));
        } catch (e) {
          return bot(lang, tr(lang, "Impossible de joindre le portefeuille : ", "Couldn't reach the wallet: ") + errText(e));
        }
      }
      case "add_contact": {
        addContacts([{ name: cmd.name.slice(0, 24), address: cmd.address }]);
        return bot(lang, tr(lang, `C'est noté : ${cmd.name} → ${cmd.address}`, `Saved: ${cmd.name} → ${cmd.address}`));
      }
      case "receive": {
        const amt = toSats(cmd.amount, cmd.unit, lang);
        if (!amt) return;
        try {
          const invoice = await api.makeInvoice(amt.sats, "WaxPay");
          return bot(lang, tr(lang, "Voici votre facture Lightning :", "Here is your Lightning invoice:"), { type: "invoice", invoice, ...amt });
        } catch (e) {
          return bot(lang, tr(lang, "Le portefeuille n'a pas pu créer la facture : ", "The wallet couldn't create the invoice: ") + errText(e));
        }
      }
      case "send": {
        let r: { name: string; address: string } | null = null;
        try {
          r = await resolveRecipient(cmd.to);
        } catch (e) {
          return bot(lang, errText(e));
        }
        if (!r) {
          return bot(lang, tr(lang,
            `Je ne connais pas « ${cmd.to} ». Ajoutez-le d'abord : « Ajoute ${cmd.to} nom@domaine.com », ou importez vos contacts Nostr.`,
            `I don't know "${cmd.to}" yet. Add them first: "Add ${cmd.to} name@domain.com", or import your Nostr contacts.`));
        }
        const amt = toSats(cmd.amount, cmd.unit, lang);
        if (!amt) return;
        if (amt.sats > MAX_PAYMENT_SATS) {
          return bot(lang, tr(lang, `Montant trop élevé : la limite est de ${fmtSats(MAX_PAYMENT_SATS)} par paiement.`, `Too large: the limit is ${fmtSats(MAX_PAYMENT_SATS)} per payment.`));
        }
        const wolof = lang === "wo" ? " (Wolof bêta)" : "";
        return bot(lang, tr(lang, `Vérifiez avant de payer${wolof} :`, "Check before paying:"), { type: "confirm", ...r, ...amt, status: "pending" });
      }
      default:
        return bot(lang, tr(lang, "Je n'ai pas compris. Essayez « Envoie 1 000 francs à Awa » ou tapez « aide ».", "I didn't get that. Try \"send 500 sats to Awa\" or type \"help\"."));
    }
  }

  async function submit(text: string) {
    const t = text.trim().slice(0, MAX_INPUT);
    if (!t) return;
    // A pasted invoice or Lightning address goes straight to the scan flow.
    const clean = cleanPaymentString(t);
    if (isBolt11(clean)) {
      setInput("");
      return onScanned(clean);
    }
    const cmd = parseCommand(t);
    setMsgs((m) => [...m, { id: nextId++, from: "user", lang: cmd.lang, text: t }]);
    setInput("");
    if (!needsAi(t, cmd.kind)) return handle(cmd);

    // Free-form sentence: let the AI read it, then run the same checks and confirmation.
    const thinkingId = nextId++;
    setMsgs((m) => [...m, { id: thinkingId, from: "bot", lang: cmd.lang, thinking: true }]);
    const drop = () => setMsgs((m) => m.filter((x) => x.id !== thinkingId));
    try {
      const ai = await askAi(t, saved.contacts.map((c) => c.name));
      drop();
      if (ai.kind === "unknown") {
        return setMsgs((m) => [...m, { id: nextId++, from: "bot", lang: ai.lang, ai: true, text: ai.note || tr(ai.lang, "Je n'ai pas compris. Pouvez-vous préciser ?", "I didn't get that. Could you rephrase?") }]);
      }
      if (ai.note) setMsgs((m) => [...m, { id: nextId++, from: "bot", lang: ai.lang, ai: true, text: ai.note }]);
      return handle(ai);
    } catch {
      drop();
      if (cmd.kind !== "unknown") return handle(cmd);
      return bot(cmd.lang, tr(cmd.lang, "L'assistant IA est indisponible. Essayez une phrase courte : « Envoie 1 000 francs à Awa ».", "The AI assistant is unavailable. Try a short command: \"send 500 sats to Awa\"."));
    }
  }

  const voice = useVoice((t) => submit(t));

  const onScanned = useCallback((raw: string) => {
    setScan(false);
    const s = cleanPaymentString(raw);
    if (isBolt11(s)) {
      try {
        const d = decodeInvoice(s);
        if (d.expired) return bot("fr", "Cette facture a expiré. · This invoice has expired.");
        if (d.sats < 1) return bot("fr", "Facture sans montant : non prise en charge. · Invoices without an amount aren't supported.");
        setMsgs((m) => [...m,
          { id: nextId++, from: "user", lang: "fr", text: "📷 QR scanné" },
          { id: nextId++, from: "bot", lang: "fr", text: "Vérifiez avant de payer :", card: { type: "confirm", name: d.description || "Facture Lightning", invoice: s, sats: d.sats, xof: rate ? satsToXof(d.sats, rate) : 0, status: "pending" } }]);
      } catch {
        bot("fr", "QR illisible : ce n'est pas une facture Lightning valide. · Not a valid Lightning invoice.");
      }
      return;
    }
    if (isLightningAddress(s)) {
      setInput(`Envoie 1 000 francs à ${s}`);
      return bot("fr", `Adresse trouvée : ${s}. Modifiez le montant puis envoyez. · Address found: edit the amount and send.`);
    }
    bot("fr", "Ce QR ne contient pas de paiement Lightning. · This QR isn't a Lightning payment.");
  }, [rate]);

  async function confirm(msg: Msg) {
    if (!api || msg.card?.type !== "confirm" || (msg.card.status !== "pending" && msg.card.status !== "error")) return;
    const c = msg.card;
    patchCard(msg.id, { status: "paying", stage: c.invoice ? "pay" : "invoice", error: undefined });
    const t0 = performance.now();
    try {
      let invoice = c.invoice;
      if (!invoice) {
        invoice = await invoiceForAddress(c.address!, c.sats, "WaxPay");
        // Keep the invoice on the card: a retry re-pays this same invoice, which can only settle once.
        patchCard(msg.id, { stage: "pay", invoice });
      }
      const res = await payBolt11(api, invoice);
      const ms = Math.round(performance.now() - t0);
      patchCard(msg.id, { status: "paid", ms, preimage: res.preimage, feesSats: res.feesSats });
      addPayment({ id: res.preimage.slice(0, 16), dir: "out", who: c.name, sats: c.sats, xof: c.xof, at: Date.now(), preimage: res.preimage, feesSats: res.feesSats });
    } catch (e) {
      patchCard(msg.id, { status: "error", error: errText(e) });
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => setToast("Copied"), () => setToast("Copy failed"));
  }

  function disconnect() {
    if (!window.confirm("Disconnect this wallet and clear contacts and history from this browser?")) return;
    bcDisconnect();
    clearAll();
    setSaved({ contacts: [], payments: [] });
    setMsgs([]);
    setApi(null);
    setBalance(null);
    setContactBal({});
  }

  function startDemo(mine: string, awa: string) {
    setSaved((s) => ({ ...s, demo: true, contacts: [{ name: "awa", address: lud16Of(awa)!, nwc: awa }, ...s.contacts.filter((c) => c.name !== "awa")] }));
    connectNWC(mine);
  }

  /* ---------------- render ---------------- */

  const sent = saved.payments.filter((p) => p.dir === "out");
  const received = saved.payments.filter((p) => p.dir === "in");
  const sum = (l: Payment[]) => l.reduce((a, p) => a + p.sats, 0);
  const demoPayer = saved.contacts.find((c) => c.name === "awa" && c.nwc);

  const NAV = [["assistant", "chat", "Assistant"], ["collect", "qr", "Encaisser"], ["contacts", "people", "Contacts"], ["activity", "list", "Activity"]] as const;
  const side = (
    <aside className="side">
      <Logo />
      <nav className="side-nav" aria-label="Sections">
        {NAV.map(([v, icon, label]) => (
          <button key={v} aria-label={label} className={`side-link ${view === v ? "active" : ""}`} onClick={() => setView(v)} aria-current={view === v ? "page" : undefined} disabled={!api}>
            <Icon name={icon} /> <span>{label}</span>
          </button>
        ))}
      </nav>
      {api && (
        <div className="side-foot">
          <span className="pill pos" style={{ alignSelf: "flex-start" }}><span className="dot" /> Wallet connected</span>
          <span className="mono muted" style={{ overflowWrap: "anywhere" }}>{api.label}</span>
          {saved.demo && <span className="pill warn" style={{ alignSelf: "flex-start" }}>Test sats</span>}
          <button className="btn quiet sm" onClick={disconnect}><Icon name="out" size={15} /> Disconnect</button>
        </div>
      )}
    </aside>
  );

  if (!api) {
    return (
      <div className="shell">
        {side}
        <main className="main"><Onboarding onDemo={startDemo} connecting={connecting} /></main>
      </div>
    );
  }

  const kpis = (
    <div className="kpis">
      <div className="card kpi">
        <div className="kpi-label">Balance</div>
        <div className="kpi-value">{balance === null ? "—" : fmtSats(balance)}</div>
        <div className="kpi-foot">{balance !== null && rate ? `≈ ${fmtXof(satsToXof(balance, rate))}` : " "}</div>
      </div>
      <div className="card kpi">
        <div className="kpi-label">Sent · Received</div>
        <div className="kpi-value">{fmtSats(sum(sent))}</div>
        <div className="kpi-foot">{sent.length} sent · {received.length} received ({fmtSats(sum(received))})</div>
      </div>
      <div className="card kpi">
        <div className="kpi-label">1 000 FCFA</div>
        <div className="kpi-value">{rate ? fmtSats(xofToSats(1000, rate)) : "…"}</div>
        <div className="kpi-foot">{rate ? `BTC €${Math.round(rate.btcEur).toLocaleString("fr-FR")} · 1 € = 655,957 F` : "loading live price"}</div>
      </div>
    </div>
  );

  const contactsPanel = (limit?: number) => (
    <div className="card panel">
      <div className="panel-head">Contacts <span className="muted" style={{ fontWeight: 400 }}>{saved.contacts.length}</span></div>
      {saved.contacts.length === 0 ? (
        <div className="empty">No contacts yet. Type “Ajoute Awa awa@getalby.com” or import from Nostr.</div>
      ) : (
        <div className="list">
          {saved.contacts.slice(0, limit).map((c) => (
            <div className="row" key={c.name}>
              <div className="avatar">{c.name[0]}{c.picture && <img src={c.picture} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />}</div>
              <div className="row-main">
                <div style={{ fontWeight: 500 }}><span style={{ textTransform: "capitalize" }}>{c.name}</span>{c.display && c.display.toLowerCase() !== c.name && <span className="muted" style={{ fontWeight: 400 }}> · {c.display}</span>}{c.npub && <span className="pill nostr" title="From Nostr">nostr</span>}</div>
                <div className="sub mono">{c.address}</div>
              </div>
              {c.nwc && contactBal[c.name] !== undefined && <div className="num" title="Test wallet balance">{fmtSats(contactBal[c.name])}</div>}
              <button className="btn quiet sm" onClick={() => { setView("assistant"); setInput(`Envoie 500 francs à ${c.name}`); }}>Pay</button>
            </div>
          ))}
          {limit && saved.contacts.length > limit && <button className="btn quiet sm" style={{ margin: 8 }} onClick={() => setView("contacts")}>See all {saved.contacts.length}</button>}
        </div>
      )}
    </div>
  );

  const activityPanel = (limit?: number) => (
    <div className="card panel">
      <div className="panel-head">Activity</div>
      {saved.payments.length === 0 ? (
        <div className="empty">No payments yet.</div>
      ) : (
        <div className="list">
          {saved.payments.slice(0, limit).map((p) => (
            <div className="row" key={p.id + p.at}>
              <div className={`avatar ${p.dir === "in" ? "in" : ""}`}><Bolt size={14} /></div>
              <div className="row-main">
                <div>{p.dir === "in" ? "Received via QR" : <>To <span style={{ textTransform: "capitalize" }}>{p.who}</span></>}</div>
                <div className="sub">{new Date(p.at).toLocaleString()}{p.dir === "out" ? ` · fee ${p.feesSats ?? 0} sats` : ""}</div>
                {!limit && p.preimage && <div className="sub mono" title="Lightning preimage (proof of payment)">preimage {p.preimage}</div>}
              </div>
              <div>
                <div className={`num ${p.dir === "in" ? "pos" : ""}`}>{p.dir === "in" ? "+" : "−"}{fmtSats(p.sats)}</div>
                {p.xof > 0 && <div className="sub num muted" style={{ fontSize: 12 }}>{fmtXof(p.xof)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const chat = (
    <div className="card panel">
      <div className="panel-head">
        Assistant
        <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>FR · EN · Wolof (beta)</span>
      </div>
      <div className="chat-log" ref={logRef} aria-live="polite">
        {msgs.map((m) => (
          <MsgView key={m.id} m={m} onConfirm={() => confirm(m)} onCancel={() => patchCard(m.id, { status: "cancelled" })} onCopy={copy} />
        ))}
      </div>
      <div className="chat-suggest">
        {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => submit(s)}>{s}</button>)}
      </div>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); submit(input); }}>
        <button type="button" className="btn ghost icon-btn" onClick={() => setScan(true)} aria-label="Scan a QR code" title="Scan a QR code"><Icon name="scan" size={18} /></button>
        {voice.supported && (
          <button type="button" className={`btn ghost icon-btn ${voice.listening ? "rec" : ""}`} onClick={() => (voice.listening ? voice.stop() : voice.start(voiceLang))} aria-label={voice.listening ? "Stop listening" : "Speak a command"} title={`Speak (${voiceLang === "fr-FR" ? "français" : "English"})`}>
            <Icon name="mic" size={18} />
          </button>
        )}
        <label className="visually-hidden" htmlFor="cmd">Payment command</label>
        <input id="cmd" value={input} maxLength={MAX_INPUT} onChange={(e) => setInput(e.target.value)} placeholder={voice.listening ? "Parlez… · Listening…" : "Envoie 1 000 francs à Awa"} autoComplete="off" />
        <button className="btn primary icon-btn" type="submit" aria-label="Send" disabled={!input.trim()}><Icon name="send" size={16} /></button>
      </form>
      {voice.supported && (
        <div className="voice-row">
          <span className="muted">🎤</span>
          {(["fr-FR", "en-US"] as const).map((l) => (
            <button key={l} className={`seg ${voiceLang === l ? "on" : ""}`} onClick={() => setVoiceLang(l)}>{l === "fr-FR" ? "Français" : "English"}</button>
          ))}
          {voice.error && <span className="form-error" style={{ margin: 0 }}>mic: {voice.error}</span>}
        </div>
      )}
    </div>
  );

  const titles: Record<View, [string, string]> = {
    assistant: ["Assistant", "Type or say who to pay, in francs or sats. Or scan a QR."],
    collect: ["Encaisser", "For sellers: enter the price in FCFA, show the QR, and see “Payé” when it lands."],
    contacts: ["Contacts", "People you can pay by name. Import them from Nostr in one click."],
    activity: ["Activity", "Every payment, with its Lightning proof of payment."],
  };

  return (
    <div className="shell">
      {side}
      <main className="main">
        <div className="page-head">
          <div>
            <h1>{titles[view][0]}</h1>
            <p className="page-sub">{titles[view][1]}</p>
          </div>
          <button className="btn ghost sm" onClick={refreshBalances}>Refresh</button>
        </div>
        {view === "assistant" && (
          <>
            {kpis}
            <div className="workspace">
              {chat}
              <div className="stack">
                {contactsPanel(5)}
                {activityPanel(5)}
              </div>
            </div>
          </>
        )}
        {view === "collect" && (
          <div className="workspace">
            <Collect api={api} rate={rate} demoPayer={saved.demo ? demoPayer : undefined} onPaid={addPayment} />
            <div className="stack">{activityPanel(6)}</div>
          </div>
        )}
        {view === "contacts" && (
          <div className="workspace">
            {contactsPanel()}
            <div className="stack"><NostrImport onAdd={addContacts} /></div>
          </div>
        )}
        {view === "activity" && activityPanel()}
      </main>
      {scan && <Scanner fr onResult={onScanned} onClose={() => setScan(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function MsgView({ m, onConfirm, onCancel, onCopy }: { m: Msg; onConfirm: () => void; onCancel: () => void; onCopy: (s: string) => void }) {
  if (m.from === "user") return <div className="bubble from-user rise">{m.text}</div>;
  if (m.thinking) return <div className="bubble from-bot ai-bubble rise" aria-label="AI is reading your message"><span className="ai-tag">IA</span><span className="dots"><i /><i /><i /></span></div>;
  const fr = m.lang !== "en";
  const c = m.card;
  return (
    <>
      {m.text && <div className={`bubble from-bot rise ${m.ai ? "ai-bubble" : ""}`}>{m.ai && <span className="ai-tag" title="Understood by the AI assistant">IA</span>}{m.text}</div>}
      {c?.type === "confirm" && (
        <div className="confirm rise">
          <div className="muted" style={{ fontSize: 13 }}>{fr ? "Payer" : "Pay"} <span style={{ textTransform: c.address ? "capitalize" : "none" }}>{c.name}</span></div>
          <div className="confirm-amount">{c.xof > 0 ? fmtXof(c.xof) : fmtSats(c.sats)}</div>
          {c.xof > 0 && <div className="confirm-row"><span>{fr ? "En sats" : "In sats"}</span><span className="mono">{fmtSats(c.sats)}</span></div>}
          {c.address && <div className="confirm-row"><span>{fr ? "Adresse" : "Address"}</span><span className="mono" style={{ overflowWrap: "anywhere" }}>{c.address}</span></div>}
          {c.invoice && <div className="confirm-row"><span>{fr ? "Facture" : "Invoice"}</span><span className="mono">{c.invoice.slice(0, 18)}…</span></div>}
          {c.status === "pending" && (
            <div className="confirm-actions">
              <button className="btn primary sm" onClick={onConfirm}>{fr ? "Confirmer" : "Confirm"}</button>
              <button className="btn ghost sm" onClick={onCancel}>{fr ? "Annuler" : "Cancel"}</button>
            </div>
          )}
          {c.status === "paying" && (
            <div className="confirm-actions">
              <span className="pill warn"><span className="dot pulse" /> {c.stage === "invoice" ? (fr ? "Demande de la facture…" : "Requesting invoice…") : (fr ? "Paiement via Lightning…" : "Paying over Lightning…")}</span>
            </div>
          )}
          {c.status === "cancelled" && <div className="confirm-actions"><span className="pill neg">{fr ? "Annulé" : "Cancelled"}</span></div>}
          {c.status === "error" && (
            <div className="confirm-actions" style={{ flexWrap: "wrap" }}>
              <span className="pill neg">{fr ? "Échec" : "Failed"}: {c.error}</span>
              <button className="btn ghost sm" onClick={onConfirm}>{fr ? "Réessayer" : "Retry"}</button>
            </div>
          )}
          {c.status === "paid" && (
            <>
              <div className="confirm-actions">
                <span className="pill pos"><Bolt size={12} /> {fr ? "Payé en" : "Paid in"} {((c.ms ?? 0) / 1000).toFixed(2)} s{c.feesSats !== undefined ? ` · ${fr ? "frais" : "fee"} ${c.feesSats} sats` : ""}</span>
              </div>
              <div className="receipt">preimage {c.preimage}</div>
            </>
          )}
        </div>
      )}
      {c?.type === "invoice" && (
        <div className="confirm rise" style={{ textAlign: "center" }}>
          <div className="confirm-amount">{fmtSats(c.sats)}</div>
          {c.xof > 0 && <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>≈ {fmtXof(c.xof)}</div>}
          <div style={{ display: "flex", justifyContent: "center" }}><QR value={c.invoice} size={200} label={`Lightning invoice for ${c.sats} sats`} /></div>
          <div className="confirm-actions" style={{ justifyContent: "center" }}>
            <button className="btn ghost sm" onClick={() => onCopy(c.invoice)}><Icon name="copy" size={15} /> {fr ? "Copier" : "Copy"}</button>
          </div>
        </div>
      )}
    </>
  );
}
