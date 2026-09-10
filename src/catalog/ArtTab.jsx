import React, { useState, useEffect } from "react";
import {
  DEFAULT_ART,
  ENGINES,
  PRICE_CENTS,
  deleteArt,
  drawArt,
  loadArtConfig,
  loadArtPresetContent,
  loadArtPresetLabels,
  money,
  saveArtConfig,
  setArtLock,
  setArtPrompt,
} from "../lib/db";
import { readable } from "../play/chrome";
import { T, inputStyle } from "../theme";
import { Btn, Field, Splash } from "../ui/primitives";

export const KINDS = [
  { key: "cover", label: "Splash", ratio: 0.5625 },
  { key: "room",  label: "Rooms", ratio: 0.5625 },
  { key: "mob",   label: "Characters", ratio: 1.33 },
  { key: "prop",  label: "Props", ratio: 1 },
  { key: "item",  label: "Items", ratio: 1 },
];

// Items and splash screens are always flux: the LoRA is trained heavily on
// sprite sheets and fights a single object, and a titled splash needs type
// the model can actually render.

export const ENGINE_LOCKED = { item: "flux", prop: "flux", cover: "flux" };

export const KIND_LABEL = { cover: "the splash screen", room: "rooms", mob: "characters", prop: "props", item: "items" };

