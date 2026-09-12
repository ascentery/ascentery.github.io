import React, { useState } from "react";
import { updatePassword } from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn, Field, H1 } from "../ui/primitives";

export function ResetPasswordPage({ go }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="pf-in" style={{ maxWidth: 420, margin: "80px auto", textAlign: "center" }}>
        <H1>Password changed</H1>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, margin: "0 0 24px" }}>
          Your password has been updated.
        </p>
        <Btn kind="solid" onClick={() => go("browse")}>Continue to Ascentery</Btn>
      </div>
    );
  }

  return (
    <div className="pf-in" style={{ maxWidth: 380, margin: "80px auto" }}>
      <H1>Choose a new password</H1>

      <Field label="New password">
        <input type="password" style={inputStyle} value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()} />
      </Field>
      <Field label="Confirm new password">
        <input type="password" style={inputStyle} value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()} />
      </Field>

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 14px" }}>{error}</p>
      )}

      <Btn kind="solid" full disabled={busy || !password} onClick={save}>
        {busy ? "\u2026" : "Set new password"}
      </Btn>
    </div>
  );
}
