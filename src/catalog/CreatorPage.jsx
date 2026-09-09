import React, { useState } from "react";
import {
  PRICE_CENTS,
  TOPUPS,
  money,
  startCheckout,
} from "../lib/db";
import { T } from "../theme";
import { Btn, H1 } from "../ui/primitives";

export function CreatorPage({ me, go }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const first = !me.isCreator;

  const buy = async (amount) => {
    setBusy(amount); setError(null);
    try {
      const url = await startCheckout(amount);
      window.location.href = url;
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  };

  return (
    <div className="pf-in" style={{ maxWidth: 620 }}>
      <Btn kind="ghost" onClick={() => go("browse")} style={{ marginBottom: 16 }}>back</Btn>

      <H1 sub={first
        ? "Playing is free and always will be. Making a world costs money because every picture in it costs money to draw, so creators pay for what they use and nothing else."
        : "Add more whenever you run out. It never expires, and there is no subscription."}>
        {first ? "Become a creator" : "Add funds"}
      </H1>

      {first && (
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 18, marginBottom: 26 }}>
          <div style={{ fontFamily: T.serif, fontSize: 17, marginBottom: 10 }}>What $5 gets you</div>
          <div style={{ fontFamily: T.mono, fontSize: 12.5, lineHeight: 2, color: T.boneDim }}>
            <div>Unlimited worlds. Building one is free; only pictures cost.</div>
            <div>A room, character or item on the pixel engine &mdash; {money(PRICE_CENTS.pixel)}</div>
            <div>The same on Flux, and every splash screen &mdash; {money(PRICE_CENTS.flux)}</div>
            <div>Roughly four or five fully illustrated worlds</div>
          </div>
        </div>
      )}

      {!first && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.boneDim, margin: "0 0 22px" }}>
          You have {money(me.balance)} left.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 10, marginBottom: 20 }}>
        {TOPUPS.map((amount) => (
          <button key={amount} className="pf-btn" onClick={() => buy(amount)} disabled={Boolean(busy)}
            style={{ padding: "18px 12px", borderRadius: 2, cursor: busy ? "default" : "pointer",
              background: amount === "5" ? T.ochre : "transparent",
              color: amount === "5" ? "#221D0C" : T.bone,
              border: "1px solid " + (amount === "5" ? T.ochre : T.edge),
              fontFamily: T.serif, fontSize: 22 }}>
            {busy === amount ? "\u2026" : "$" + amount}
          </button>
        ))}
      </div>

      <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, lineHeight: 1.7, margin: "0 0 20px" }}>
        Every amount buys the same thing. The larger ones are only there to save you coming back.
        Payment is handled by Stripe; we never see your card.
      </p>

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7,
          border: "1px solid " + T.clay + "44", padding: 12, borderRadius: 2 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- claiming a name ---------- */
