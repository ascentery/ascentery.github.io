import React, { useState } from "react";
import {
  REPORT_REASONS,
  bumpPlays,
  reportWorld,
} from "../lib/db";
import { useNarrow } from "../hooks";
import { T, inputStyle } from "../theme";
import { Btn, Empty, Splash } from "../ui/primitives";

export function GameDetail({ game, chars, saves, go, from = "browse", isMine }) {
  const [picked, setPicked] = useState(chars[0]?.id ?? null);
  const [reporting, setReporting] = useState(false);
  const narrow = useNarrow();
  if (!game) return <Empty title="That world is gone." line="It may have been unpublished by its author." />;
  const save = saves[`${game.id}:${picked}`];

  return (
    <div className="pf-in">
      <Btn kind="ghost" onClick={() => go(from)} style={{ marginBottom: 14 }}>back</Btn>

      {/* the splash screen leads, full width, before anything is said about it */}
      <Splash seed={game.id} src={game.coverUrl} ratio={0.5625} style={{ marginBottom: 26 }} />

      <div style={{ display: "grid", gap: narrow ? 26 : 34, alignItems: "start",
        gridTemplateColumns: narrow ? "1fr" : "minmax(0, 1.5fr) minmax(240px, 1fr)" }}>

        <div>
          <h1 style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 400, margin: "0 0 8px", lineHeight: 1.15 }}>
            {game.title}
          </h1>
          <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, marginBottom: 16 }}>
            {game.author} &middot; {game.tag} &middot; {game.rooms} rooms &middot; {game.mobs} characters
            &middot; {game.plays.toLocaleString()} plays
          </div>
          <p style={{ fontFamily: T.serif, fontSize: 17, lineHeight: 1.62, margin: 0 }}>{game.blurb}</p>
        </div>

        <div>
          <div style={{ fontFamily: T.serif, fontSize: 15, marginBottom: 8 }}>Play as</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {chars.map((c) => (
              <button key={c.id} onClick={() => setPicked(c.id)} className="pf-btn"
                style={{ fontFamily: T.mono, fontSize: 12, padding: "8px 13px", cursor: "pointer", borderRadius: 2,
                  background: "transparent", color: picked === c.id ? T.bone : T.boneDim,
                  border: "1px solid " + (picked === c.id ? T.ochre : T.edge) }}>
                {c.name}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 20, minHeight: 16 }}>
            {save ? `turn ${save.state.turn} \u2014 picks up where they left off`
              : picked ? "new game"
              : "make a character on your profile first"}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn kind="solid" disabled={!picked || !game.playable}
              onClick={() => { bumpPlays(game.id); go("play", { id: game.id, charId: picked }); }}>
              {save ? "Continue" : "Start"}
            </Btn>
            {isMine && <Btn onClick={() => go("edit", { id: game.id })}>Edit</Btn>}
            {!isMine && (
              <Btn kind="ghost" onClick={() => setReporting((v) => !v)}>
                {reporting ? "cancel" : "report"}
              </Btn>
            )}
          </div>

          {!game.playable && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.clay, marginTop: 12, lineHeight: 1.6 }}>
              {game.status === "generating" ? "Still being built. Check back in a minute."
                : game.status === "failed" ? (game.failureNote || "This world failed to build.")
                : "This world isn't finished yet."}
            </div>
          )}
          {reporting && <ReportBox worldId={game.id} onDone={() => setReporting(false)} />}

          {isMine && !game.published && game.playable && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 12, lineHeight: 1.6 }}>
              A draft. Only you can see this until you publish it from Edit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- edit ---------- */

export function ReportBox({ worldId, onDone }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      await reportWorld(worldId, reason, detail);
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 16, marginTop: 16 }}>
        <p style={{ fontFamily: T.serif, fontSize: 15, lineHeight: 1.6, margin: 0, color: T.boneDim }}>
          Thank you. Somebody will look at it. You can keep playing in the meantime.
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 16, marginTop: 16 }}>
      <div style={{ fontFamily: T.serif, fontSize: 16, marginBottom: 10 }}>What is wrong with it?</div>

      <div style={{ display: "grid", gap: 5, marginBottom: 12 }}>
        {REPORT_REASONS.map((r) => (
          <button key={r} className="pf-btn" onClick={() => setReason(r)}
            style={{ textAlign: "left", padding: "7px 10px", borderRadius: 2, cursor: "pointer",
              background: "transparent", fontFamily: T.mono, fontSize: 12,
              color: reason === r ? T.bone : T.boneDim,
              border: "1px solid " + (reason === r ? T.ochre : T.edge) }}>
            {r}
          </button>
        ))}
      </div>

      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={3}
        placeholder="Where in the world is it, if that helps."
        style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical", marginBottom: 12 }} />

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="solid" onClick={send} disabled={busy}>{busy ? "\u2026" : "Send"}</Btn>
        <Btn kind="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  );
}
