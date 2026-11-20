import { useEffect, useState } from "react";
import { Arrow, Bolt, Logo } from "./ui";

const SCRIPT = "Envoie 1 000 francs à Awa";

function DemoCard() {
  // 0..n typing, then confirm card, then paid receipt, then loop.
  const [step, setStep] = useState(0);
  const typed = SCRIPT.slice(0, Math.min(step, SCRIPT.length));
  const phase = step <= SCRIPT.length ? "typing" : step < SCRIPT.length + 30 ? "confirm" : step < SCRIPT.length + 70 ? "paid" : "reset";

  useEffect(() => {
    if (phase === "reset") {
      const t = setTimeout(() => setStep(0), 300);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), phase === "typing" ? 70 : 60);
    return () => clearTimeout(t);
  }, [step, phase]);

  return (
    <div className="card demo-card" aria-label="Example: paying Awa 1,000 CFA francs by typing a sentence">
      <div className="demo-head">
        <span>Assistant</span>
        <span className="pill pos"><span className="dot" /> Wallet connected</span>
      </div>
      <div className="bubble from-bot">Bonjour 👋 Dites-moi qui payer et combien.</div>
      {typed && (
        <div className="bubble from-user">
          {typed}
          {phase === "typing" && <span className="typing" />}
        </div>
      )}
      {(phase === "confirm" || phase === "paid") && (
        <div className="confirm rise">
          <div className="muted" style={{ fontSize: 13 }}>Payer Awa</div>
          <div className="confirm-amount">1 000 FCFA</div>
          <div className="confirm-row"><span>En sats</span><span className="mono">au taux du jour</span></div>
          <div className="confirm-row"><span>Adresse</span><span className="mono">awa@…</span></div>
          {phase === "confirm" ? (
            <div className="confirm-actions">
              <span className="btn primary sm">Confirmer</span>
              <span className="btn ghost sm">Annuler</span>
            </div>
          ) : (
            <div className="confirm-actions">
              <span className="pill pos rise"><Bolt size={12} /> Payé · reçu Lightning</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <div className="landing">
      <nav className={`lnav ${scrolled ? "scrolled" : ""}`}>
        <div className="wrap lnav-in">
          <Logo />
          <div className="lnav-links">
            <a className="text" href="#how">How it works</a>
            <a className="text" href="#why">Why</a>
            <a className="btn primary sm" href="#/app">Open app <Arrow /></a>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">Lightning · Nostr Wallet Connect · FCFA</div>
            <h1>Pay over Lightning by <em>typing a sentence.</em></h1>
            <p className="lede">
              Type “Envoie 1 000 francs à Awa”. WaxPay reads the amount in CFA francs, converts it to sats at
              the live rate, asks you to confirm, and pays from your own wallet in a few seconds.
            </p>
            <div className="hero-cta">
              <a className="btn primary lg" href="#/app">Try it with a test wallet <Arrow /></a>
              <a className="btn ghost lg" href="#how">How it works</a>
            </div>
            <div className="hero-proof">
              <span>Type, speak or scan</span>
              <span>Amounts in <b>FCFA</b> or <b>sats</b></span>
              <span>Seller mode with live <b>Payé</b></span>
              <span>Pay your Nostr friends by name</span>
            </div>
          </div>
          <DemoCard />
        </div>
      </header>

      <section className="section" id="how">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">How it works</div>
            <h2>Three steps, one sentence.</h2>
            <p>WaxPay is a thin layer on top of a Lightning wallet you already control.</p>
          </div>
          <div className="steps3">
            <div className="card step">
              <div className="step-n">01</div>
              <h3>Connect your wallet</h3>
              <p>Alby, Coinos, Primal or any Nostr Wallet Connect wallet, through one <code>Connect wallet</code> button. Or start with free test wallets holding fake sats.</p>
            </div>
            <div className="card step">
              <div className="step-n">02</div>
              <h3>Say what to pay</h3>
              <p>Type or say <code>Envoie 2 000 F à Moussa</code>, <code>send 500 sats to fatou@…</code> or <code>Yónnee Awa 1000</code>, or scan a QR. FCFA is converted with the fixed euro peg and a live BTC price.</p>
            </div>
            <div className="card step">
              <div className="step-n">03</div>
              <h3>Confirm and it’s paid</h3>
              <p>You see the amount in both units before anything moves. The receipt includes the Lightning preimage as proof of payment.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="why" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Why it matters</div>
            <h2>Built for how people in Dakar already talk about money.</h2>
            <p>People think in francs and send money by name. Lightning wallets ask for invoices, sats and long strings. WaxPay closes that gap.</p>
          </div>
          <div className="bento">
            <div className="card tile wide">
              <div className="big">1 € = 655.957 F</div>
              <h3>CFA francs built in</h3>
              <p>The XOF is pegged to the euro at 655.957. WaxPay uses that fixed rate and a live BTC/EUR price, so “1 000 francs” means the same thing it does at the market.</p>
            </div>
            <div className="card tile">
              <h3>Encaisser: a till for sellers</h3>
              <p>Key in the price in FCFA and show the QR. The screen turns green with “Payé” as soon as the sats arrive, so there's no need to check a phone.</p>
            </div>
            <div className="card tile">
              <h3>Your Nostr friends, payable by name</h3>
              <p>Import the people you follow on Nostr who have a Lightning address. After that, “envoie 500 F à Fatou” just works.</p>
            </div>
            <div className="card tile">
              <h3>Speak or scan</h3>
              <p>Say the payment out loud in French or English, or scan any Lightning QR. Typing is optional.</p>
            </div>
            <div className="card tile">
              <h3>Your keys, your confirmation</h3>
              <p>WaxPay never holds funds and has no server. Every payment needs a tap to confirm and is capped at 50,000 sats.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap">
          <div className="final-in">
            <h2>Send your first sats in a minute.</h2>
            <p>The demo creates two test wallets with fake sats, so you can try it safely.</p>
            <a className="btn primary lg" href="#/app">Open WaxPay <Arrow /></a>
          </div>
        </div>
      </section>

      <footer className="lfoot">
        <div className="wrap lfoot-in">
          <span>WaxPay · built for Dakar Bitcoin Hack 2026</span>
          <span>Open source · Lightning via Nostr Wallet Connect</span>
        </div>
      </footer>
    </div>
  );
}
