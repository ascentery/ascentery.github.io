import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { narrate } from "../lib/supabase";
import {
  loadArt,
  loadWorldData,
} from "../lib/db";
import { makeEngine } from "../engine/engine";
import { useCoarsePointer, useNarrow, useVisualViewport } from "../hooks";
import { LogLine } from "./LogLine";
import { DIR_LETTER, VERBS, keepFocus, readable, titleCase, wantsFocus } from "./chrome";
import { useNarrator } from "./useNarrator";
import { P } from "../theme";
import { EyeIcon, Glyph, PinIcon } from "../ui/icons";

export function PlayLoader({ worldId, char, save, onSave, onExit, onHome }) {
  const [world, setWorld] = useState(null);
  const [art, setArt] = useState({ room: {}, mob: {}, item: {}, prop: {} });
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadWorldData(worldId),
      // Art is optional — a world with no pictures still plays.
      loadArt(worldId).catch(() => []),
    ])
      .then(([{ data }, entries]) => {
        if (cancelled) return;
        const byKind = { room: {}, mob: {}, item: {}, prop: {} };
        for (const e of entries) {
          if (e.url && byKind[e.kind]) byKind[e.kind][e.key] = e.url;
        }
        setArt(byKind);
        setWorld(data);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [worldId]);

  if (error) return (
    <div style={{ background: P.paper, minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <p style={{ fontFamily: "Newsreader, serif", fontSize: 18, color: P.ink }}>{error}</p>
        <button onClick={onExit} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
          padding: "8px 16px", background: "transparent", border: "1px solid " + P.ink, color: P.ink, cursor: "pointer" }}>
          Back
        </button>
      </div>
    </div>
  );

  if (!world) return (
    <div style={{ background: P.paper, minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft }}>opening</span>
    </div>
  );

  return <Play world={world} art={art} char={char} save={save} onSave={onSave}
    onExit={onExit} onHome={onHome} />;
}

