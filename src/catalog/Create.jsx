import React, { useState, useEffect } from "react";
import {
  GEN_FLAT_CENTS,
  createWorld,
  deleteBriefRecord,
  discardDraft,
  generateBriefFromPreset,
  generateGameDetails,
  generateStoryDetails,
  generateWorld,
  loadBriefRecords,
  loadDraft,
  loadPresets,
  money,
  resetWorldForRetry,
  saveBriefRecord,
  saveDraft,
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

// Reference copy of generate-brief's own GENRES/MODES/SUBJECT_TYPES lists,
// shown to a creator so they know what the generator actually picks from
// and can steer it with the hint box below. Kept in sync by hand with
// that function — this is display-only and never sent anywhere itself.
const REFERENCE_GENRES = [
  "sci-fi", "children's", "teen/YA", "noir", "high fantasy", "cyberpunk",
  "post-apocalyptic", "pirate/nautical", "wild west", "steampunk",
  "mythology retold", "urban fantasy", "heist/caper", "fairy tale",
  "historical", "romance", "slice-of-life", "horror", "comedy", "cozy",
];
const REFERENCE_MODES = [
  "mystery", "adventure", "task/action", "sensory", "drama", "wit/comedy",
  "surreal", "hauntings", "survival",
];
const REFERENCE_SUBJECT_TYPES = [
  "an object", "a location", "1 person", "2 people", "3 to 4 people", "an animal or animals",
];

export function Create({ me, refreshWorlds, go }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");           // the step-1 brief
  const [phase, setPhase] = useState("idle");      // idle | building | failed
  const [error, setError] = useState(null);
  const [worldId, setWorldId] = useState(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  // Draft autosave: draftId is the worlds row this wizard is saving into
  // (null until the first save actually happens). pendingDraft holds a
  // found-but-not-yet-applied draft while the resume/start-fresh prompt
  // is showing; draftChecked stops the check from running more than once.
  const [draftId, setDraftId] = useState(null);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState(false);
  // Admin's own saved-brief library — a small, explicit collection kept
  // indefinitely, separate from draft autosave above. Loaded lazily, only
  // once the section is actually opened.
  const [savedBriefs, setSavedBriefs] = useState(null);   // null = not loaded yet
  const [savedBriefsOpen, setSavedBriefsOpen] = useState(false);
  const [savingBrief, setSavingBrief] = useState(false);
  const [briefSaveError, setBriefSaveError] = useState(null);
  const [stage, setStage] = useState(null);        // map | plot | prose | done, while building
  const [buildResult, setBuildResult] = useState(null);

  // step 1: brief
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const [breakdown, setBreakdown] = useState(null);   // admin only — how the model arrived at the brief
  const [hint, setHint] = useState("");
  const [hintBusy, setHintBusy] = useState(false);
  const [hintError, setHintError] = useState(null);
  const [referenceOpen, setReferenceOpen] = useState(false);

  // step 2: story details — the arc, before Game Details turns it into
  // concrete characters, wants and trades
  const [storyDetails, setStoryDetails] = useState("");
  const [storyPresets, setStoryPresets] = useState([]);
  const [chosenStoryPreset, setChosenStoryPreset] = useState("");
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyError, setStoryError] = useState(null);

  // step 3: game details
  const [gameDetails, setGameDetails] = useState("");
  const [suggestedRoomCount, setSuggestedRoomCount] = useState(null);
  const [roomCount, setRoomCount] = useState("");   // string, so an empty box is a real, distinct state
  const [suggestedCharacterCount, setSuggestedCharacterCount] = useState(null);
  const [characterCount, setCharacterCount] = useState("");
  const [suggestedPropCount, setSuggestedPropCount] = useState(null);
  const [propCount, setPropCount] = useState("");
  const [suggestedItemCount, setSuggestedItemCount] = useState(null);
  const [itemCount, setItemCount] = useState("");
  const [titles, setTitles] = useState([]);
  const [originalTitle, setOriginalTitle] = useState("");
  const [altTitlesOpen, setAltTitlesOpen] = useState(false);
  const [detailPresets, setDetailPresets] = useState([]);
  const [chosenDetailPreset, setChosenDetailPreset] = useState("");
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsError, setDetailsError] = useState(null);
  const [titlesBusy, setTitlesBusy] = useState(false);
  const [titlesError, setTitlesError] = useState(null);

  useEffect(() => {
    if (!me?.isAdmin) return;
    loadPresets("story_details").then(setStoryPresets).catch(() => setStoryPresets([]));
    loadPresets("game_details").then(setDetailPresets).catch(() => setDetailPresets([]));
  }, [me?.isAdmin]);

  // Checked once, on the way in — a found draft is offered, never applied
  // automatically, since the creator may genuinely want to start a
  // different game instead of resuming the last one.
  useEffect(() => {
    if (!me?.id || draftChecked) return;
    setDraftChecked(true);
    loadDraft(me.id).then((d) => { if (d) setPendingDraft(d); }).catch(() => {});
  }, [me?.id, draftChecked]);

  const resumeDraft = () => {
    const d = pendingDraft;
    setDraftId(d.id);
    setTitle(d.title);
    setDesc(d.desc);
    setStoryDetails(d.storyDetails);
    setGameDetails(d.gameDetails);
    setTitles(d.titles);
    setSuggestedRoomCount(d.suggestedRoomCount);
    setRoomCount(d.roomCount ? String(d.roomCount) : "");
    setSuggestedCharacterCount(d.suggestedCharacterCount);
    setCharacterCount(d.characterCount ? String(d.characterCount) : "");
    setSuggestedPropCount(d.suggestedPropCount);
    setPropCount(d.propCount ? String(d.propCount) : "");
    setSuggestedItemCount(d.suggestedItemCount);
    setItemCount(d.itemCount ? String(d.itemCount) : "");
    setOriginalTitle(d.originalTitle || d.title);
    setStep(d.step);
    setPendingDraft(null);
  };

  const dismissDraft = async () => {
    const d = pendingDraft;
    setPendingDraft(null);
    try { await discardDraft(d.id); } catch { /* stale draft, not worth surfacing an error for */ }
  };

  // Catches manual edits made after a step's own generation already
  // saved once — tweaking the generated story text, say, right before
  // navigating away. Only runs once a draft row actually exists (the
  // first save always happens at a step transition instead); typing in
  // step 1 alone never creates a row just from typing.
  useEffect(() => {
    if (!draftId || step < 2) return;
    const t = setTimeout(() => {
      saveDraft({
        id: draftId, userId: me.id, step, title, desc, storyDetails, gameDetails, titles,
        suggestedRoomCount, roomCount: roomCount.trim() ? Number(roomCount) : null, originalTitle,
        suggestedCharacterCount, characterCount: characterCount.trim() ? Number(characterCount) : null,
        suggestedPropCount, propCount: propCount.trim() ? Number(propCount) : null,
        suggestedItemCount, itemCount: itemCount.trim() ? Number(itemCount) : null,
      }).then(() => setDraftSaveError(false))
        .catch((e) => { console.error("could not autosave draft", e); setDraftSaveError(true); });
    }, 2000);
    return () => clearTimeout(t);
  }, [draftId, step, title, storyDetails, gameDetails, roomCount, characterCount, propCount, itemCount]);

  const saveBrief = async () => {
    if (!desc.trim()) return;
    setSavingBrief(true); setBriefSaveError(null);
    try {
      await saveBriefRecord({ title, brief: desc });
      if (savedBriefs) setSavedBriefs(await loadBriefRecords());   // refresh only if the list is already showing
    } catch (e) {
      setBriefSaveError(e.message);
    } finally {
      setSavingBrief(false);
    }
  };

  const toggleSavedBriefs = async () => {
    const opening = !savedBriefsOpen;
    setSavedBriefsOpen(opening);
    if (opening && savedBriefs === null) {
      try { setSavedBriefs(await loadBriefRecords()); } catch { setSavedBriefs([]); }
    }
  };

  const applySavedBrief = (b) => {
    setTitle(b.title || "");
    setDesc(b.brief);
    setBreakdown(null);
  };

  const removeSavedBrief = async (id) => {
    try {
      await deleteBriefRecord(id);
      setSavedBriefs((list) => (list ?? []).filter((b) => b.id !== id));
    } catch (e) { setBriefSaveError(e.message); }
  };

  const generate = async () => {
    setGenBusy(true); setGenError(null);
    try {
      const res = await generateBriefFromPreset();
      setTitle(res.title || title);
      setDesc(res.brief);
      setBreakdown(res.breakdown ?? null);
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenBusy(false);
    }
  };

  // The hint-driven version — same generator, but the creator's own free
  // text steers genre/mode/subject wherever it says something specific.
  // An empty box is allowed on purpose: it just behaves like "generate an
  // example" below, since the server already treats an empty hint as no
  // hint at all and falls through to the fully random path.
  const generateFromHint = async () => {
    setHintBusy(true); setHintError(null);
    try {
      const res = await generateBriefFromPreset(null, hint.trim());
      setTitle(res.title || title);
      setDesc(res.brief);
      setBreakdown(res.breakdown ?? null);
    } catch (e) {
      setHintError(e.message);
    } finally {
      setHintBusy(false);
    }
  };

  // Step 1 -> step 2: flesh the brief into a story arc.
  const advanceToStory = async () => {
    setStoryBusy(true); setStoryError(null);
    try {
      const res = await generateStoryDetails({ mode: "full", title, brief: desc });
      const newStoryDetails = res.storyDetails ?? "";
      setStoryDetails(newStoryDetails);
      setSuggestedRoomCount(res.suggestedRoomCount ?? null);
      setSuggestedCharacterCount(res.suggestedCharacterCount ?? null);
      setSuggestedPropCount(res.suggestedPropCount ?? null);
      setSuggestedItemCount(res.suggestedItemCount ?? null);
      setStep(2);
      try {
        const id = await saveDraft({
          id: draftId, userId: me.id, step: 2, title, desc, storyDetails: newStoryDetails,
          suggestedRoomCount: res.suggestedRoomCount ?? null,
          suggestedCharacterCount: res.suggestedCharacterCount ?? null,
          suggestedPropCount: res.suggestedPropCount ?? null,
          suggestedItemCount: res.suggestedItemCount ?? null,
        });
        setDraftId(id);
        setDraftSaveError(false);
      } catch (e) { console.error("could not save draft", e); setDraftSaveError(true); }
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
  // before anything is generated. All four counts are settled by now
  // (step 2), not changeable here — the plot this call writes is built
  // to fit them, so letting any change afterward would risk contradicting
  // content already generated around specific numbers.
  const advanceToDetails = async () => {
    setDetailsBusy(true); setDetailsError(null);
    try {
      const effectiveRoomCount = roomCount.trim() ? Number(roomCount) : suggestedRoomCount;
      const effectiveCharacterCount = characterCount.trim() ? Number(characterCount) : suggestedCharacterCount;
      const effectivePropCount = propCount.trim() ? Number(propCount) : suggestedPropCount;
      const effectiveItemCount = itemCount.trim() ? Number(itemCount) : suggestedItemCount;
      const res = await generateGameDetails({
        mode: "full", title, brief: desc, storyDetails,
        roomCount: effectiveRoomCount || undefined,
        characterCount: effectiveCharacterCount || undefined,
        propCount: effectivePropCount || undefined,
        itemCount: effectiveItemCount || undefined,
      });
      const newGameDetails = res.gameDetails ?? "";
      const newTitles = res.titles ?? [];
      setGameDetails(newGameDetails);
      setTitles(newTitles);
      setOriginalTitle(title);
      setStep(3);
      try {
        const id = await saveDraft({
          id: draftId, userId: me.id, step: 3, title, desc, storyDetails,
          gameDetails: newGameDetails, titles: newTitles,
          suggestedRoomCount, roomCount: effectiveRoomCount || null,
          suggestedCharacterCount, characterCount: effectiveCharacterCount || null,
          suggestedPropCount, propCount: effectivePropCount || null,
          suggestedItemCount, itemCount: effectiveItemCount || null,
          originalTitle: title,
        });
        setDraftId(id);
        setDraftSaveError(false);
      } catch (e) { console.error("could not save draft", e); setDraftSaveError(true); }
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
      if (id) {
        // Retrying an existing world: the row's status still shows the
        // previous failure, and watchGeneration only keeps polling while
        // it sees "generating" — without this, its very first check can
        // catch that stale status and stop forever before the server
        // gets a chance to flip it back. Silent generation, no visible
        // progress, even though it is genuinely still running.
        await resetWorldForRetry(id);
      } else {
        // User's own number wins if they typed one; otherwise fall back to
        // whatever the AI suggested in step 2. All already clamped (each
        // input won't accept outside its own max, and the server clamps
        // its own suggestion before it ever reaches this state).
        const effectiveRoomCount = roomCount.trim() ? Number(roomCount) : suggestedRoomCount;
        const effectiveCharacterCount = characterCount.trim() ? Number(characterCount) : suggestedCharacterCount;
        const effectivePropCount = propCount.trim() ? Number(propCount) : suggestedPropCount;
        const effectiveItemCount = itemCount.trim() ? Number(itemCount) : suggestedItemCount;
        id = await createWorld({
          userId: me.id,
          title: title.trim() || "Untitled world",
          brief: gameDetails.trim() || storyDetails.trim() || desc.trim(),
          gameBrief: desc.trim() || null,
          storyDetails: storyDetails.trim() || null,
          roomMin: effectiveRoomCount || null,
          roomMax: effectiveRoomCount || null,
          characterMin: effectiveCharacterCount || null,
          characterMax: effectiveCharacterCount || null,
          propMin: effectivePropCount || null,
          propMax: effectivePropCount || null,
          itemMin: effectiveItemCount || null,
          itemMax: effectiveItemCount || null,
          existingId: draftId,
        });
      }
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

      {pendingDraft && (
        <div style={{ marginBottom: 24, padding: "14px 16px", border: "1px solid " + T.ochre + "66",
          borderRadius: 2, background: T.ochre + "0d" }}>
          <div style={{ fontFamily: T.serif, fontSize: 15, marginBottom: 4 }}>
            You have an unfinished draft{pendingDraft.title ? `: "${pendingDraft.title}"` : ""}
          </div>
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, margin: "0 0 12px", lineHeight: 1.6 }}>
            Left partway through — pick up where you stopped, or start a new game instead.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn kind="solid" onClick={resumeDraft}>Resume draft</Btn>
            <Btn onClick={dismissDraft}>Start fresh instead</Btn>
          </div>
        </div>
      )}

      {draftSaveError && (
        <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 16px", lineHeight: 1.6 }}>
          Your progress could not be saved just now — if you leave this page, what you've done so far
          may not be here when you come back. Still safe to keep working; this will keep retrying.
        </p>
      )}

      <div style={{ display: "flex", gap: 18, marginBottom: 28, flexWrap: "wrap" }}>
        {steps.map((label, i) => (
          <div key={label} style={{ fontFamily: T.mono, fontSize: 11.5,
            color: step === i + 1 ? T.ochre : step > i + 1 ? T.boneDim : T.edge }}>
            {step > i + 1 ? "\u2713 " : (i + 1) + ". "}{label}
          </div>
        ))}
      </div>

      {step === 1 && (<>
        {me?.isAdmin && (<>
          <button onClick={() => setReferenceOpen((o) => !o)} className="pf-btn"
            style={{ background: "none", border: "none", padding: 0, marginBottom: 10, cursor: "pointer",
              fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {referenceOpen ? "\u2212 hide" : "+ show"} the genres and modes the generator picks from
          </button>
          {referenceOpen && (
            <div style={{ marginBottom: 14, padding: "12px 14px", border: "1px solid " + T.edge, borderRadius: 2,
              fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.9, color: T.boneDim }}>
              <div><b style={{ color: T.bone }}>Genres:</b> {REFERENCE_GENRES.join(", ")}</div>
              <div style={{ marginTop: 6 }}>
                <b style={{ color: T.bone }}>Modes</b> (one or two combine, like survival/adventure):{" "}
                {REFERENCE_MODES.join(", ")}
              </div>
              <div style={{ marginTop: 6 }}>
                <b style={{ color: T.bone }}>Subject types:</b> {REFERENCE_SUBJECT_TYPES.join(", ")}
              </div>
            </div>
          )}

          <Field label="Or steer it yourself (admin only)" hint="Name a genre, a mode, a subject — anything from the list above or not. Whatever you say here overrides the random pick for that one thing; anything you don't mention still gets picked at random.">
            <textarea value={hint} onChange={(e) => setHint(e.target.value)} rows={2}
              placeholder="e.g. cyberpunk, and make it a comedy"
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
          </Field>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
            <Btn kind="ghost" disabled={hintBusy} onClick={generateFromHint}>
              {hintBusy ? "writing\u2026" : "generate"}
            </Btn>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>$0.01</span>
          </div>
          {hintError && (
            <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 8px" }}>{hintError}</p>
          )}
        </>)}

        {me?.isAdmin && breakdown && (
          <div style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid " + T.ochre + "66",
            borderRadius: 2, fontFamily: T.mono, fontSize: 11, lineHeight: 1.8, color: T.boneDim }}>
            <div style={{ color: T.ochre, marginBottom: 2 }}>Admin only — how this was assembled</div>
            <div><b style={{ color: T.bone }}>Genre (picked in code):</b> {breakdown.genre || "\u2014"}</div>
            <div><b style={{ color: T.bone }}>Mode (picked in code):</b> {breakdown.mode || "\u2014"}</div>
            <div><b style={{ color: T.bone }}>Subject type (picked in code):</b> {breakdown.subject_type || "\u2014"}</div>
            <div><b style={{ color: T.bone }}>Subject (the model's own choice):</b> {breakdown.subject || "\u2014"}</div>
            {breakdown.hint && (
              <div><b style={{ color: T.bone }}>Your hint (overrides the above):</b> {breakdown.hint}</div>
            )}
          </div>
        )}

        <Field label="Title">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Lamp Room" />
        </Field>
        <Field label="Describe the world"
          hint="Places, who is in them, what they want, and above all what cannot be talked around. The rules you write here are the ones the game will enforce.">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={10}
            placeholder="Somewhere real enough to walk around in"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <Btn kind="ghost" disabled={genBusy} onClick={generate}>
            {genBusy ? "writing\u2026" : desc.trim() ? "generate another" : "generate an example"}
          </Btn>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>$0.01</span>
          {me?.isAdmin && (
            <Btn kind="ghost" disabled={savingBrief || !desc.trim()} onClick={saveBrief}>
              {savingBrief ? "saving\u2026" : "save"}
            </Btn>
          )}
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginLeft: "auto" }}>
            {desc.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </div>
        {briefSaveError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 8px" }}>{briefSaveError}</p>
        )}

        {me?.isAdmin && (<>
          <button onClick={toggleSavedBriefs} className="pf-btn"
            style={{ background: "none", border: "none", padding: 0, marginBottom: savedBriefsOpen ? 10 : 14,
              cursor: "pointer", fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {savedBriefsOpen ? "\u2212 hide" : "+ show"} my saved briefs
          </button>
          {savedBriefsOpen && (
            <div style={{ marginBottom: 16 }}>
              {savedBriefs === null ? (
                <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading\u2026</p>
              ) : savedBriefs.length === 0 ? (
                <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>Nothing saved yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {savedBriefs.map((b) => (
                    <div key={b.id} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                      padding: "10px 12px", border: "1px solid " + T.edge, borderRadius: 2 }}>
                      <button onClick={() => applySavedBrief(b)} className="pf-btn"
                        style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0,
                          cursor: "pointer" }}>
                        <div style={{ fontFamily: T.serif, fontSize: 14, color: T.bone, marginBottom: 2 }}>
                          {b.title || "(untitled)"}
                        </div>
                        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, lineHeight: 1.5,
                          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {b.brief}
                        </div>
                      </button>
                      <button onClick={() => removeSavedBrief(b.id)} className="pf-btn"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                          fontFamily: T.mono, fontSize: 11, color: T.clay, flexShrink: 0 }}>
                        remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>)}

        {genError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 8px" }}>{genError}</p>
        )}
        {storyError && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 8px" }}>{storyError}</p>
        )}

        <div style={{ marginBottom: 20 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Btn kind="solid" disabled={desc.trim().length < 40 || !title.trim() || storyBusy}
            onClick={advanceToStory}>
            {storyBusy ? "fleshing it out\u2026" : "Continue"}
          </Btn>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {money(GEN_FLAT_CENTS)} to build the world, charged only if it succeeds
          </span>
        </div>
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

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: T.serif, fontSize: 15, marginBottom: 8 }}>How much should this world hold?</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            {[
              { label: "Rooms", value: roomCount, set: setRoomCount, suggested: suggestedRoomCount, max: 20 },
              { label: "Characters", value: characterCount, set: setCharacterCount, suggested: suggestedCharacterCount, max: 12 },
              { label: "Props", value: propCount, set: setPropCount, suggested: suggestedPropCount, max: 15 },
              { label: "Items", value: itemCount, set: setItemCount, suggested: suggestedItemCount, max: 20 },
            ].map((f) => (
              <label key={f.label} style={{ display: "block" }}>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 4 }}>{f.label}</div>
                <input type="text" inputMode="numeric" value={f.value}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "");
                    if (v === "") { f.set(""); return; }
                    f.set(String(Math.min(f.max, Math.max(1, Number(v)))));
                  }}
                  placeholder={f.suggested ? String(f.suggested) : "\u2014"}
                  style={{ ...inputStyle, width: 72 }} />
              </label>
            ))}
          </div>
          <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, margin: "8px 0 0", lineHeight: 1.6 }}>
            {suggestedRoomCount ? `${suggestedRoomCount} rooms is suggested` : "A newcomer-friendly size is suggested"} for
            this story, with characters, props and items suggested to match. Leave any of them blank to use
            what's suggested, or set your own — more rooms means a bigger map to explore. Settled here, not
            changeable later, since Game Details writes its plot to fit whatever is chosen.
          </p>
        </div>

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
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <button onClick={() => setAltTitlesOpen((o) => !o)} className="pf-btn"
          style={{ background: "none", border: "none", padding: 0, marginBottom: altTitlesOpen ? 10 : 20,
            cursor: "pointer", fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
          {altTitlesOpen ? "\u2212" : "+"} Alternative titles
        </button>
        {altTitlesOpen && (<>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <button className="pf-btn" onClick={() => setTitle(originalTitle)}
              style={{ padding: "6px 10px", borderRadius: 2, cursor: "pointer", background: "transparent",
                fontFamily: T.mono, fontSize: 11.5,
                color: title === originalTitle ? T.bone : T.boneDim,
                border: "1px solid " + (title === originalTitle ? T.ochre : T.edge) }}>
              {originalTitle} (original)
            </button>
            <button className="pf-btn" disabled={titlesBusy}
              onClick={regenerateTitles}
              style={{ background: "none", border: "1px solid " + T.edge, borderRadius: 2,
                cursor: titlesBusy ? "default" : "pointer", padding: "8px 12px",
                fontFamily: T.mono, fontSize: 11, color: T.boneDim, whiteSpace: "nowrap" }}>
              {titlesBusy ? "\u2026" : `Regenerate \u00b7 ${money(1)}`}
            </button>
          </div>

          {titlesError && (
            <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>
              {titlesError}
              {needsFunds && (
                <Btn kind="ghost" onClick={() => go("creator")} style={{ marginLeft: 10 }}>Add funds</Btn>
              )}
            </p>
          )}

          {titles.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 20px" }}>
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
        </>)}

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
          Pictures are separate and optional. You have {money(me.balance)}.
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
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 16 }}>The world is built</div>

          <StageChecklist stage="finished" />

          <div style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 2, color: T.boneDim, marginTop: 14 }}>
            <div>{buildResult.stats?.rooms} rooms &middot; {buildResult.stats?.mobs} characters &middot;{" "}
              {buildResult.stats?.items} items &middot; {buildResult.stats?.props ?? 0} things to work &middot;{" "}
              {buildResult.stats?.quests} quests</div>
            <div>Built successfully.</div>
          </div>

          {me?.isAdmin && buildResult.usage && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid " + T.edge,
              fontFamily: T.mono, fontSize: 11, lineHeight: 1.9, color: T.boneDim }}>
              <div style={{ color: T.ochre, marginBottom: 2 }}>Admin only</div>
              <div>{buildResult.built_by}</div>
              <div>{buildResult.usage.prompt_tokens.toLocaleString()} input tokens &middot;{" "}
                {buildResult.usage.completion_tokens.toLocaleString()} output tokens</div>
              <div>
                {"~"}{money(Math.round(buildResult.usage.estimated_provider_cost_cents))} estimated provider
                cost{" "}
                {buildResult.usage.estimated_provider_cost_cents < 1 &&
                  `($${(buildResult.usage.estimated_provider_cost_cents / 100).toFixed(4)})`}
              </div>
            </div>
          )}
        </div>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, marginTop: 0 }}>
          The next real step is illustrating it, in the Pictures tab — a world can be published once
          every room, character, item and prop has a picture.
        </p>
        <Btn kind="solid" onClick={() => go("edit", { id: worldId, tab: "art" })}>Go to Pictures</Btn>
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

