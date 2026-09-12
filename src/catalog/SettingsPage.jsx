import React, { useState, useEffect } from "react";
import { getCurrentEmail, updateEmail, updatePassword } from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn, Field, H1 } from "../ui/primitives";

export function SettingsPage({ me, go }) {
  const [currentEmail, setCurrentEmail] = useState("");
  useEffect(() => {
    getCurrentEmail().then(setCurrentEmail);
  }, []);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const savePassword = async () => {
    setPasswordError(null);
    if (newPassword.length < 8) return setPasswordError("Use at least 8 characters.");
    if (newPassword !== confirmPassword) return setPasswordError("The two passwords don't match.");
    setPasswordBusy(true);
    try {
      await updatePassword(newPassword);
      setNewPassword(""); setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 2000);
    } catch (e) {
      setPasswordError(e.message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailSent, setEmailSent] = useState(false);

  const saveEmail = async () => {
    setEmailError(null);
    if (!newEmail.trim() || !newEmail.includes("@")) return setEmailError("Enter a valid email address.");
    setEmailBusy(true);
    try {
      await updateEmail(newEmail.trim());
      setEmailSent(true);
    } catch (e) {
      setEmailError(e.message);
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <div className="pf-in" style={{ maxWidth: 480 }}>
      <H1>Settings</H1>

      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: T.serif, fontSize: 17, marginBottom: 12 }}>Change password</div>
        <Field label="New password">
          <input type="password" style={inputStyle} value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" style={inputStyle} value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)} />
        </Field>
        {passwordError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>{passwordError}</p>
        )}
        <Btn kind="solid" disabled={passwordBusy || !newPassword} onClick={savePassword}>
          {passwordBusy ? "\u2026" : passwordSaved ? "Saved" : "Save password"}
        </Btn>
      </div>

      <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 24, marginBottom: 32 }}>
        <div style={{ fontFamily: T.serif, fontSize: 17, marginBottom: 6 }}>Change email</div>
        <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, margin: "0 0 14px" }}>
          Currently {currentEmail || "…"}. A confirmation link goes to the new address first —
          nothing changes until you click it.
        </p>
        {emailSent ? (
          <p style={{ fontFamily: T.mono, fontSize: 12, color: T.moss, margin: 0 }}>
            Check the new address for a confirmation link.
          </p>
        ) : (<>
          <Field label="New email">
            <input type="email" style={inputStyle} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </Field>
          {emailError && (
            <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>{emailError}</p>
          )}
          <Btn kind="solid" disabled={emailBusy || !newEmail.trim()} onClick={saveEmail}>
            {emailBusy ? "\u2026" : "Send confirmation link"}
          </Btn>
        </>)}
      </div>

      <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 24, marginBottom: 32 }}>
        <div style={{ fontFamily: T.serif, fontSize: 17, marginBottom: 6, color: T.boneDim }}>
          Two-factor sign-in
        </div>
        <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, lineHeight: 1.7, margin: 0 }}>
          Not built yet — planned as an email link you approve on your phone that signs in whichever
          device is waiting, rather than a code you type back in. Worth doing properly rather than
          rushed alongside everything else here.
        </p>
      </div>

      <Btn kind="ghost" onClick={() => go("profile")}>Back</Btn>
    </div>
  );
}
