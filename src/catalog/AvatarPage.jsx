import React, { useState, useEffect } from "react";
import {
  generateAvatar,
  money,
  saveAvatarPrompt,
  saveDefaultAvatar,
  setAvatarMode,
  swapAvatarVersion,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Avatar, Btn, Field, H1 } from "../ui/primitives";

const ENGINES = [
  { key: "pixel", label: "Adventure v1" },
  { key: "flux", label: "Adventure v2" },
];

const randomHex = () => "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");

export function AvatarPage({ me, setMe, go }) {
  const [mode, setMode] = useState(me.avatarMode ?? "default");

  // ---------- letter/colour mode ----------
  // Two background colours, gradient between them, same as the original
  // hash-derived look — a flat single colour would be a different style,
  // not this one with the choice handed over.
  const [bgColor, setBgColor] = useState(me.avatarBgColor || "#2e3347");
  const [bgColor2, setBgColor2] = useState(me.avatarBgColor2 || "#3c4460");
  const [letterColor, setLetterColor] = useState(me.avatarLetterColor || "#e8e0cd");
  const [colorBusy, setColorBusy] = useState(false);
  const [colorError, setColorError] = useState(null);

  const randomize = () => {
    setBgColor(randomHex());
    setBgColor2(randomHex());
    setLetterColor(randomHex());
  };

  const saveColors = async () => {
    setColorBusy(true); setColorError(null);
    try {
      await saveDefaultAvatar(me.id, { bgColor, bgColor2, letterColor });
      setMe((m) => ({ ...m, avatarMode: "default", avatarBgColor: bgColor, avatarBgColor2: bgColor2, avatarLetterColor: letterColor }));
      go("profile");
    } catch (e) {
      setColorError(e.message);
    } finally {
      setColorBusy(false);
    }
  };

  const cancelColors = () => {
    setBgColor(me.avatarBgColor || "#2e3347");
    setBgColor2(me.avatarBgColor2 || "#3c4460");
    setLetterColor(me.avatarLetterColor || "#e8e0cd");
    go("profile");
  };

  // ---------- generated-image mode ----------
  const [engine, setEngine] = useState(me.avatarEngine ?? "pixel");
  const [prompt, setPrompt] = useState(me.avatarPrompt ?? "");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [viewingPrev, setViewingPrev] = useState(false);

  const cost = engine === "flux" ? 11 : 5;

  const makeAvatar = async () => {
    setGenBusy(true); setGenError(null); setNeedsFunds(false);
    try {
      await saveAvatarPrompt(me.id, { prompt: prompt.trim(), engine });
      const { url, prev_url, balance_cents } = await generateAvatar();
      setMe((m) => ({
        ...m, avatarMode: "generated", avatarUrl: url, avatarPrevUrl: prev_url,
        avatarPrompt: prompt.trim(), avatarEngine: engine,
        balance: typeof balance_cents === "number" ? balance_cents : m.balance,
      }));
      setViewingPrev(false);
    } catch (e) {
      setGenError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
    } finally {
      setGenBusy(false);
    }
  };

  const toggleSwap = async () => {
    if (!me.avatarPrevUrl || swapping) return;
    setSwapping(true);
    try {
      const { url, prev_url } = await swapAvatarVersion();
      setMe((m) => ({ ...m, avatarUrl: url, avatarPrevUrl: prev_url }));
      setViewingPrev((v) => !v);
    } catch (e) {
      setGenError(e.message);
    } finally {
      setSwapping(false);
    }
  };

  return (
    <div className="pf-in" style={{ maxWidth: 480 }}>
      <H1>Profile picture</H1>

      {me.isCreator && (
        <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
          {[["default", "Use Default"], ["generated", "User Generated Image"]].map(([k, label]) => (
            <button key={k} onClick={() => {
              setMode(k);
              // Persisted immediately, not deferred to a Save/Generate
              // click — switching modes should show whatever already
              // exists for that mode right away, everywhere the avatar
              // appears, since the creator may just be switching back to
              // a picture they already had rather than starting fresh.
              setAvatarMode(me.id, k).catch((e) => console.error("could not save avatar mode", e));
              setMe((m) => ({ ...m, avatarMode: k }));
            }} className="pf-btn"
              style={{ flex: 1, padding: "9px 10px", borderRadius: 2, cursor: "pointer", background: "transparent",
                fontFamily: T.mono, fontSize: 12, color: mode === k ? T.bone : T.boneDim,
                border: "1px solid " + (mode === k ? T.ochre : T.edge) }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === "default" && (<>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
          <Avatar name={me.name} tag={me.tag} size={140} bgColor={bgColor} bgColor2={bgColor2} letterColor={letterColor} />
        </div>

        <Field label="Background colour 1">
          <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)}
            style={{ width: "100%", height: 44, padding: 0, border: "1px solid " + T.edge, borderRadius: 2, cursor: "pointer", background: "none" }} />
        </Field>

        <Field label="Background colour 2">
          <input type="color" value={bgColor2} onChange={(e) => setBgColor2(e.target.value)}
            style={{ width: "100%", height: 44, padding: 0, border: "1px solid " + T.edge, borderRadius: 2, cursor: "pointer", background: "none" }} />
        </Field>

        <Field label="Letter colour">
          <input type="color" value={letterColor} onChange={(e) => setLetterColor(e.target.value)}
            style={{ width: "100%", height: 44, padding: 0, border: "1px solid " + T.edge, borderRadius: 2, cursor: "pointer", background: "none" }} />
        </Field>

        <Btn kind="ghost" onClick={randomize} style={{ marginBottom: 20 }}>Random</Btn>

        {colorError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 14px" }}>{colorError}</p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Btn kind="solid" disabled={colorBusy} onClick={saveColors}>{colorBusy ? "\u2026" : "Save"}</Btn>
          <Btn kind="ghost" onClick={cancelColors}>Cancel</Btn>
        </div>
      </>)}

      {mode === "generated" && (<>
        <div style={{ position: "relative", display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <Avatar name={me.name} tag={me.tag} size={140} src={me.avatarUrl} />
        </div>

        <Field label="Engine">
          <div style={{ display: "flex", gap: 6 }}>
            {ENGINES.map((x) => (
              <button key={x.key} onClick={() => setEngine(x.key)} className="pf-btn"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 2, cursor: "pointer", background: "transparent",
                  fontFamily: T.mono, fontSize: 12, color: engine === x.key ? T.bone : T.boneDim,
                  border: "1px solid " + (engine === x.key ? T.ochre : T.edge) }}>
                {x.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Prompt" hint="What the picture should show — separate from your description, which is what other people read about you.">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
            placeholder="A weathered sailor with a short grey beard, a battered captain's coat"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Btn kind="solid" disabled={genBusy || !prompt.trim()} onClick={makeAvatar}>
            {genBusy ? "drawing\u2026" : `Generate \u00b7 ${money(cost)}`}
          </Btn>
          {me.avatarPrevUrl && (
            <Btn kind="ghost" disabled={swapping} onClick={toggleSwap}>
              {swapping ? "\u2026" : viewingPrev ? "Redo" : "Undo"}
            </Btn>
          )}
        </div>

        {genError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 14px" }}>
            {genError}
            {needsFunds && <Btn kind="ghost" style={{ marginLeft: 10 }} onClick={() => go("creator")}>Add funds</Btn>}
          </p>
        )}

        <Btn kind="ghost" onClick={() => go("profile")}>Done</Btn>
      </>)}
    </div>
  );
}
