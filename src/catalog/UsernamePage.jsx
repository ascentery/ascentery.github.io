import React, { useState, useEffect } from "react";
import {
  checkUsername,
  checkUsernameAllowed,
  claimUsername,
  money,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn, Field, H1 } from "../ui/primitives";

export function UsernamePage({ me, setMe, go, reason, next }) {
  const [name, setName] = useState(me.username ?? "");
  const [state, setState] = useState("idle");   // idle | checking | free | taken
  const [error, setError] = useState(null);
  const [needsFunds, setNeedsFunds] = useState(false);
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
    setBusy(true); setError(null); setNeedsFunds(false);
    const value = name.trim().toLowerCase();
    try {
      // Structural checks (length, characters, reserved words) are free
      // and already ruled out anything obviously wrong before this point.
      // This is the paid step — an AI judgment call on anything more
      // subjective, charged whether it approves or rejects.
      const check = await checkUsernameAllowed(value);
      if (typeof check.balance_cents === "number") setMe((m) => ({ ...m, balance: check.balance_cents }));
      if (!check.allowed) {
        setError(check.reason || "That name isn't allowed.");
        return;
      }
      const claimed = await claimUsername(value);
      setMe((m) => ({ ...m, username: claimed }));
      go(next ?? "mine");
    } catch (e) {
      setError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-in" style={{ maxWidth: 520 }}>
      <H1 sub={`Your worlds are published under this name, and it is how people find you. You can change it later from your profile — each check costs ${money(2)}.`}>
        {me.username ? "Your username" : "Choose a username"}
      </H1>

      {reason === "publish" && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.ochre, lineHeight: 1.7,
          border: "1px solid " + T.ochre + "44", padding: 12, borderRadius: 2, margin: "0 0 22px" }}>
          A world needs a name to be published under. Choose one and we will carry on.
        </p>
      )}

      <Field label="Username" hint="Five to twenty characters. Letters and numbers only.">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.mono, fontSize: 16, color: T.boneDim }}>@</span>
          <input
            value={name}
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())}
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
          {needsFunds && <Btn kind="ghost" style={{ marginLeft: 10 }}>Add funds</Btn>}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Btn kind="solid" disabled={state !== "free" || busy} onClick={save}>
          {busy ? "\u2026" : `Claim it \u00b7 ${money(2)}`}
        </Btn>
        {me.username && <Btn onClick={() => go("profile")}>Back</Btn>}
      </div>
    </div>
  );
}
