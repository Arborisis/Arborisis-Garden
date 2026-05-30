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

  const panelStyle: React.CSSProperties = {
    background: "var(--surface-raised)",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--radius-lg, 12px)",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    maxWidth: 360,
  };

  const codeStyle: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: "2.5rem",
    fontWeight: 700,
    letterSpacing: "0.3em",
    color: "var(--leaf)",
    textAlign: "center",
    padding: "16px",
    background: "var(--surface)",
    borderRadius: "var(--radius-md, 8px)",
    border: "1px solid var(--line)",
    userSelect: "all",
  };

  const btnStyle: React.CSSProperties = {
    background: "var(--leaf)",
    color: "#000",
    border: "none",
    borderRadius: "var(--radius-sm, 6px)",
    padding: "10px 20px",
    fontWeight: 600,
    cursor: "pointer",
  };

  const ghostStyle: React.CSSProperties = {
    background: "transparent",
    color: "var(--ink-2)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-sm, 6px)",
    padding: "10px 20px",
    cursor: "pointer",
  };

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: 0, color: "var(--ink)", fontSize: "1.1rem" }}>Pair device</h3>

      {state === "idle" && (
        <>
          <p style={{ color: "var(--ink-2)", margin: 0, fontSize: "0.9rem" }}>
            Generate a pairing code and enter it on the device firmware to link it to this account.
          </p>
          <button style={btnStyle} onClick={generateCode}>Generate pairing code</button>
        </>
      )}

      {state === "loading" && (
        <p style={{ color: "var(--muted)", margin: 0 }}>Generating code…</p>
      )}

      {state === "showing" && code && (
        <>
          <p style={{ color: "var(--ink-2)", margin: 0, fontSize: "0.9rem" }}>
            Enter this code on the device within <strong style={{ color: "var(--sun)" }}>{countdown}</strong>:
          </p>
          <div style={codeStyle}>{code}</div>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.8rem", textAlign: "center" }}>
            Waiting for device to confirm…
          </p>
          <button style={ghostStyle} onClick={generateCode}>Regenerate</button>
        </>
      )}

      {state === "success" && (
        <>
          <p style={{ color: "var(--leaf)", margin: 0, fontWeight: 600 }}>Device paired successfully!</p>
          <button style={btnStyle} onClick={onClose}>Close</button>
        </>
      )}

      {state === "error" && (
        <>
          <p style={{ color: "var(--danger)", margin: 0, fontSize: "0.9rem" }}>{error}</p>
          <button style={btnStyle} onClick={generateCode}>Retry</button>
        </>
      )}

      {onClose && state !== "success" && (
        <button style={ghostStyle} onClick={onClose}>Cancel</button>
      )}
    </div>
  );
}