/** Just the checkmark list, no title/clock/footer — shared by Building
    (mid-progress, showing which step is active) and the done screen
    (stage="done", which makes every step read as complete rather than
    disappearing entirely once the build finishes). */
export function StageChecklist({ stage }) {
  // "finished" is not one of GEN_STEPS's own keys — it means the whole
  // build is done, so every step (including the last one) should read as
  // complete, not just the steps before whichever one matched "stage".
  const at = stage === "finished" ? GEN_STEPS.length : GEN_STEPS.findIndex((s) => s.key === stage);
  return (
    <div>
      {GEN_STEPS.map((s, i) => {
        const state = at < 0 ? "pending" : i < at ? "done" : i === at ? "active" : "pending";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10,
            fontFamily: T.mono, fontSize: 12.5, lineHeight: 2.1,
            color: state === "done" ? T.moss : state === "active" ? T.ochre : T.edge }}>
            <span style={{ width: 14, flexShrink: 0 }}>{state === "done" ? "\u2713" : state === "active" ? "\u00b7" : ""}</span>
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

export function Building({ stage }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div style={{ border: "1px solid " + T.edge, padding: "30px 22px", borderRadius: 2 }}>
      <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 16 }}>
        Building the world
      </div>

      <StageChecklist stage={stage} />

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
