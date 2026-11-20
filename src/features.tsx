import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";

export function QR({ value, size = 240, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    // Uppercase BOLT11 fits QR alphanumeric mode: smaller, easier-to-scan code.
    QRCode.toDataURL(`lightning:${value}`.toUpperCase(), { margin: 1, width: size * 2, errorCorrectionLevel: "M" })
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return (
    <div className="qr" style={{ width: size, height: size }}>
      {src ? <img src={src} width={size} height={size} alt={label} /> : <div className="qr-ph" />}
    </div>
  );
}

/** Camera QR scanner with a paste fallback. Calls onResult once and stops the camera. */
export function Scanner({ onResult, onClose, fr }: { onResult: (text: string) => void; onClose: () => void; fr: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = () => {
      const v = videoRef.current;
      if (done || !v || !ctx) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          done = true;
          onResult(code.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (done) return;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        raf = requestAnimationFrame(tick);
      } catch {
        setErr(fr ? "Caméra indisponible. Collez la facture ci-dessous." : "Camera unavailable. Paste the invoice below.");
      }
    })();

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult, fr]);

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={fr ? "Scanner un QR" : "Scan a QR code"} onClick={onClose}>
      <div className="card sheet rise" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          {fr ? "Scanner pour payer" : "Scan to pay"}
          <button className="btn quiet sm" onClick={onClose}>{fr ? "Fermer" : "Close"}</button>
        </div>
        <div className="panel-body">
          {!err && <video ref={videoRef} className="scan-video" muted playsInline />}
          {err && <p className="muted" style={{ marginTop: 0 }}>{err}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (paste.trim()) onResult(paste.trim());
            }}
            className="chat-form"
            style={{ padding: "12px 0 0", border: 0 }}
          >
            <label className="visually-hidden" htmlFor="paste-inv">Invoice</label>
            <input id="paste-inv" value={paste} maxLength={2000} onChange={(e) => setPaste(e.target.value)} placeholder={fr ? "lnbc… ou nom@domaine.com" : "lnbc… or name@domain.com"} autoComplete="off" />
            <button className="btn primary" type="submit" disabled={!paste.trim()}>OK</button>
          </form>
        </div>
      </div>
    </div>
  );
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognizer(): (new () => SpeechRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Browser speech-to-text. Supported in Chrome/Edge/Safari; hidden elsewhere. */
export function useVoice(onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recRef = useRef<SpeechRec | null>(null);
  const supported = typeof window !== "undefined" && !!getRecognizer();

  function start(lang: string) {
    const R = getRecognizer();
    if (!R) return;
    const rec = new R();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const t = e.results[0]?.[0]?.transcript ?? "";
      if (t) onText(t);
    };
    rec.onerror = (e) => setError(e.error);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setError("");
    setListening(true);
    rec.start();
  }

  function stop() {
    recRef.current?.stop();
  }

  useEffect(() => () => recRef.current?.stop(), []);
  return { supported, listening, error, start, stop };
}
