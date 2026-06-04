"use client";

import { useEffect, useState } from "react";

type PairingState = "idle" | "loading" | "showing" | "success" | "error";

type Props = {
  deviceSerial: string;
  onPaired?: () => void;
  onClose?: () => void;
};

function formatCountdown(expiresAt: string): string {
  const secs = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DevicePairing({ deviceSerial, onPaired, onClose }: Props) {
  const [state, setState] = useState<PairingState>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function generateCode() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/devices/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceSerial }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to generate code");
      }
      const data = (await res.json()) as { code: string; expiresAt: string };
      setCode(data.code);
      setExpiresAt(data.expiresAt);
      setState("showing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  // countdown ticker
  useEffect(() => {
    if (state !== "showing" || !expiresAt) return;
    const interval = setInterval(() => {
      const remaining = new Date(expiresAt).getTime() - Date.now();
      if (remaining <= 0) {
        clearInterval(interval);
        setCountdown("Expired");
        return;
      }
      setCountdown(formatCountdown(expiresAt));
    }, 1000);
    setCountdown(formatCountdown(expiresAt));
    return () => clearInterval(interval);
  }, [state, expiresAt]);

  // poll for pairing completion
  useEffect(() => {
    if (state !== "showing") return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/devices");
        if (!res.ok) return;
        const data = (await res.json()) as { devices?: { serial: string; tokenHash?: string | null }[] };
        const device = data.devices?.find((d) => d.serial === deviceSerial);
        if (device?.tokenHash) {
          clearInterval(poll);
          setState("success");
          onPaired?.();
        }
      } catch {
        // ignore poll errors
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [state, deviceSerial, onPaired]);

  return (
    <div className="pairingPanel">
      <h3>Pair device</h3>

      {state === "idle" && (
        <>
          <p className="pairingCopy">
            Generate a pairing code and enter it on the device firmware to link it to this account.
          </p>
          <button className="primaryButton" onClick={generateCode}>Generate pairing code</button>
        </>
      )}

      {state === "loading" && (
        <p className="pairingMuted">Generating code...</p>
      )}

      {state === "showing" && code && (
        <>
          <p className="pairingCopy">
            Enter this code on the device within <strong>{countdown}</strong>:
          </p>
          <div className="pairingCode">{code}</div>
          <p className="pairingMuted centered">
            Waiting for device to confirm...
          </p>
          <button className="ghostButton" onClick={generateCode}>Regenerate</button>
        </>
      )}

      {state === "success" && (
        <>
          <p className="pairingSuccess">Device paired successfully!</p>
          <button className="primaryButton" onClick={onClose}>Close</button>
        </>
      )}

      {state === "error" && (
        <>
          <p className="pairingError">{error}</p>
          <button className="primaryButton" onClick={generateCode}>Retry</button>
        </>
      )}

      {onClose && state !== "success" && (
        <button className="ghostButton" onClick={onClose}>Cancel</button>
      )}
    </div>
  );
}
