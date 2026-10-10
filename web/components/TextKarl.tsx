"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

// There is no single Karl number: Photon gives each person their own Karl line, and
// phones that haven't signed up are blocked. So the QR opens the sign-up page, which
// adds the person and shows "text karl at <their number>".
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://karl-production.up.railway.app";
const SIGNUP_URL = `${API_URL}/signup`;

export default function TextKarl() {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(SIGNUP_URL, { margin: 1, width: 440 })
      .then(setQr)
      .catch(() => setQr(null));
  }, []);

  return (
    <div className="text-karl">
      <h2>Text Karl</h2>
      <div className="phone">
        <a href={SIGNUP_URL}>get your karl number →</a>
      </div>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="qr" src={qr} alt="QR code to sign up for Karl" width={160} height={160} />
      ) : (
        <div className="qr qr-empty" />
      )}
      <p className="muted">scan to get your karl number. then send a photo to sell, or say what you need.</p>
    </div>
  );
}