export function ArtTab({ entries, setEntries, me, setMe, worldId, onDrawn }) {
  const isAdmin = Boolean(me?.isAdmin);
  const [kind, setKind] = useState("room");
  const [config, setConfig] = useState(null);
  const [showStyle, setShowStyle] = useState(false);
  const [saved, setSaved] = useState(false);
  /* The prompt boxes are uncontrolled, so React will not repaint them when
     the config changes underneath. Bumping this remounts them, which is how
     a reset becomes visible rather than only being saved. */
  const [revision, setRevision] = useState(0);
  const [drawing, setDrawing] = useState(null);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // artId whose prompt is open
  const [artPresets, setArtPresets] = useState([]);          // { id, label, sort_order } — no content, ever, for non-admins
  const [preview, setPreview] = useState(null);               // { id, config } — admin-only, read-only

  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    loadArtConfig(worldId)
      .then((c) => { if (!cancelled) setConfig(c); })
      .catch(() => { if (!cancelled) setConfig({ ...DEFAULT_ART }); });
    return () => { cancelled = true; };
  }, [worldId]);

  const writeConfig = async (next, repaint = false) => {
    setConfig(next);
    if (repaint) setRevision((n) => n + 1);
    try {
      await saveArtConfig(worldId, next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) { console.error(e); }
  };

  const engine = ENGINE_LOCKED[kind] ?? (config?.[`engine_${kind}`] ?? "pixel");
  const COST = PRICE_CENTS[engine] ?? 5;      // cents
  const styleKey = engine === "flux" ? "style_flux" : "style_pixel";

  // Presets are per engine, not per kind: one preset supplies framing and
  // negatives for every kind at once, the same way a world's own art style
  // is shared across kinds. Switching kinds within one engine keeps the
  // same preset selected; switching engines shows that engine's own list.
  useEffect(() => {
    let cancelled = false;
    // Labels only, for everyone — this is what a non-admin's browser is
    // ever allowed to know about a preset's existence.
    loadArtPresetLabels(engine).then((rs) => { if (!cancelled) setArtPresets(rs); }).catch(() => setArtPresets([]));
    setPreview(null);
    return () => { cancelled = true; };
  }, [engine]);

  const presetKey = `preset_${engine}`;
  const selectedPreset = config?.[presetKey] ?? null;

  /* Picking a named preset clears the boxes currently on screen — the
     shared style, this kind's framing, and (on the pixel engine) the two
     negative boxes — to empty. The preset now supplies that layer on its
     own; anything typed afterward is additional, laid on top of it at draw
     time, not a replacement for it. Only the current kind's boxes are
     touched, not every kind at once, since that would change tabs the
     creator cannot currently see. */
  const choosePreset = (id) => {
    writeConfig({
      ...config,
      [presetKey]: id,
      [styleKey]: "",
      [kind]: "",
      ...(engine === "pixel" ? { neg: "", [`neg_${kind}`]: "" } : {}),
    }, true);

    // The boxes above stay exactly as built — empty, ready for the
    // creator's own words. This is separate: a read-only look at what the
    // preset itself says, and it exists only for an admin's own eyes.
    // Nobody else's browser ever asks for this.
    if (isAdmin) {
      setPreview(null);
      loadArtPresetContent(id).then((cfg2) => setPreview({ id, config: cfg2 })).catch(() => setPreview(null));
    }
  };

  /* Custom is the opposite move: no preset attached, and the boxes show
     the platform's own original wording again — the same thing a brand
     new world starts with — rather than being left empty. This is the
     same effect as "reset to defaults" below; both go through one place
     so they cannot drift apart. */
  const clearPresetSelection = () => setPreview(null);

  const restoreDefaults = () => writeConfig({
    ...config,
    [presetKey]: null,
    [styleKey]: DEFAULT_ART[styleKey],
    [kind]: DEFAULT_ART[kind] ?? "",
    ...(engine === "pixel"
      ? { neg: DEFAULT_ART.neg, [`neg_${kind}`]: DEFAULT_ART[`neg_${kind}`] ?? "" }
      : {}),
  }, true);
  const shown = kind === "orphan"
    ? entries.filter((e) => e.orphaned)
    : entries.filter((e) => e.kind === kind && !e.orphaned);
  const ratio = KINDS.find((k) => k.key === kind)?.ratio ?? 1;
  const missing = kind === "orphan" ? [] : shown.filter((e) => !e.art && !e.locked);
  const affordable = Math.floor(me.balance / COST);

  const draw = async (entry) => {
    if (entry.locked || drawing) return;
    setDrawing(entry.id);
    setError(null);
    try {
      const { url, balance_cents } = await drawArt(entry.id);
      setEntries((es) => es.map((e) => e.id === entry.id ? { ...e, url, art: true } : e));
      if (typeof balance_cents === "number") setMe((m) => ({ ...m, balance: balance_cents }));
      onDrawn?.();
    } catch (e) {
      setError(e.message);
      if (typeof e.balanceCents === "number") setMe((m) => ({ ...m, balance: e.balanceCents }));
      setQueue([]);          // stop the run rather than repeat the same failure
    } finally {
      setDrawing(null);
    }
  };

  // Serial on purpose: the provider is slower under parallel load, and one
  // failure should stop the run rather than spend money on five more.
  useEffect(() => {
    if (drawing || !queue.length) return;
    const [next, ...rest] = queue;
    const entry = entries.find((e) => e.id === next);
    setQueue(rest);
    if (entry && !entry.art && !entry.locked) draw(entry);
  }, [queue, drawing]);

  const savePrompt = async (entry, prompt) => {
    setEntries((es) => es.map((e) => e.id === entry.id ? { ...e, prompt } : e));
    try { await setArtPrompt(entry.id, prompt); } catch (e) { console.error(e); }
  };

  const toggleLock = async (entry) => {
    setEntries((es) => es.map((e) => e.id === entry.id ? { ...e, locked: !e.locked } : e));
    try { await setArtLock(entry.id, !entry.locked); } catch (e) { console.error(e); }
  };

  const busy = Boolean(drawing) || queue.length > 0;
  const batch = Math.min(missing.length, affordable);

  return (<>
    <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
      {[...KINDS, { key: "orphan", label: "No longer here", ratio: 1 }].map((k) => {
        const n = k.key === "orphan"
          ? entries.filter((e) => e.orphaned).length
          : entries.filter((e) => e.kind === k.key && !e.orphaned).length;
        const done = k.key === "orphan"
          ? n
          : entries.filter((e) => e.kind === k.key && !e.orphaned && e.art).length;
        if (!n) return null;
        return (
          <button key={k.key} onClick={() => setKind(k.key)} className="pf-btn"
            style={{ background: "transparent", cursor: "pointer", padding: "7px 12px", borderRadius: 2,
              fontFamily: T.mono, fontSize: 12,
              color: kind === k.key ? T.bone : T.boneDim,
              border: "1px solid " + (kind === k.key ? T.ochre : T.edge) }}>
            {k.label}{k.key === "cover" ? (done ? " ✓" : "") : ` ${done}/${n}`}
          </button>
        );
      })}
    </div>

    <div style={{ border: `1px solid ${T.edge}`, borderRadius: 2, marginBottom: 18 }}>
      <button className="pf-btn" onClick={() => setShowStyle((v) => !v)}
        style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
          padding: "11px 14px", fontFamily: T.mono, fontSize: 11.5, color: T.boneDim,
          display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1 }}>{showStyle ? "hide" : "show"} art direction</span>
        {saved && <span style={{ color: T.moss }}>saved</span>}
      </button>

      {showStyle && config && (
        <div style={{ padding: "0 14px 16px" }}>
          <p style={{ fontFamily: T.serif, fontSize: 14.5, color: T.boneDim, lineHeight: 1.6, margin: "0 0 16px" }}>
            Every picture is drawn from three pieces joined together: the art style, the framing for
            its kind, and the description of the thing itself. The two boxes at the bottom say what
            to avoid. Changes save when you click away and apply to the next draw, not to pictures
            already made.
          </p>

          <Field
            label={`Engine for ${KIND_LABEL[kind] ?? kind}`}
            hint={ENGINE_LOCKED[kind]
              ? (kind === "item" || kind === "prop"
                  ? "Single objects always use Flux. The pixel LoRA is trained heavily on sprite sheets and fights one thing on its own."
                  : "Splash screens always use Flux, because the title has to be readable.")
              : ENGINES.find((x) => x.key === engine)?.note}>
            <div style={{ display: "flex", gap: 6 }}>
              {ENGINES.map((x) => {
                const locked = Boolean(ENGINE_LOCKED[kind]);
                const on = engine === x.key;
                return (
                  <button key={x.key} className="pf-btn"
                    disabled={locked}
                    onClick={() => writeConfig({ ...config, [`engine_${kind}`]: x.key })}
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 2, fontFamily: T.mono, fontSize: 12,
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked && !on ? 0.35 : 1,
                      background: "transparent",
                      color: on ? T.bone : T.boneDim,
                      border: `1px solid ${on ? T.ochre : T.edge}` }}>
                    {x.label}
                  </button>
                );
              })}
            </div>
          </Field>

          {artPresets.length > 0 && (
            <Field label={`Preset for ${ENGINES.find((x) => x.key === engine)?.label ?? engine}`}
              hint="Attached underneath whatever you type below, not shown in the boxes themselves. Custom sends only your own words.">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="pf-btn" onClick={() => { clearPresetSelection(); restoreDefaults(); }}
                  style={{ padding: "8px 12px", borderRadius: 2, cursor: "pointer", background: "transparent",
                    fontFamily: T.mono, fontSize: 12, color: !selectedPreset ? T.bone : T.boneDim,
                    border: `1px solid ${!selectedPreset ? T.ochre : T.edge}` }}>
                  Custom
                </button>
                {artPresets.map((p) => (
                  <button key={p.id} className="pf-btn" onClick={() => choosePreset(p.id)}
                    style={{ padding: "8px 12px", borderRadius: 2, cursor: "pointer", background: "transparent",
                      fontFamily: T.mono, fontSize: 12, color: selectedPreset === p.id ? T.bone : T.boneDim,
                      border: `1px solid ${selectedPreset === p.id ? T.ochre : T.edge}` }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {isAdmin && preview && (
            <div style={{ border: "1px solid " + T.ochre + "66", borderRadius: 2, padding: "12px 14px", marginBottom: 18,
              fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.9, color: T.boneDim }}>
              <div style={{ color: T.ochre, marginBottom: 6 }}>
                Preset content (admin only — nobody else ever downloads this)
              </div>
              <div><b style={{ color: T.bone }}>Art style:</b> {preview.config.style || "—"}</div>
              <div><b style={{ color: T.bone }}>Framing for {(KIND_LABEL[kind] ?? kind).toLowerCase()}:</b> {preview.config[kind] || "—"}</div>
              <div><b style={{ color: T.bone }}>Avoid, everywhere:</b> {preview.config.neg || "—"}</div>
              <div><b style={{ color: T.bone }}>Avoid, {(KIND_LABEL[kind] ?? kind).toLowerCase()} only:</b> {preview.config[`neg_${kind}`] || "—"}</div>
            </div>
          )}

          <Field
            label="Art style"
            hint={engine === "flux"
              ? "Flux follows written direction closely, so be specific and imperative. Colour limits and dithering instructions work well here."
              : "Shared by every picture drawn with the pixel LoRA. The look, not the subject."}>
            <textarea
              defaultValue={config[styleKey] ?? ""}
              rows={4}
              key={`${styleKey}:${revision}`}
              onBlur={(e) => writeConfig({ ...config, [styleKey]: e.target.value })}
              style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
          </Field>

          <Field
            label={kind === "cover" ? "Framing for the splash screen" : `Framing for ${KIND_LABEL[kind] ?? kind}`}
            hint={kind === "cover"
              ? "Every splash begins with 'splash screen of a game with the title …, by …', built from the world's own title and your username so a rename carries through. Anything here is added after that."
              : "How this kind is composed. Rooms are wide views, characters are portraits, items are single objects."}>
            <textarea
              defaultValue={config[kind] ?? ""}
              rows={3}
              key={`${kind}:${revision}`}
              onBlur={(e) => writeConfig({ ...config, [kind]: e.target.value })}
              placeholder={kind === "cover" ? "e.g. dramatic key art, one figure against a landscape," : undefined}
              style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
          </Field>

          {engine === "pixel" && (
          <div style={{ borderTop: `1px solid ${T.edge}`, paddingTop: 16, marginTop: 4 }}>
            <Field label="Avoid, everywhere"
              hint="Sent as the negative prompt on every picture in this world.">
              <textarea
                defaultValue={config.neg ?? ""}
                key={`neg:${revision}`}
                rows={2}
                onBlur={(e) => writeConfig({ ...config, neg: e.target.value })}
                style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
            </Field>

            <Field
              label={`Avoid, ${(KIND_LABEL[kind] ?? kind).toLowerCase()} only`}
              hint={kind === "item"
                ? "Items go wrong in one particular way: the model draws a sheet of sprites or an inventory screen instead of the object. Most of this list is there to stop that."
                : "Added to the list above when drawing this kind."}>
              <textarea
                defaultValue={config[`neg_${kind}`] ?? ""}
                rows={3}
                key={`neg_${kind}:${revision}`}
                onBlur={(e) => writeConfig({ ...config, [`neg_${kind}`]: e.target.value })}
                style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
            </Field>
          </div>
          )}

          <Btn kind="ghost" onClick={restoreDefaults}>
            reset to defaults
          </Btn>
        </div>
      )}
    </div>

    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
      <p style={{ fontFamily: T.serif, fontSize: 15.5, color: T.boneDim, lineHeight: 1.55, margin: 0, flex: 1, minWidth: 240 }}>
        {kind === "orphan"
          ? "These were drawn for something a change removed. They are kept because you paid for them: undo the change, or bring the character or item back under the same name, and the picture reattaches itself."
          : "Lock one once you are happy with it. Locked pictures are skipped by redraws, including bulk ones."}
      </p>
      {missing.length > 0 && (
        <Btn onClick={() => { setError(null); setQueue(missing.slice(0, affordable).map((e) => e.id)); }}
          disabled={busy || batch < 1}>
          {busy
            ? "drawing" + (queue.length ? " \u00b7 " + queue.length + " left" : "")
            : "Draw " + batch + " missing \u00b7 " + money(batch * COST)}
        </Btn>
      )}
    </div>

    {affordable < 1 && (
      <p style={{ fontFamily: T.mono, fontSize: 11, color: T.clay, margin: "0 0 14px" }}>
        Not enough left to draw anything. One picture here costs {money(COST)}.
      </p>
    )}
    {error && (
      <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, lineHeight: 1.7,
        border: "1px solid " + T.clay + "44", padding: 12, borderRadius: 2, margin: "0 0 16px" }}>
        {error}
      </p>
    )}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 18 }}>
      {shown.map((e) => (
        <div key={e.id}>
          <div style={{ position: "relative" }}>
            <Splash seed={e.key} src={e.url} pending={drawing === e.id} ratio={ratio} />
            <button onClick={() => toggleLock(e)}
              title={e.locked ? "Unlock to allow redraws" : "Lock to protect from redraws"} className="pf-btn"
              style={{ position: "absolute", top: 7, right: 7, width: 27, height: 27, borderRadius: 2, cursor: "pointer",
                background: e.locked ? T.ochre : "rgba(20,22,17,.72)", border: "1px solid " + (e.locked ? T.ochre : T.edge),
                color: e.locked ? "#221D0C" : T.bone, fontSize: 12, lineHeight: 1 }}>
              {e.locked ? "\ud83d\udd12" : "\ud83d\udd13"}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <span style={{ fontFamily: T.serif, fontSize: 15.5, flex: 1, minWidth: 0 }}>{e.name}</span>
            {kind === "orphan" ? (
              <button className="pf-btn"
                onClick={async () => {
                  try {
                    await deleteArt(e.id);
                    setEntries((es) => es.filter((x) => x.id !== e.id));
                  } catch (err) { setError(err.message); }
                }}
                style={{ background: "none", border: "none", padding: 0, fontFamily: T.mono,
                  fontSize: 11, color: T.clay, cursor: "pointer" }}>
                delete for good
              </button>
            ) : (
            <button onClick={() => draw(e)} disabled={e.locked || busy || me.balance < COST} className="pf-btn"
              style={{ background: "none", border: "none", padding: 0, fontFamily: T.mono, fontSize: 11,
                color: e.locked ? T.edge : T.boneDim, cursor: (e.locked || busy) ? "not-allowed" : "pointer" }}>
              {drawing === e.id ? "drawing" : (e.art ? "redraw \u00b7 " : "draw \u00b7 ") + money(COST)}
            </button>
            )}
          </div>

          <button onClick={() => setEditing(editing === e.id ? null : e.id)} className="pf-btn"
            style={{ background: "none", border: "none", padding: "2px 0 0", fontFamily: T.mono, fontSize: 10.5,
              color: T.edge, cursor: "pointer" }}>
            {editing === e.id ? "hide prompt" : "edit prompt"}
          </button>

          {editing === e.id && (
            <textarea
              defaultValue={e.prompt}
              rows={4}
              onBlur={(ev) => savePrompt(e, ev.target.value)}
              placeholder="What the picture should show"
              style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.5, marginTop: 6, resize: "vertical" }} />
          )}
        </div>
      ))}
    </div>
  </>);
}


/* Item and room names arrive lowercase from the world data ("waxy lemon"),
   because that is how they read inside a sentence. In the chrome they are
   labels, so they get capitals. */
