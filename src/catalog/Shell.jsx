import React, { useState } from "react";
import {
  money,
  signIn,
  signUp,
} from "../lib/db";
import { Create } from "./Create";
import { T, inputStyle } from "../theme";
import { Avatar, Btn, Field } from "../ui/primitives";

export function Shell({ children }) {
  return (
    <div style={{ background: T.ground, color: T.bone, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .pf-btn:hover:not(:disabled) { background: ${T.raised}; }
        .pf-btn:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.ochre}; outline-offset: 2px; }
        input:focus, textarea:focus { outline: none; }
        .pf-card { cursor: pointer; }
        .pf-card:hover .pf-title { color: ${T.ochre}; }
        ::-webkit-scrollbar { width: 8px; height: 8px }
        ::-webkit-scrollbar-thumb { background: ${T.edge} }
        @keyframes pfIn { from { opacity: 0 } to { opacity: 1 } }
        .pf-in { animation: pfIn .35s ease both }
        @media (prefers-reduced-motion: reduce) { .pf-in { animation: none } }
      `}</style>
      {children}
    </div>
  );
}

export function Splash1() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ fontFamily: T.serif, fontSize: 26, color: T.boneDim }}>Ascentery</div>
    </div>
  );
}

export function Auth() {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const go = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === "in") {
        await signIn({ email, password });
        // onAuthStateChange in the root takes it from here.
      } else {
        const { needsConfirmation } = await signUp({ email, password, displayName });
        if (needsConfirmation) {
          setNotice("Check your email for a confirmation link, then sign in.");
          setMode("in");
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 22 }}>
      <div style={{ width: "100%", maxWidth: 380 }} className="pf-in">
        <div style={{ fontFamily: T.serif, fontSize: 34, lineHeight: 1.1, marginBottom: 6 }}>Ascentery</div>
        <p style={{ fontFamily: T.serif, fontSize: 16, color: T.boneDim, lineHeight: 1.55, margin: "0 0 30px" }}>
          Worlds written by people, played a sentence at a time.
        </p>

        <Field label="Email">
          <input style={inputStyle} type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="you@example.com" />
        </Field>
        <Field label="Password" hint={mode === "up" ? "At least six characters." : undefined}>
          <input style={inputStyle} type="password" value={password}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="••••••••" />
        </Field>
        {mode === "up" && (
          <Field label="Display name" hint="Your gamer tag is generated for you and can't be changed.">
            <input style={inputStyle} value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="Wei" />
          </Field>
        )}

        {error && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, lineHeight: 1.6, margin: "0 0 14px" }}>
            {error}
          </p>
        )}
        {notice && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.moss, lineHeight: 1.6, margin: "0 0 14px" }}>
            {notice}
          </p>
        )}

        <Btn kind="solid" full disabled={busy || !email || !password} onClick={go} style={{ marginBottom: 14 }}>
          {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
        </Btn>
        <button className="pf-btn" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}
          style={{ background: "none", border: "none", color: T.boneDim, fontFamily: T.mono, fontSize: 11.5, cursor: "pointer", padding: 0 }}>
          {mode === "in" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

export function TopBar({ me, view, go }) {
  const tabs = [["browse", "Browse"], ["mine", "Your games"], ["friends", "Friends"]];
  const frac = me.balanceCap ? me.balance / me.balanceCap : 0;
  return (
    <header style={{ borderBottom: `1px solid ${T.edge}`, position: "sticky", top: 0, background: T.ground, zIndex: 10 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 22px", display: "flex", alignItems: "center", gap: 18, height: 58 }}>
        <button onClick={() => go("browse")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: T.serif, fontSize: 20, color: T.bone }}>
          Ascentery
        </button>
        <nav style={{ display: "flex", gap: 2, flex: 1, overflowX: "auto" }}>
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => go(k)} className="pf-btn"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "19px 12px",
                fontFamily: T.mono, fontSize: 12, whiteSpace: "nowrap",
                color: view.name === k ? T.bone : T.boneDim,
                boxShadow: view.name === k ? `inset 0 -2px 0 ${T.ochre}` : "none" }}>
              {label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => go("creator")}
          title={me.isCreator ? `${money(me.balance)} left \u2014 add more` : "Become a creator"}
          className="pf-btn"
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
            background: "none", border: "none", padding: "4px 2px", cursor: "pointer" }}>
          <span aria-hidden style={{ width: 46, height: 3, background: T.edge, position: "relative", display: "inline-block" }}>
            <span style={{ position: "absolute", inset: 0, width: `${frac * 100}%`, background: frac > 0.2 ? T.ochre : T.clay }} />
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>{money(me.balance)}</span>
        </button>
        <button onClick={() => go("profile")} title={me.tag}
          style={{ padding: 0, borderRadius: "50%", cursor: "pointer", background: "none",
            border: `1px solid ${view.name === "profile" ? T.ochre : T.edge}` }}>
          <Avatar name={me.name} tag={me.tag} />
        </button>
      </div>
    </header>
  );
}

/* ---------- browse ---------- */
