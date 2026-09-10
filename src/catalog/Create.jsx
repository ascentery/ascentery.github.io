import React, { useState, useEffect } from "react";
import {
  GEN_BASE_CENTS,
  GEN_PER_ROOM_CENTS,
  createWorld,
  generateBriefFromPreset,
  generateGameDetails,
  generateStoryDetails,
  generateWorld,
  loadPresets,
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

/* The same collapsible pattern the art-direction panel uses: a bordered bar
   that expands into a row of choice buttons. Admin only, in every step that
   has one — a normal creator always gets the platform default and never
   sees this at all. */
function PresetPicker({ what, presets, chosen, onChoose }) {
  const [open, setOpen] = useState(false);
  const current = presets.find((p) => p.id === chosen)?.label;

  return (
    <div style={{ border: "1px solid " + T.edge, borderRadius: 2, marginBottom: 18 }}>
      <button className="pf-btn" onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
          padding: "11px 14px", fontFamily: T.mono, fontSize: 11.5, color: T.boneDim,
          display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1 }}>{open ? "hide" : "show"} {what} preset (admin)</span>
        <span style={{ color: T.ochre }}>{current ?? "platform default"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="pf-btn" onClick={() => onChoose("")}
            style={{ padding: "8px 12px", borderRadius: 2, cursor: "pointer", background: "transparent",
              fontFamily: T.mono, fontSize: 12, color: chosen === "" ? T.bone : T.boneDim,
              border: "1px solid " + (chosen === "" ? T.ochre : T.edge) }}>
            platform default
          </button>
          {presets.map((p) => (
            <button key={p.id} className="pf-btn" onClick={() => onChoose(p.id)}
              style={{ padding: "8px 12px", borderRadius: 2, cursor: "pointer", background: "transparent",
                fontFamily: T.mono, fontSize: 12, color: chosen === p.id ? T.bone : T.boneDim,
                border: "1px solid " + (chosen === p.id ? T.ochre : T.edge) }}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Create({ me, refreshWorlds, go }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");           // the step-1 brief
  const [phase, setPhase] = useState("idle");      // idle | building | failed
  const [error, setError] = useState(null);
  const [worldId, setWorldId] = useState(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [stage, setStage] = useState(null);        // map | plot | prose | done, while building
  const [buildResult, setBuildResult] = useState(null);

  // step 1: brief
  const [briefPresets, setBriefPresets] = useState([]);
  const [chosenBriefPreset, setChosenBriefPreset] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genFrom, setGenFrom] = useState(null);

  // step 2: story details — the arc, before Game Details turns it into
  // concrete characters, wants and trades
  const [storyDetails, setStoryDetails] = useState("");
  const [storyPresets, setStoryPresets] = useState([]);
  const [chosenStoryPreset, setChosenStoryPreset] = useState("");
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyError, setStoryError] = useState(null);

  // step 3: game details
  const [gameDetails, setGameDetails] = useState("");
  const [titles, setTitles] = useState([]);
  const [detailPresets, setDetailPresets] = useState([]);
  const [chosenDetailPreset, setChosenDetailPreset] = useState("");
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsError, setDetailsError] = useState(null);
  const [titlesBusy, setTitlesBusy] = useState(false);
  const [titlesError, setTitlesError] = useState(null);

  useEffect(() => {
    if (!me?.isAdmin) return;
    loadPresets("game_brief").then(setBriefPresets).catch(() => setBriefPresets([]));
    loadPresets("story_details").then(setStoryPresets).catch(() => setStoryPresets([]));
    loadPresets("game_details").then(setDetailPresets).catch(() => setDetailPresets([]));
  }, [me?.isAdmin]);

  const generate = async (presetId) => {
    setGenBusy(true); setGenError(null);
    try {
      const res = await generateBriefFromPreset(presetId || null);
      setTitle(res.title || title);
      setDesc(res.brief);
      setGenFrom(res.preset_label ?? null);
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenBusy(false);
    }
  };

  // Step 1 -> step 2: flesh the brief into a story arc.
  const advanceToStory = async () => {
    setStoryBusy(true); setStoryError(null);
    try {
      const res = await generateStoryDetails({ mode: "full", title, brief: desc });
      setStoryDetails(res.storyDetails ?? "");
      setStep(2);
    } catch (e) {
      setStoryError(e.message);
    } finally {
      setStoryBusy(false);
    }
  };

  const regenerateStory = async () => {
    setStoryBusy(true); setStoryError(null);
    try {
      const res = await generateStoryDetails({
        mode: "regenerate", title, brief: desc, presetId: chosenStoryPreset || undefined,
      });
      setStoryDetails(res.storyDetails ?? storyDetails);
    } catch (e) {
      setStoryError(e.message);
    } finally {
      setStoryBusy(false);
    }
  };

  // Step 2 -> step 3: turn the arc into concrete game content and suggest
  // titles in the same call. gameDetails, not the short step-1 brief and
  // not the story arc on its own, is what actually becomes the world's
  // brief once built — the creator can read and edit the richer version
  // before anything is generated.
  const advanceToDetails = async () => {
    setDetailsBusy(true); setDetailsError(null);
    try {
      const res = await generateGameDetails({ mode: "full", title, brief: desc, storyDetails });
      setGameDetails(res.gameDetails ?? "");
      setTitles(res.titles ?? []);
      setStep(3);
    } catch (e) {
      setDetailsError(e.message);
    } finally {
      setDetailsBusy(false);
    }
  };

  const regenerateDetails = async () => {
    setDetailsBusy(true); setDetailsError(null);
    try {
      const res = await generateGameDetails({
        mode: "details", title, brief: desc, storyDetails, presetId: chosenDetailPreset || undefined,
      });
      setGameDetails(res.gameDetails ?? gameDetails);
    } catch (e) {
      setDetailsError(e.message);
    } finally {
      setDetailsBusy(false);
    }
  };

  const regenerateTitles = async () => {
    setTitlesBusy(true); setTitlesError(null);
    try {
      const res = await generateGameDetails({ mode: "titles", title, brief: desc, storyDetails, gameDetails });
      setTitles(res.titles ?? titles);
    } catch (e) {
      setTitlesError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
    } finally {
      setTitlesBusy(false);
    }
  };

  const build = async () => {
    setPhase("building"); setStep(4); setError(null); setStage(null); setNeedsFunds(false); setBuildResult(null);
    let id = worldId;
    try {
      id = id ?? await createWorld({
        userId: me.id,
        title: title.trim() || "Untitled world",
        brief: gameDetails.trim() || storyDetails.trim() || desc.trim(),
        roomMin: null,
        roomMax: null,
      });
      setWorldId(id);

      const stop = watchGeneration(id, (status, gs) => { if (status === "generating") setStage(gs); });
      let res;
      try {
        res = await generateWorld(id);
      } finally {
        stop();
      }

      setBuildResult(res);
      await refreshWorlds();
      setPhase("done");
    } catch (e) {
      setError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
      setBuildResult(e.raw ? { raw: e.raw, rawLength: e.rawLength } : null);
      setPhase("failed");
      await refreshWorlds();
    }
  };

  const steps = ["Game brief", "Story details", "Game details", "World building"];

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
        {me?.isAdmin && briefPresets.length > 0 && (
          <PresetPicker what="brief" presets={briefPresets} chosen={chosenBriefPreset} onChoose={setChosenBriefPreset} />
        )}

        <Field label="Title">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Lamp Room" />
        </Field>
        <Field label="Describe the world"
          hint="Places, who is in them, what they want, and above all what cannot be talked around. The rules you write here are the ones the game will enforce.">
          <textarea value={desc} onChange={(e) => { setDesc(e.target.value); setGenFrom(null); }} rows={10}
            placeholder="Somewhere real enough to walk around in"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <Btn kind="ghost" disabled={genBusy} onClick={() => generate(chosenBriefPreset)}>
            {genBusy ? "writing\u2026" : desc.trim() ? "generate another" : "generate an example"}
          </Btn>
          <Btn kind="ghost" onClick={() => { setDesc(EXAMPLE); setTitle("The Lamp Room"); setGenFrom(null); }}>
            use a fixed example
          </Btn>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {desc.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </div>

        {genFrom && (
          <p style={{ fontFamily: T.mono, fontSize: 10.5, color: T.boneDim, margin: "0 0 8px" }}>
            written from "{genFrom}"
          </p>
        )}
        {genError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 8px" }}>{genError}</p>
        )}
        {storyError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 8px" }}>{storyError}</p>
        )}

        <div style={{ marginBottom: 20 }} />
        <Btn kind="solid" disabled={desc.trim().length < 40 || !title.trim() || storyBusy}
          onClick={advanceToStory}>
          {storyBusy ? "fleshing it out\u2026" : "Continue"}
        </Btn>
      </>)}

      {step === 2 && (<>
        {me?.isAdmin && storyPresets.length > 0 && (
          <PresetPicker what="story" presets={storyPresets} chosen={chosenStoryPreset} onChoose={setChosenStoryPreset} />
        )}

        <Field label="Story details"
          hint="The arc: what is being sought, what stands in the way, how it resolves. Game Details, next, turns this into concrete characters and trades — read this over and fix anything that is not the story you meant.">
          <textarea value={storyDetails} onChange={(e) => setStoryDetails(e.target.value)} rows={10}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>

        {me?.isAdmin && (
          <div style={{ marginBottom: 8 }}>
            <Btn kind="ghost" disabled={storyBusy} onClick={regenerateStory}>
              {storyBusy ? "writing\u2026" : "Regenerate (admin)"}
            </Btn>
          </div>
        )}
        {storyError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>{storyError}</p>
        )}
        {detailsError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>{detailsError}</p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <Btn onClick={() => setStep(1)}>Back</Btn>
          <Btn kind="solid" disabled={!storyDetails.trim() || detailsBusy} onClick={advanceToDetails}>
            {detailsBusy ? "building the details\u2026" : "Continue"}
          </Btn>
        </div>
      </>)}

      {step === 3 && (<>
        {me?.isAdmin && detailPresets.length > 0 && (
          <PresetPicker what="details" presets={detailPresets} chosen={chosenDetailPreset} onChoose={setChosenDetailPreset} />
        )}

        <Field label="Title">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input style={{ ...inputStyle, flex: 1 }} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className="pf-btn" disabled={titlesBusy}
              onClick={regenerateTitles}
              style={{ background: "none", border: "1px solid " + T.edge, borderRadius: 2,
                cursor: titlesBusy ? "default" : "pointer", padding: "8px 12px", flexShrink: 0,
                fontFamily: T.mono, fontSize: 11, color: T.boneDim, whiteSpace: "nowrap" }}>
              {titlesBusy ? "\u2026" : `Regenerate \u00b7 ${money(1)}`}
            </button>
          </div>
        </Field>

        {titlesError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "-8px 0 12px" }}>
            {titlesError}
            {needsFunds && (
              <Btn kind="ghost" onClick={() => go("creator")} style={{ marginLeft: 10 }}>Add funds</Btn>
            )}
          </p>
        )}

        {titles.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "-8px 0 20px" }}>
            {titles.map((t, i) => (
              <button key={i} className="pf-btn" onClick={() => setTitle(t)}
                style={{ padding: "6px 10px", borderRadius: 2, cursor: "pointer", background: "transparent",
                  fontFamily: T.mono, fontSize: 11.5,
                  color: title === t ? T.bone : T.boneDim,
                  border: "1px solid " + (title === t ? T.ochre : T.edge) }}>
                {t}
              </button>
            ))}
          </div>
        )}

        <Field label="Game details"
          hint="The story turned into concrete content: who wants what, who trades what, and what stands in the way. This, not the brief or the story arc on their own, is what the world actually gets built from — read it over and edit anything that is not right.">
          <textarea value={gameDetails} onChange={(e) => setGameDetails(e.target.value)} rows={12}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>

        {me?.isAdmin && (
          <div style={{ marginBottom: 8 }}>
            <Btn kind="ghost" disabled={detailsBusy} onClick={regenerateDetails}>
              {detailsBusy ? "writing\u2026" : "Regenerate (admin)"}
            </Btn>
          </div>
        )}
        {detailsError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>{detailsError}</p>
        )}

        <p style={{ fontFamily: T.mono, fontSize: 11, lineHeight: 1.7, color: T.boneDim, margin: "16px 0 20px" }}>
          {money(GEN_BASE_CENTS)} plus {money(GEN_PER_ROOM_CENTS)} a room to build, charged only if it
          succeeds. Pictures are separate and optional. You have {money(me.balance)}.
        </p>

        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={() => setStep(2)}>Back</Btn>
          <Btn kind="solid" disabled={!gameDetails.trim() || !title.trim()} onClick={build}>
            Continue
          </Btn>
        </div>
      </>)}

      {step === 4 && phase === "building" && <Building stage={stage} />}

      {step === 4 && phase === "done" && buildResult && (<>
        <div style={{ border: "1px solid " + T.moss + "55", padding: 18, borderRadius: 2, marginBottom: 22 }}>
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 10 }}>The world is built</div>
          <div style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 2, color: T.boneDim }}>
            <div>{buildResult.stats?.rooms} rooms &middot; {buildResult.stats?.mobs} characters &middot;{" "}
              {buildResult.stats?.items} items &middot; {buildResult.stats?.props ?? 0} things to work &middot;{" "}
              {buildResult.stats?.quests} quests</div>
            <div>{money(buildResult.cost_cents)} charged &middot; built with {buildResult.built_by}</div>
          </div>
          {buildResult.warnings?.length > 0 && (
            <div style={{ marginTop: 14, fontFamily: T.mono, fontSize: 11, lineHeight: 1.8, color: T.ochre }}>
              {buildResult.warnings.map((w, i) => <div key={i}>{w.message ?? String(w)}</div>)}
            </div>
          )}
        </div>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, marginTop: 0 }}>
          The next real step is illustrating it, in the Pictures tab — a world can be published once
          every room, character, item and prop has a picture.
        </p>
        <Btn kind="solid" onClick={() => go("edit", { id: worldId })}>Go to Pictures</Btn>
      </>)}

      {step === 4 && phase === "failed" && (<>
        <div style={{ border: "1px solid " + T.clay + "55", padding: 18, borderRadius: 2, marginBottom: 22 }}>
          <div style={{ fontFamily: T.serif, fontSize: 18, marginBottom: 8 }}>It did not come together</div>
          <p style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.7, color: T.clay, margin: 0 }}>{error}</p>
        </div>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, marginTop: 0 }}>
          Usually this means the brief asks for something the world cannot hold: a character who gives
          you information rather than an object, or a thing with no way to reach it. Try again, or go
          back and make the gate concrete.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
          {needsFunds
            ? <Btn kind="solid" onClick={() => go("creator")}>Add funds</Btn>
            : <Btn kind="solid" onClick={build}>Try again</Btn>}
          <Btn onClick={() => { setPhase("idle"); setStep(3); }}>Edit the details</Btn>
        </div>

        {me?.isAdmin && buildResult?.raw && (
          <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 18 }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 8 }}>
              What the model actually returned ({buildResult.rawLength} characters). Admin only.
            </div>
            <textarea readOnly value={buildResult.raw} rows={14}
              style={{ ...inputStyle, fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, resize: "vertical" }} />
          </div>
        )}
      </>)}
    </div>
  );
}

/* One label per real pass. "plot" writes characters, items, props and the
   quest chain together in a single request — worth knowing if you are
   wondering why "characters" and "quests" are not separate lines here:
   they are not yet separate calls, so this does not pretend they are.
   Splitting plot into its own passes (characters, then items and props,
   then quests last, once gating can be checked against everything else) is
   a real improvement worth making, just not done yet. */
export const GEN_STEPS = [
  { key: "map",   label: "Building the map" },
  { key: "plot",  label: "Placing characters, items, props and the quest chain" },
  { key: "prose", label: "Writing descriptions and voices" },
  { key: "done",  label: "Checking everything is reachable and completable" },
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
