import React, { useState, useEffect } from "react";
import {
  GEN_BASE_CENTS,
  amendWorld,
  genCost,
  loadHistory,
  loadNameables,
  money,
  renameEntity,
  undoTo,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn } from "../ui/primitives";

export const AMEND_KINDS = [
  {
    key: "plot",
    label: "Change what happens",
    note: "Keeps the map and every room picture. Rewrites characters, items, trades and the quest chain around your instruction. Character and item pictures may be orphaned if something gets replaced, and playthroughs in progress are cleared.",
  },
  {
    key: "prose",
    label: "Change the words",
    note: "Keeps everything as it is and rewrites descriptions and character voices. Nothing structural moves, so pictures and saves are untouched.",
  },
];

export function WorldTab({ game, refreshWorlds, me, setMe, go }) {
  const [names, setNames] = useState(null);
  const [kind, setKind] = useState("plot");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [stage, setStage] = useState(null);   // map | plot | prose | done, while building
  const [history, setHistory] = useState([]);
  const [undoing, setUndoing] = useState(false);

  const refreshHistory = () => loadHistory(game.id).then(setHistory).catch(() => setHistory([]));

  useEffect(() => {
    loadNameables(game.id).then(setNames).catch(() => setNames([]));
    refreshHistory();
  }, [game.id]);

  const cost = kind === "prose" ? GEN_BASE_CENTS : genCost(game.rooms || 8);

  /* Saving on blur alone is invisible: no button, no confirmation, and from
     the creator's side it looks as though nothing happened. Enter also
     commits, and each row reports its own result. */
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState(null);
  const [rowError, setRowError] = useState(null);

  const rowId = (entry) => `${entry.kind}:${entry.key}`;

  const rename = async (entry, value) => {
    const next = String(value ?? "").trim();
    if (!next || next === entry.name) return;

    setSaving(rowId(entry));
    setRowError(null);
    try {
      const clean = await renameEntity(game.id, entry.kind, entry.key, next);
      setNames((ns) => ns.map((n) =>
        n.kind === entry.kind && n.key === entry.key ? { ...n, name: clean } : n));
      setSaved(rowId(entry));
      setTimeout(() => setSaved((cur) => (cur === rowId(entry) ? null : cur)), 1800);
    } catch (e) {
      setRowError({ id: rowId(entry), message: e.message });
    } finally {
      setSaving(null);
    }
  };

  const amend = async () => {
    setBusy(true); setError(null); setResult(null); setNeedsFunds(false);
    try {
      const res = await amendWorld(game.id, kind, note.trim());
      setResult(res);
      setNote("");
      if (typeof res.balance_cents === "number") setMe((m) => ({ ...m, balance: res.balance_cents }));
      await refreshWorlds();
      loadNameables(game.id).then(setNames).catch(() => {});
      refreshHistory();
    } catch (e) {
      setError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
    } finally {
      setBusy(false);
    }
  };

  const group = (k) => (names ?? []).filter((n) => n.kind === k);

  return (
    <div style={{ maxWidth: 620 }}>
      {/* ---- ask for a change ---- */}
      <h2 style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, margin: "0 0 4px" }}>
        Ask for a change
      </h2>
      <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 18px" }}>
        Say what you want different in plain words. Put a magician in the tower, give the innkeeper
        something she is hiding, make the ending harder to reach.
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
        {AMEND_KINDS.map((k) => {
          const on = kind === k.key;
          return (
            <button key={k.key} className="pf-btn" onClick={() => setKind(k.key)}
              style={{ textAlign: "left", padding: "12px 14px", borderRadius: 2, cursor: "pointer",
                background: "transparent", border: "1px solid " + (on ? T.ochre : T.edge) }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: T.serif, fontSize: 16, flex: 1, color: on ? T.bone : T.boneDim }}>
                  {k.label}
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
                  {money(k.key === "prose" ? GEN_BASE_CENTS : genCost(game.rooms || 8))}
                </span>
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 4, lineHeight: 1.6 }}>
                {k.note}
              </div>
            </button>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={5}
        placeholder="Put a magician in the tower. He carries a sealed letter the innkeeper wants, and will not part with it until someone brings him water from the well."
        style={{ ...inputStyle, lineHeight: 1.6, resize: "vertical", marginBottom: 14 }} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 22 }}>
        <Btn kind="solid" disabled={busy || note.trim().length < 8 || me.balance < cost} onClick={amend}>
          {busy ? "working\u2026" : `Rebuild \u00b7 ${money(cost)}`}
        </Btn>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
          {me.balance < cost ? "Not enough left." : `${money(me.balance)} left`}
        </span>
      </div>

      {busy && (
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 20px" }}>
          Rewriting and checking it holds together. A minute or so. If the result does not validate
          nothing is changed and nothing is charged.
        </p>
      )}

      {result && (
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: "12px 16px", marginBottom: 22,
          fontFamily: T.mono, fontSize: 12, lineHeight: 1.9, color: T.boneDim }}>
          <div style={{ color: T.moss }}>Rebuilt. {result.stats.rooms} rooms, {result.stats.mobs} characters,
            {" "}{result.stats.items} items, {result.stats.quests} quests.</div>
          {result.saves_cleared && <div>Playthroughs in progress were cleared.</div>}
          {(result.warnings ?? []).map((w, i) => (
            <div key={i} style={{ color: T.clay }}>{w.message ?? String(w)}</div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ border: "1px solid " + T.clay + "44", borderRadius: 2, padding: 12, marginBottom: 22 }}>
          <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7, margin: 0 }}>{error}</p>
          {needsFunds && (
            <Btn kind="solid" onClick={() => go("creator")} style={{ marginTop: 12 }}>Add funds</Btn>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: "12px 14px",
          marginBottom: 22 }}>
          <div style={{ fontFamily: T.serif, fontSize: 16, marginBottom: 6 }}>Undo</div>
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, lineHeight: 1.7, margin: "0 0 12px" }}>
            The version before &ldquo;{history[0].note || "your last change"}&rdquo;, kept
            {" "}{new Date(history[0].created_at).toLocaleString()}. Putting it back restores every
            character, item and prop exactly as they were, and any picture that came back with them.
            Playthroughs in progress are cleared, as they are for any change.
          </p>
          <Btn kind="danger" disabled={undoing}
            onClick={async () => {
              setUndoing(true);
              setError(null);
              try {
                await undoTo(game.id, history[0].id);
                await refreshWorlds();
                await refreshHistory();
                loadNameables(game.id).then(setNames).catch(() => {});
                setResult(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setUndoing(false);
              }
            }}>
            {undoing ? "\u2026" : "Undo the last change"}
          </Btn>
        </div>
      )}

      {/* ---- renames ---- */}
      <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 22 }}>
        <h2 style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, margin: "0 0 4px" }}>Names</h2>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 18px" }}>
          Renaming is free and immediate. Press Enter or click away to save. It changes nothing
          else, so pictures and playthroughs are unaffected — but a character's written voice will
          still describe the old name, so use <em>Change the words</em> above if that matters.
        </p>

        {names === null ? (
          <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        ) : (
          [["mob", "Characters"], ["room", "Rooms"], ["item", "Items"]].map(([k, label]) =>
            group(k).length ? (
              <div key={k} style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 8 }}>{label}</div>
                {group(k).map((entry) => {
                  const id = rowId(entry);
                  return (
                    <div key={id} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          defaultValue={entry.name}
                          onBlur={(e) => rename(entry, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          style={{ ...inputStyle, fontSize: 14, padding: "7px 10px" }} />
                        <span style={{ fontFamily: T.mono, fontSize: 10.5, width: 96, flexShrink: 0,
                          color: saved === id ? T.moss : T.edge,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {saving === id ? "saving" : saved === id ? "saved" : entry.key}
                        </span>
                      </div>
                      {rowError?.id === id && (
                        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.clay, marginTop: 4 }}>
                          {rowError.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null)
        )}
      </div>
    </div>
  );
}
