import React, { useState, useEffect } from "react";
import {
  GEN_BASE_CENTS,
  GEN_PER_ROOM_CENTS,
  ROOM_CHOICES,
  createWorld,
  genCost,
  generateWorld,
  loadBriefPresets,
  money,
  setPublished,
  watchGeneration,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn, Field, H1 } from "../ui/primitives";

export const EXAMPLE =
  "A lighthouse on a tidal island, cut off for six hours either side of high water. The keeper died last " +
  "month and I've been sent to take over. There's a locked lamp room, a cellar full of somebody else's " +
  "belongings, and a woman from the village who rows out every day and will not say why. She knows what's " +
  "in the cellar. She'll only tell me if I bring her the keeper's logbook, and nothing else will make her talk.";

export function Create({ me, refreshWorlds, go }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [phase, setPhase] = useState("idle");   // idle | building | review | failed
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [worldId, setWorldId] = useState(null);
  const [size, setSize] = useState("auto");
  const [needsFunds, setNeedsFunds] = useState(false);
  const [stage, setStage] = useState(null);   // map | plot | prose | done, while building
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState(null);

  useEffect(() => { loadBriefPresets().then(setPresets).catch(() => setPresets([])); }, []);

  const build = async () => {
    setPhase("building"); setStep(3); setError(null); setStage(null);
    let id = worldId;
    try {
      const choice = ROOM_CHOICES.find((c) => c.key === size) ?? ROOM_CHOICES[0];
      id = id ?? await createWorld({
        userId: me.id,
        title: title.trim() || "Untitled world",
        brief: desc.trim(),
        roomMin: choice.min,
        roomMax: choice.max,
      });
      setWorldId(id);

      // Poll the real stage while the request is in flight, rather than
      // guessing at progress with a timer.
      const stop = watchGeneration(id, (status, gs) => { if (status === "generating") setStage(gs); });
      let res;
      try {
        res = await generateWorld(id);
      } finally {
        stop();
      }

      await refreshWorlds();
      // Straight to the editor: illustrating is the next real step, and the
      // old review screen was one more click between building and doing it.
      go("edit", { id });
    } catch (e) {
      setError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
      setPhase("failed");
      await refreshWorlds();
    }
  };

  const finish = async (published) => {
    if (published && worldId) {
      try {
        await setPublished(worldId, true);
      } catch (e) {
        if (e.needsUsername) {
          await refreshWorlds();
          go("username", { reason: "publish", next: "mine" });
          return;
        }
        console.error(e);
      }
    }
    await refreshWorlds();
    go("mine");
  };

  const steps = ["Describe it", "Check it over", "What got built"];

  return (
    <div className="pf-in" style={{ maxWidth: 660 }}>
      <H1>Create a game</H1>
      <div style={{ display: "flex", gap: 18, marginBottom: 28, flexWrap: "wrap" }}>
        {steps.map((label, i) => (
          <div key={label} style={{ fontFamily: T.mono, fontSize: 11.5,
            color: step === i + 1 ? T.ochre : step > i + 1 ? T.boneDim : T.edge }}>
            {step > i + 1 ? "\u2713 " : (i + 1) + ". "}{label}
          </div>
        ))}
      </div>

      {step === 1 && (<>
        {presets.length > 0 && (
          <Field label="Start from a preset" hint="Fills the title and brief below. Edit either before continuing.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {presets.map((p) => (
                <button key={p.id} className="pf-btn"
                  onClick={() => {
                    setPresetId(p.id);
                    setTitle(p.title || "");
                    setDesc(p.prompt);
                  }}
                  style={{ padding: "8px 12px", borderRadius: 2, cursor: "pointer",
                    background: "transparent", fontFamily: T.mono, fontSize: 12,
                    color: presetId === p.id ? T.bone : T.boneDim,
                    border: "1px solid " + (presetId === p.id ? T.ochre : T.edge) }}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Title">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Lamp Room" />
        </Field>
        <Field label="Describe the world"
          hint="Places, who is in them, what they want, and above all what cannot be talked around. The rules you write here are the ones the game will enforce.">
          <textarea value={desc} onChange={(e) => { setDesc(e.target.value); setPresetId(null); }} rows={10}
            placeholder="Somewhere real enough to walk around in"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
          <Btn kind="ghost" onClick={() => { setDesc(EXAMPLE); setTitle("The Lamp Room"); }}>use an example</Btn>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {desc.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </div>
        <Field label="How big" hint="Rooms are what a world costs, to build and to illustrate. You can leave this to the brief.">
          <div style={{ display: "grid", gap: 8 }}>
            {ROOM_CHOICES.map((c) => {
              const on = size === c.key;
              return (
                <button key={c.key} className="pf-btn" onClick={() => setSize(c.key)}
                  style={{ textAlign: "left", padding: "11px 13px", borderRadius: 2, cursor: "pointer",
                    background: "transparent", border: "1px solid " + (on ? T.ochre : T.edge) }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: T.serif, fontSize: 16, flex: 1,
                      color: on ? T.bone : T.boneDim }}>{c.label}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
                      {c.min ? `${money(genCost(c.min))}\u2013${money(genCost(c.max))}` : "from " + money(genCost(4))}
                    </span>
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 3, lineHeight: 1.5 }}>
                    {c.note}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        <Btn kind="solid" disabled={desc.trim().length < 40 || !title.trim()} onClick={() => setStep(2)}>Continue</Btn>
      </>)}

      {step === 2 && (<>
        <p style={{ fontFamily: T.serif, fontSize: 16, lineHeight: 1.6, color: T.boneDim, marginTop: 0 }}>
          Building takes a minute or two. Anything your brief says cannot be talked around becomes a
          rule the game enforces, so it is worth saying it plainly.
        </p>
        <p style={{ fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.7, color: T.boneDim, margin: "0 0 20px" }}>
          {money(GEN_BASE_CENTS)} plus {money(GEN_PER_ROOM_CENTS)} a room, charged only if it builds.
          Pictures are separate and optional. You have {money(me.balance)}.
        </p>
        <div style={{ border: "1px solid " + T.edge, padding: 18, borderRadius: 2, marginBottom: 24 }}>
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 8 }}>{title || "Untitled world"}</div>
          <p style={{ fontFamily: T.serif, fontSize: 15, lineHeight: 1.6, color: T.boneDim, margin: 0, whiteSpace: "pre-wrap" }}>{desc}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={() => setStep(1)}>Back</Btn>
          <Btn kind="solid" onClick={build}>Build the world</Btn>
        </div>
      </>)}

      {step === 3 && phase === "building" && <Building stage={stage} />}

      {step === 3 && phase === "failed" && (<>
        <div style={{ border: "1px solid " + T.clay + "55", padding: 18, borderRadius: 2, marginBottom: 22 }}>
          <div style={{ fontFamily: T.serif, fontSize: 18, marginBottom: 8 }}>It did not come together</div>
          <p style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.7, color: T.clay, margin: 0 }}>{error}</p>
        </div>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, marginTop: 0 }}>
          Usually this means the brief asks for something the world cannot hold: a character who gives
          you information rather than an object, or a thing with no way to reach it. Try again, or go
          back and make the gate concrete.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {needsFunds
            ? <Btn kind="solid" onClick={() => go("creator")}>Add funds</Btn>
            : <Btn kind="solid" onClick={build}>Try again</Btn>}
          <Btn onClick={() => { setPhase("idle"); setStep(1); }}>Edit the brief</Btn>
        </div>
      </>)}
    </div>
  );
}

