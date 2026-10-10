"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

const NUMBER = process.env.NEXT_PUBLIC_KARL_NUMBER;
// iOS wants "sms:+19195551234&body=..." (digits and + only; spaces/dashes break some scanners).
// Karl is iMessage-only, so we use the iOS form.
const SMS_URL = NUMBER ? `sms:${NUMBER.replace(/[^\d+]/g, "")}&body=hi%20karl` : null;

export default function TextKarl() {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!SMS_URL) return;
    QRCode.toDataURL(SMS_URL, { margin: 1, width: 440 })
      .then(setQr)
      .catch(() => setQr(null));
  }, []);

  return (
    <div className="text-karl">
      <h2>Text Karl</h2>
      <div className="phone">{SMS_URL ? <a href={SMS_URL}>{NUMBER}</a> : "(coming soon)"}</div>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="qr" src={qr} alt="QR code to text Karl" width={160} height={160} />
      ) : (
        <div className="qr qr-empty">QR soon</div>
      )}
      <p className="muted">Send a photo to sell. Say what you need to buy.</p>
    </div>
  );
}