export function Play({ world, art = {}, char, save, onSave, onExit, onHome }) {
  // One engine per world. Every rule below is the world's, not the app's.
  const E = useMemo(() => makeEngine(world), [world]);
  const { WORLD, freshState, reconcile, itemName, propName, mobsInRoom, propsInRoom, itemsInRoom, propVisible, applyEffects, buildPrompt, directCommand } = E;

  /* Pinned by default: the picture stays put and the text below it starts
     fresh in each room, which reads like being somewhere rather than like
     scrolling back through a transcript. */
  const [pinned, setPinned] = useState(true);
  const [overlay, setOverlay] = useState(true);

  /* Walking into a room is a sequence: the place, then who is in it, then
     what is lying about. Each part is skipped if there is nothing to show. */
  const arrival = (roomKey, st = state, withHeading = !pinned) => {
    const room = WORLD.rooms[roomKey];
    const entries = [];

    // When pinned, the panel above already carries the picture and the name,
    // so repeating them here would say everything twice.
    if (withHeading) {
      const roomArt = art.room?.[roomKey];
      if (roomArt) entries.push({ kind: "art", url: roomArt, text: room?.name ?? "" });
      entries.push({ kind: roomArt ? "room-under-art" : "room", text: room?.name ?? roomKey });
    }
    if (room?.desc) entries.push({ kind: "narration", text: room.desc });

    for (const id of mobsInRoom(st, roomKey)) {
      const mob = WORLD.mobs[id];
      entries.push({
        kind: "presence",
        url: art.mob?.[id] ?? null,
        name: mob.name,
        text: mob.card?.presence || `${mob.name} is here.`,
      });
    }

    /* Props first, then items, in one row: they read as "what is in this
       room" rather than as two separate categories the player has to parse
       apart. */
    const fixtures = propsInRoom(st, roomKey);
    const here = itemsInRoom(st, roomKey);
    if (fixtures.length || here.length) {
      entries.push({
        kind: "items",
        label: "You see",
        items: [
          ...fixtures.map((id) => ({ key: id, name: WORLD.props[id].name, url: art.prop?.[id] ?? null })),
          ...here.map((id) => ({ key: id, name: itemName(id), url: art.item?.[id] ?? null })),
        ],
      });
    }

    return entries;
  };

  /* A save from before the world was edited is brought into line rather
     than discarded; whatever changed is announced once, in the log. */
  const opened = useMemo(() => {
    if (!save?.state) return { state: freshState(), notes: [] };
    const { state: fixed, changes } = reconcile(save.state);
    return { state: fixed, notes: changes };
  }, []);

  const [state, setState] = useState(opened.state);
  const [log, setLog] = useState(() => {
    const base = save?.log ?? [];
    if (!base.length) return arrival(WORLD.startRoom, opened.state, !pinned);
    if (!opened.notes.length) return base;
    return [
      ...base,
      { kind: "system", text: "This world has been changed since you were last here." },
      ...opened.notes.map((text) => ({ kind: "system", text })),
      ...arrival(opened.state.player.room, opened.state, !pinned),
    ];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // On by default. Browsers will not speak until the page has been
  // interacted with, so nothing is heard until the first command anyway.
  const [voice, setVoice] = useState(true);
  const [voiceURI, setVoiceURI] = useState(null);
  const [rate, setRate] = useState(0.95);
  const [voicePanel, setVoicePanel] = useState(false);
  /* Holding an item is a UI state, not a game state: it means "this is the
     one I will hand over if I tap somebody". */
  const [held, setHeld] = useState(null);
  /* The action bar is the alternative to typing: pick a verb, then tap what
     it applies to. `verb` is what is waiting for a target. */
  const [actions, setActions] = useState(false);
  const [verb, setVerb] = useState(null);
  /* What the last action was aimed at. Shown where the room name goes, so
     the bar answers "what am I dealing with" rather than repeating where
     you are, which the panel above already says. */
  const [subject, setSubject] = useState(null);
  const narrator = useNarrator(voice, voiceURI, rate);
  const vv = useVisualViewport();
  const narrow = useNarrow();
  const coarse = useCoarsePointer();
  const [inputFocused, setInputFocused] = useState(false);

  /* With a keyboard up on a phone there is barely three hundred pixels of
     visible height. Rather than shrink everything, the transcript steps out
     of the way: the picture and the input are what you need while typing,
     and the text comes back the moment the keyboard closes.

     Focus rather than viewport arithmetic. Comparing window.innerHeight
     against visualViewport.height used to work, but the viewport meta asks
     the browser for interactive-widget=resizes-content, which shrinks both
     together and leaves nothing to measure. Focus says the same thing more
     directly: on a phone the keyboard is up exactly when the field has it. */
  const onPhone = coarse || narrow;
  /* Focus alone is not enough: a keyboard can be swiped away without the
     field losing focus, and the transcript should come back when the room
     to show it does. Where the viewport cannot be measured, focus stands
     in on its own. */
  const typing = pinned && onPhone && inputFocused && (vv ? vv.shrunk : true);
  const logRef = useRef(null), inputRef = useRef(null), stateRef = useRef(state), busyRef = useRef(busy);
  const narratorRef = useRef(narrator);
  stateRef.current = state; busyRef.current = busy; narratorRef.current = narrator;

  /* Follow the newest line when the page is full, but leave a short page
     alone at the top. Scrolling a two-line description to the bottom of the
     panel is how a cleared room ends up looking empty. */
  useEffect(() => {
    const el = logRef.current;
    // Hidden elements measure zero, so scrolling one leaves it at the top
    // when it reappears. Wait until it is on screen again.
    if (!el || el.offsetParent === null) return;
    if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    else el.scrollTop = 0;
  }, [log, busy, typing]);
  useEffect(() => { onSave({ state, log }); }, [state, log]);

  // Once it is no longer in your hands there is nothing to hold ready.
  useEffect(() => {
    if (held && !state.player.inventory.includes(held)) setHeld(null);
  }, [state.player.inventory, held]);

  // A new room is a new subject.
  useEffect(() => { setSubject(null); }, [state.player.room]);

  /* The ambient timer fires often and then declines most of the time: it
     skips while a turn is resolving, while the narrator is speaking, and at
     random otherwise. Checking often and refusing is better than a long
     fixed interval, because a skipped slot would otherwise cost a full
     cycle of silence. */
  const lastAmbient = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (busyRef.current || stateRef.current.over) return;
      if (Date.now() - lastAmbient.current < 20000) return;
      const pool = WORLD.rooms[stateRef.current.player.room]?.ambient ?? [];
      if (!pool.length) return;

      /* Ambient lines are filler. If the narrator is mid-sentence they are
         not worth cutting in on, and printing one silently would leave text
         nobody heard. Skip the tick and try again next time. */
      if (narratorRef.current?.isSpeaking()) return;

      lastAmbient.current = Date.now();
      const line = pool[Math.floor(Math.random() * pool.length)];
      setLog((l) => [...l, { kind: "ambient", text: line }]);
      narratorRef.current?.speak(line);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback(async (override) => {
    const command = String(typeof override === "string" ? override : input).trim();
    if (!command || busy || state.over) return;
    if (typeof override !== "string") setInput("");
    setLog((l) => [...l, { kind: "you", text: command }]);

    // Deterministic commands never reach the narrator.
    const direct = directCommand(state, command);
    if (direct.handled) {
      if (direct.inventory) {
        const inv = state.player.inventory;
        const entries = inv.length
          ? [{
              kind: "items",
              label: "carrying",
              items: inv.map((id) => ({ key: id, name: itemName(id), url: art.item?.[id] ?? null })),
            }]
          : [{ kind: "system", text: "You are carrying nothing." }];
        setLog((l) => [...l, ...entries]);
        return;
      }

      if (direct.look) {
        const entries = arrival(state.player.room);
        // Looking is asking to see the room again, so pinned it replaces the
        // page rather than adding a second copy below the first.
        setLog((l) => (pinned ? entries : [...l, ...entries]));
        narrator.speak(readable(entries));
        return;
      }
      if (direct.entries) {
        setLog((l) => [...l, ...direct.entries]);
        if (!onPhone) setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      const { state: next, log: engineLog } = applyEffects(state, direct.effects);
      const moved = next.player.room !== state.player.room;
      const entries = [...engineLog];

      // Picking something up changes what is on the floor; say what is left.
      if (direct.effects.some((x) => x.take || x.drop)) {
        const here = itemsInRoom(next, next.player.room);
        if (here.length) {
          entries.push({ kind: "system", text: `Still here: ${here.map(itemName).join(", ")}.` });
        }
      }
      if (moved) entries.push(...arrival(next.player.room, next));

      /* Pinned, a new room starts a clean page: the picture above changes
         and the text below begins at the top rather than continuing a
         transcript the player has already read. */
      setLog((l) => (pinned && moved ? entries : [...l, ...entries]));
      setState(next);
      narrator.speak(readable(entries));
      if (!onPhone) setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    setBusy(true);
    try {
      // The narrate edge function holds the model key and returns
      // { reply, effects } already parsed.
      const parsed = await narrate({
        prompt: buildPrompt(state, char?.name ?? "the traveller"),
        command,
      });

      const { state: next, log: engineLog } = applyEffects(state, parsed.effects ?? []);
      const moved = next.player.room !== state.player.room;
      const entries = [];
      // The sentence describing the move survives the clear: it is the last
      // thing that happened in the old room and the first in the new one.
      if (parsed.reply) entries.push({ kind: "narration", text: parsed.reply });
      entries.push(...engineLog);
      if (moved) entries.push(...arrival(next.player.room, next));

      setLog((l) => (pinned && moved ? entries : [...l, ...entries]));
      setState(next);
      narrator.speak(readable(entries));
    } catch (err) {
      setLog((l) => [...l, { kind: "system", text: err.message || "The connection dropped mid-sentence. Try the command again." }]);
    } finally {
      setBusy(false);
      // Refocusing on a phone would pop the keyboard straight back up and
      // hide the reply the player just waited for.
      if (!onPhone) setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [input, busy, state, char, onPhone]);

  const restart = () => {
    setState(freshState());
    setLog(arrival(WORLD.startRoom, undefined, !pinned));
  };

  /* Every target — a character or an item, in the overlay or the bottom bar
     — asks this what a tap should do. Keeping the decision in one place
     means the action bar and the plain taps cannot drift apart. */
  const tapTarget = (kind, id) => {
    // Buttons stay enabled while a turn is in flight, because disabling one
    // under a finger blurs the input and drops the keyboard. They simply do
    // nothing instead.
    if (busy || state.over) return;
    const isMob = kind === "mob";
    const label = isMob ? (WORLD.mobs[id]?.name ?? id) : itemName(id);

    // Giving takes two taps: what you are holding out, then who to.
    if (verb === "give") {
      if (!isMob) { setHeld(id); return; }
      if (held) { submit(`give the ${itemName(held)} to ${label}`); setHeld(null); setVerb(null); }
      return;
    }

    if ((verb === "open" || verb === "close") && isMob) {
      // A person is not a thing to be opened.
      setVerb(null);
      return;
    }

    if (verb) {
      submit(`${verb} ${label}`);
      setSubject(label);
      setVerb(null);
      return;
    }

    // No verb chosen: the old behaviour.
    if (kind === "carried") { setHeld(held === id ? null : id); return; }
    if (isMob) {
      if (held) { submit(`give the ${itemName(held)} to ${label}`); setHeld(null); }
      else submit(`look at ${label}`);
      setSubject(label);
      return;
    }
    submit(`take ${label}`);
    setSubject(label);
  };

  const room = WORLD.rooms[state.player.room];
  const carrying = state.player.inventory.map(itemName);
  const hpFrac = state.player.hp / state.player.maxHp;

  return (
    <div
      /* A tap on the background — the room picture, a gap in a bar, the
         transcript — should not close the keyboard. Preventing the default
         at the surface keeps focus wherever it already is, and anything
         that genuinely wants focus (the input, the voice controls) stops
         the event before it reaches here. */
      onMouseDown={(e) => { if (!wantsFocus(e.target)) e.preventDefault(); }}
      onTouchStart={(e) => {
        /* Preventing the default on touchstart also cancels scrolling, so
           the two scrollable regions are left alone. Everything else in the
           surface is a button or a picture, and neither needs to scroll. */
        if (wantsFocus(e.target)) return;
        if (e.target?.closest?.(".hr-log, .hr-actions, .hr-scroll")) return;
        e.preventDefault();
      }}
      style={{
        background: P.paper, color: P.ink, overflow: "hidden",
        width: "100%", maxWidth: "100vw",
        // Fixed to the visible area, so the keyboard cannot push it out of view.
        position: "fixed", left: 0,
        top: vv ? vv.top : 0,
        height: vv ? vv.height : "100dvh",
      }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; } body { margin: 0 }
        html, body { overflow: hidden; overscroll-behavior: none; }
        .hr-log, .hr-actions { scrollbar-width: none; -ms-overflow-style: none; }
        .hr-log::-webkit-scrollbar,
        .hr-actions::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .hr-in::placeholder { color: ${P.inkSoft}88 }
        .hr-in:focus { outline: none }
        .hr-btn:focus-visible { outline: 2px solid ${P.ochre}; outline-offset: 2px }
        @keyframes hrIn { from { opacity: 0 } to { opacity: 1 } }
        .hr-fade { animation: hrIn .5s ease both }
        @media (prefers-reduced-motion: reduce) { .hr-fade { animation: none } }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", height: "100%", width: "100%",
        display: "flex", flexDirection: "column", overflowX: "hidden",
        borderLeft: `1px solid ${P.inkSoft}22`, borderRight: `1px solid ${P.inkSoft}22` }}>

        {/* name · title · controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          padding: "12px 16px 10px", borderBottom: `1px solid ${P.inkSoft}33`,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft }}>

          <button
            className="hr-btn"
            onClick={() => { narrator.stop(); onHome?.(); }}
            title="Back to your games"
            style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
              padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: P.inkSoft,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {char?.name}
          </button>

          <button
            className="hr-btn"
            onClick={() => { narrator.stop(); onExit(); }}
            title="Back to this world"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
              fontFamily: "Newsreader, serif", fontSize: 16, color: P.ink, whiteSpace: "nowrap" }}>
            {WORLD.title}
          </button>

          <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 12,
            alignItems: "center", justifyContent: "flex-end" }}>
            <button
              className="hr-btn"
              onClick={() => {
                const next = !pinned;
                setPinned(next);
                /* Unpinning removes the panel, so the room needs its picture
                   and name back in the log or the player loses track of
                   where they are. Pinning does the reverse: the panel takes
                   over, and the page starts clean. */
                setLog(next
                  ? arrival(state.player.room, state, false)
                  : (l) => [...l, ...arrival(state.player.room, state, true)]);
              }}
              title={pinned ? "Unpin the room" : "Pin the room to the top"}
              aria-pressed={pinned}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                display: "inline-flex", alignItems: "center",
                color: pinned ? P.ochre : P.inkSoft }}>
              <PinIcon pinned={pinned} />
            </button>
            {narrator.supported && (
              <button
                className="hr-btn"
                onClick={() => {
                  if (voice) narrator.stop();
                  setVoice((v) => !v);
                }}
                title={voice ? "Stop reading aloud" : "Read the story aloud"}
                aria-pressed={voice}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 11, color: voice ? P.ochre : P.inkSoft }}>
                {voice ? "voice" : "muted"}
              </button>
            )}
            <button className="hr-btn" onClick={() => setVoicePanel((v) => !v)} title="Settings"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                fontFamily: "inherit", fontSize: 12, color: voicePanel ? P.ochre : P.inkSoft }}>
              ⚙
            </button>
          </span>
        </div>

        {pinned && (
          <div style={{
            borderBottom: `1px solid ${P.inkSoft}33`, background: P.paperDeep,
            display: "flex", flexDirection: "column", minHeight: 0,
            // While typing this is the only thing above the input, so it
            // takes whatever room the hidden transcript left behind.
            flex: typing ? "1 1 auto" : "0 0 auto",
          }}>
            {art.room?.[state.player.room] && (
              <div style={{ position: "relative", minHeight: 0, display: "flex" }}>
                <img
                  src={art.room[state.player.room]}
                  alt=""
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{
                    display: "block", width: "100%", objectFit: "cover",
                    imageRendering: "pixelated",
                    ...(typing
                      ? { flex: 1, minHeight: 0 }
                      : { aspectRatio: "16 / 9", maxHeight: "34vh" }),
                  }} />

                {/* Who and what is here, laid over the room itself. People
                    to the left, things to the right, both stacking upward
                    from the floor of the picture. */}
                {overlay && (
                  <>
                    <div style={{ position: "absolute", left: 8, bottom: 8, display: "flex",
                      flexDirection: "column-reverse", gap: 6 }}>
                      {mobsInRoom(state, state.player.room).map((id) => {
                        const url = art.mob?.[id];
                        if (!url) return null;
                        const who = WORLD.mobs[id]?.name ?? id;
                        return (
                          <button key={id} className="hr-btn"
                            title={verb ? `${verb} ${who}` : held ? `Give the ${itemName(held)} to ${who}` : `Look at ${who}`}
                            onClick={() => tapTarget("mob", id)}
                            {...keepFocus}
                            style={{ padding: 0, background: P.ink, cursor: busy ? "default" : "pointer",
                              border: `1px solid ${held ? P.ochre : P.paper}`, lineHeight: 0,
                              boxShadow: "0 1px 3px rgba(0,0,0,.4)" }}>
                            <img src={url} alt={who}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                              style={{ width: 46, height: 46, objectFit: "cover", objectPosition: "50% 25%",
                                imageRendering: "pixelated", display: "block" }} />
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ position: "absolute", right: 8, bottom: 8, display: "flex",
                      flexDirection: "column-reverse", gap: 6 }}>
                      {propsInRoom(state, state.player.room).map((id) => {
                        const url = art.prop?.[id];
                        if (!url) return null;
                        const pr = WORLD.props[id];
                        const done = Boolean(state.flags?.[pr.sets]);
                        return (
                          <button key={id} className="hr-btn"
                            title={done ? `${pr.name} — already worked` : `${pr.verb ?? "use"} the ${pr.name}`}
                            onClick={() => { if (!busy && !state.over) submit(`${pr.verb ?? "use"} ${pr.name}`); }}
                            {...keepFocus}
                            /* A solid backing. Some drawn PNGs carry an alpha
                               channel, and without something behind them the
                               room shows through and the tile reads as
                               half-there. A lever you have pulled is still a
                               lever, so nothing here is dimmed on purpose. */
                            style={{ padding: 0, background: P.ink, cursor: busy ? "default" : "pointer",
                              border: `1px solid ${P.paper}`, lineHeight: 0,
                              boxShadow: "0 1px 3px rgba(0,0,0,.4)" }}>
                            <img src={url} alt={pr.name}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                              style={{ width: 46, height: 46, objectFit: "cover",
                                imageRendering: "pixelated", display: "block" }} />
                          </button>
                        );
                      })}

                      {itemsInRoom(state, state.player.room).map((id) => {
                        const url = art.item?.[id];
                        if (!url) return null;
                        return (
                          <button key={id} className="hr-btn"
                            title={verb ? `${verb} ${itemName(id)}` : `Take the ${itemName(id)}`}
                            onClick={() => tapTarget("item", id)}
                            {...keepFocus}
                            style={{ padding: 0, background: P.ink, cursor: busy ? "default" : "pointer",
                              border: `1px solid ${P.paper}`, lineHeight: 0,
                              boxShadow: "0 1px 3px rgba(0,0,0,.4)" }}>
                            <img src={url} alt={itemName(id)}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                              style={{ width: 46, height: 46, objectFit: "cover",
                                imageRendering: "pixelated", display: "block" }} />
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px" }}>
              <button
                className="hr-btn"
                onClick={() => { if (!busy && !state.over) submit("look"); }}
                {...keepFocus}
                title="Look around"
                style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
                  padding: 0, cursor: busy ? "default" : "pointer",
                  fontFamily: "Newsreader, serif", fontSize: 19, color: P.ink,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {titleCase(room.name)}
              </button>

              <button
                className="hr-btn"
                onClick={() => setOverlay((v) => !v)}
                {...keepFocus}
                title={overlay ? "Hide who and what is here" : "Show who and what is here"}
                aria-pressed={overlay}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  display: "inline-flex", alignItems: "center",
                  color: overlay ? P.ochre : P.inkSoft }}>
                <EyeIcon open={overlay} />
              </button>
            </div>
          </div>
        )}

        <div ref={logRef} className="hr-log"
          style={{
            flex: 1, overflowY: "auto", overflowX: "hidden", padding: "22px 20px 8px",
            minHeight: 0, overscrollBehavior: "contain", overflowWrap: "anywhere",
            display: typing ? "none" : "block",
          }}>
          {log.map((e, i) => <LogLine key={i} entry={e} />)}
          {busy && <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft, margin: "18px 0" }}>…</p>}
        </div>

        {voicePanel && (
          <div className="hr-scroll" style={{ borderTop: `1px solid ${P.inkSoft}33`, padding: "12px 20px", background: P.paperDeep,
            flexShrink: 0, maxHeight: "60%", overflowY: "auto", overscrollBehavior: "contain",
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft }}>
            <div style={{ marginBottom: 12, borderBottom: `1px solid ${P.inkSoft}22`, paddingBottom: 10,
              fontSize: 10.5, color: P.inkSoft, lineHeight: 1.9 }}>
              <div>
                touch {String(coarse)} · narrow {String(narrow)} · pinned {String(pinned)} ·
                {" "}focus {String(inputFocused)} · hiding {String(typing)}
              </div>
              <div>
                width {typeof window !== "undefined" ? window.innerWidth : 0} ·
                {" "}visible {vv ? Math.round(vv.height) : "?"} of
                {" "}{typeof window !== "undefined" ? window.innerHeight : 0}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ flex: 1 }}>reading voice</span>
              <button className="hr-btn" onClick={() => setVoicePanel(false)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 11, color: P.inkSoft }}>
                done
              </button>
            </div>

            <select
              value={voiceURI ?? ""}
              onChange={(e) => {
                setVoiceURI(e.target.value || null);
                narrator.stop();
              }}
              style={{ width: "100%", background: P.paper, color: P.ink, borderRadius: 2,
                border: `1px solid ${P.inkSoft}44`, fontFamily: "inherit", fontSize: 12,
                padding: "6px 8px", marginBottom: 10 }}>
              <option value="">System default</option>
              {narrator.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang}{v.localService ? "" : " (online)"}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34 }}>speed</span>
              <input
                type="range" min="0.6" max="1.4" step="0.05" value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                style={{ flex: 1, accentColor: P.ochre }} />
              <span style={{ width: 30, textAlign: "right" }}>{rate.toFixed(2)}</span>
              <button className="hr-btn"
                onClick={() => narrator.speak("The wind comes up the switchback and dies against the rock.")}
                style={{ background: "transparent", border: `1px solid ${P.inkSoft}55`, color: P.inkSoft,
                  fontFamily: "inherit", fontSize: 11, padding: "4px 9px", cursor: "pointer" }}>
                test
              </button>
            </div>

            <details style={{ marginTop: 12, borderTop: `1px solid ${P.inkSoft}22`, paddingTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: P.inkSoft, letterSpacing: ".04em" }}>
                what gets prepended to your next command
              </summary>
              <pre style={{ margin: "10px 0 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
                lineHeight: 1.65, color: P.inkSoft, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                maxHeight: 260, overflowY: "auto" }}>
                {buildPrompt(state, char?.name ?? "the traveller")}
              </pre>
            </details>
          </div>
        )}

        {/* where you are, and the ways out */}
        <div style={{ borderTop: `1px solid ${P.inkSoft}33`, padding: "9px 20px",
          background: P.paperDeep, flexShrink: 0, display: "flex", alignItems: "baseline", gap: 12,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: P.inkSoft }}>

          {/* Whatever you are dealing with: the action you are part-way
              through, then what you are holding, then what you last acted
              on, and only failing all of that, where you are. The picture
              above already says where you are. */}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: verb || held ? P.ochre : P.ink }}>
            {verb
              ? (verb === "give"
                  ? (held
                      ? `give the ${titleCase(itemName(held))} — now tap who to`
                      : "give — tap what you are carrying")
                  : (verb === "open" || verb === "close")
                    ? `${verb} — tap an exit or something here`
                    : `${verb} — tap something`)
              : held
                ? `Holding: ${titleCase(itemName(held))}`
                : subject
                  ? titleCase(subject)
                  : titleCase(room.name)}
          </span>

          <span style={{ whiteSpace: "nowrap", letterSpacing: ".08em", display: "inline-flex",
            alignItems: "baseline", gap: 6 }}>
            <span>EXITS:</span>
            {Object.keys(room.exits ?? {}).length
              ? Object.keys(room.exits).map((d) => {
                  const ex = room.exits[d];
                  const locked = typeof ex === "object" && ex?.locked;
                  return (
                    <button key={d} className="hr-btn"
                      onClick={() => {
                        if (verb === "open" || verb === "close") {
                          submit(`${verb} ${d}`);
                          setVerb(null);
                        } else submit(d);
                      }}
                      {...keepFocus}
                      title={verb === "open" || verb === "close"
                        ? `${verb} the way ${d}`
                        : locked ? `${d} — locked` : `Go ${d}`}
                      style={{ background: "none", border: "none", padding: "0 1px",
                        cursor: busy ? "default" : "pointer", fontFamily: "inherit",
                        fontSize: 11.5, letterSpacing: ".08em",
                        color: locked ? P.rust : P.ink }}>
                      {DIR_LETTER[d] ?? d[0].toUpperCase()}
                    </button>
                  );
                })
              : <span style={{ color: P.inkSoft }}>NONE</span>}
          </span>
        </div>

        {state.over ? (
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${P.inkSoft}33`, flexShrink: 0, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <p style={{ fontFamily: "Newsreader, serif", fontSize: 16, margin: 0, flex: 1, minWidth: 180 }}>You do not get up.</p>
            <button className="hr-btn" onClick={restart}
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 16px", background: "transparent", border: `1px solid ${P.ink}`, color: P.ink, cursor: "pointer" }}>
              Start again
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px 14px", flexShrink: 0,
            borderTop: `1px solid ${P.inkSoft}33`, paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>

            {/* Typing and tapping are two ways to do the same things, and
                only one of them fits on a phone at a time. */}
            <button className="hr-btn"
              onClick={() => { setActions((v) => !v); setVerb(null); }}
              {...keepFocus}
              title={actions ? "Type a command instead" : "Choose an action instead"}
              aria-pressed={actions}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                display: "inline-flex", alignItems: "center", flexShrink: 0,
                color: actions ? P.ochre : P.inkSoft }}>
              <Glyph name={actions ? "keys" : "grid"} />
            </button>

            {/* The action bar and the input share this row, but the input is
                never unmounted: a removed element cannot hold focus, and a
                phone retracts its keyboard the moment focus is lost. It is
                shrunk out of sight instead, so switching to the buttons and
                back does not close the keyboard under the player. */}
            <div style={{ flex: actions ? "0 0 0px" : "1 1 auto", minWidth: 0,
              display: "flex", alignItems: "center", gap: 10,
              opacity: actions ? 0 : 1,
              width: actions ? 0 : undefined,
              overflow: actions ? "hidden" : "visible",
              pointerEvents: actions ? "none" : "auto" }}>
              <span aria-hidden style={{ fontFamily: "'IBM Plex Mono', monospace", color: P.ochre, fontSize: 13 }}>›</span>
              <input ref={inputRef} className="hr-in" value={input}
                /* readOnly rather than disabled: disabling a focused field
                   blurs it, and on a phone that closes the keyboard every
                   time a turn is sent. submit() already refuses while busy,
                   so nothing gets through anyway. */
                readOnly={busy}
                autoFocus={!onPhone}
                tabIndex={actions ? -1 : 0}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
                style={{
                  flex: 1, minWidth: 0, background: "transparent", border: "none",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 16,              // anything smaller and iOS zooms on focus
                  color: busy ? P.inkSoft : P.ink, padding: "4px 0",
                  touchAction: "manipulation",
                }} />
              <button className="hr-btn" onClick={() => { if (!busy) submit(); }} {...keepFocus}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, background: "transparent",
                  border: `1px solid ${P.inkSoft}55`, color: P.inkSoft, padding: "5px 10px", cursor: busy ? "default" : "pointer" }}>
                send
              </button>
            </div>

            {actions && (
              /* One row that slides sideways rather than wrapping onto a
                 second line: the bar sits directly above the keyboard on a
                 phone, and a second row would push the input off screen. */
              <div className="hr-actions" style={{ flex: 1, minWidth: 0, display: "flex",
                alignItems: "center", gap: 6, flexWrap: "nowrap",
                overflowX: "auto", overflowY: "hidden",
                overscrollBehaviorX: "contain", WebkitOverflowScrolling: "touch",
                scrollSnapType: "x proximity", padding: "1px 0" }}>
                {VERBS.map((v) => {
                  const on = verb === v.key;
                  return (
                    <button key={v.key} className="hr-btn"
                      onClick={() => {
                        if (busy || state.over) return;
                        if (on) { setVerb(null); return; }
                        /* drop and use can only mean the thing in your hand.
                           Asking for a tap you have already made is busywork. */
                        if (held && (v.key === "drop" || v.key === "use")) {
                          submit(`${v.key} ${itemName(held)}`);
                          setSubject(itemName(held));
                          setHeld(null);
                          setVerb(null);
                          return;
                        }
                        setVerb(v.key);
                      }}
                      title={v.key === "open" || v.key === "close"
                        ? `${v.label}, then tap an exit or a thing`
                        : `${v.label}, then tap something`}
                      {...keepFocus}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                        gap: 5, padding: "6px 4px", borderRadius: 2,
                        flex: "0 0 auto", width: 76, scrollSnapAlign: "start",
                        cursor: busy ? "default" : "pointer", background: "transparent",
                        fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                        color: on ? P.ochre : P.inkSoft,
                        border: `1px solid ${on ? P.ochre : P.inkSoft}44` }}>
                      <Glyph name={v.key} />
                      {v.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}


        {/* What you are carrying, and how you are doing. Tapping an item
            picks it up in the sense of holding it ready — tap a character
            above to hand it over, or tap it again to put it down. */}
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${P.inkSoft}22`,
          background: "transparent", padding: "10px 20px",
          display: "flex", alignItems: "center", gap: 12,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft,
        }}>
          <button
            className="hr-btn"
            onClick={() => { if (!busy && !state.over) submit("i"); }}
            {...keepFocus}
            title="Check your inventory"
            style={{ background: "none", border: "none", padding: 0, flexShrink: 0,
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit", fontSize: 11, color: P.inkSoft }}>
            Carrying:
          </button>

          {/* Only the items slide. The label stays put, or it scrolls away
              and the row reads as a list of nothing in particular. */}
          <div className="hr-actions" style={{ flex: 1, minWidth: 0, display: "flex",
            alignItems: "center", gap: 6, flexWrap: "nowrap",
            overflowX: "auto", overflowY: "hidden",
            overscrollBehaviorX: "contain", WebkitOverflowScrolling: "touch" }}>
            {carrying.length === 0 && <span style={{ flexShrink: 0 }}>Nothing</span>}

            {state.player.inventory.map((id, i) => {
              const on = held === id;
              return (
                <button
                  key={id}
                  className="hr-btn"
                  onClick={() => tapTarget("carried", id)}
                  {...keepFocus}
                  title={verb ? `${verb} ${itemName(id)}` : on ? "Put it down" : "Hold it ready to give"}
                  style={{
                    background: "none", border: "none", padding: 0,
                    flexShrink: 0, whiteSpace: "nowrap",
                    cursor: busy ? "default" : "pointer",
                    fontFamily: "inherit", fontSize: 11,
                    color: on ? P.ochre : P.ink,
                    textDecoration: on ? "underline" : "none",
                  }}>
                  {titleCase(itemName(id))}{i < state.player.inventory.length - 1 ? "," : ""}
                </button>
              );
            })}
          </div>

          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
            <span aria-hidden style={{ width: 34, height: 3, background: `${P.inkSoft}33`,
              display: "inline-block", position: "relative" }}>
              <span style={{ position: "absolute", inset: 0, width: `${hpFrac * 100}%`,
                background: hpFrac > 0.4 ? P.moss : P.rust }} />
            </span>
            {state.player.hp}/{state.player.maxHp}
          </span>
        </div>


      </div>
    </div>
  );
}