export const GEN_STEPS = [
  { key: "map",   label: "Laying out rooms and exits" },
  { key: "plot",  label: "Placing characters and what they carry" },
  { key: "prose", label: "Writing descriptions and voices" },
  { key: "done",  label: "Checking it all holds together" },
];

/* The generate function reports which pass it is on, so this shows a real
   state rather than a timer standing in for one. A stage reached earlier
   than the current one is done; the current one is in progress; anything
   after is still waiting. */

export function Building({ stage }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const at = GEN_STEPS.findIndex((s) => s.key === stage);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div style={{ border: "1px solid " + T.edge, padding: "30px 22px", borderRadius: 2 }}>
      <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 16 }}>
        Building the world
      </div>

      {GEN_STEPS.map((s, i) => {
        const state = at < 0 ? "pending" : i < at ? "done" : i === at ? "active" : "pending";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10,
            fontFamily: T.mono, fontSize: 12.5, lineHeight: 2.1,
            color: state === "done" ? T.boneDim : state === "active" ? T.ochre : T.edge }}>
            <span style={{ width: 14, flexShrink: 0 }}>{state === "done" ? "\u2713" : state === "active" ? "\u00b7" : ""}</span>
            {s.label}
          </div>
        );
      })}

      <p style={{ fontFamily: T.serif, fontSize: 14.5, color: T.boneDim, lineHeight: 1.6, margin: "16px 0 0" }}>
        If it does not hold together it goes back and fixes itself, which is why this sometimes
        pauses on one step longer than the others.
      </p>
      <div style={{ fontFamily: T.mono, fontSize: 11, color: secs > 150 ? T.clay : T.boneDim, marginTop: 10 }}>
        {clock}{secs > 150 ? " — longer than usual" : ""}
      </div>
    </div>
  );
}

/* ---------- game detail ---------- */
