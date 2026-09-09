import React, { useState, useEffect } from "react";
import {
  checkUsername,
  claimUsername,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn, Field, H1 } from "../ui/primitives";

export function UsernamePage({ me, setMe, go, reason, next }) {
  const [name, setName] = useState(me.username ?? "");
  const [state, setState] = useState("idle");   // idle | checking | free | taken
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Debounced, because every keystroke would otherwise be a round trip.
  useEffect(() => {
    const value = name.trim().toLowerCase();
    if (!value || value === me.username) { setState("idle"); return; }
    setState("checking");
    const t = setTimeout(async () => {
      try {
        setState((await checkUsername(value)) ? "free" : "taken");
      } catch {
        setState("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [name, me.username]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const claimed = await claimUsername(name.trim().toLowerCase());
      setMe((m) => ({ ...m, username: claimed }));
      go(next ?? "mine");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-in" style={{ maxWidth: 520 }}>
      <H1 sub="Your worlds are published under this name, and it is how people find you. Pick carefully: it cannot be changed later.">
        {me.username ? "Your username" : "Choose a username"}
      </H1>

      {reason === "publish" && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.ochre, lineHeight: 1.7,
          border: "1px solid " + T.ochre + "44", padding: 12, borderRadius: 2, margin: "0 0 22px" }}>
          A world needs a name to be published under. Choose one and we will carry on.
        </p>
      )}

      <Field label="Username" hint="Three to twenty characters. Letters, numbers and hyphens.">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.mono, fontSize: 16, color: T.boneDim }}>@</span>
          <input
            value={name}
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && state === "free" && save()}
            placeholder="wei"
            style={{ ...inputStyle, fontFamily: T.mono, fontSize: 16, letterSpacing: ".02em" }} />
        </div>
      </Field>

      <div style={{ fontFamily: T.mono, fontSize: 11.5, minHeight: 18, marginBottom: 18,
        color: state === "taken" ? T.clay : state === "free" ? T.moss : T.boneDim }}>
        {state === "checking" ? "checking"
          : state === "free" ? "@" + name.trim().toLowerCase() + " is available"
          : state === "taken" ? "That one is taken or reserved"
          : ""}
      </div>

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7, margin: "0 0 16px" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="solid" disabled={state !== "free" || busy} onClick={save}>
          {busy ? "\u2026" : "Claim it"}
        </Btn>
        {me.username && <Btn onClick={() => go("profile")}>Back</Btn>}
      </div>
    </div>
  );
}
