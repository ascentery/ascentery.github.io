import React, { useState, useEffect } from "react";
import {
  deleteWorld,
  isFullyIllustrated,
  loadArt,
  loadWorldData,
  saveWorldDetails,
  setPublished,
} from "../lib/db";
import { buildWalkthrough } from "../engine/engine";
import { ArtTab } from "./ArtTab";
import { WorldTab } from "./WorldTab";
import { T, inputStyle } from "../theme";
import { Btn, Chip, Empty, Field } from "../ui/primitives";

export function EditGame({ game, refreshWorlds, me, setMe, go, chars }) {
  const [tab, setTab] = useState("art");
  const [art, setArt] = useState(null);
  const [illustrated, setIllustrated] = useState(false);
  const [pubError, setPubError] = useState(null);

  const checkIllustrated = () => {
    if (!game?.id) return;
    isFullyIllustrated(game.id).then(setIllustrated).catch(() => setIllustrated(false));
  };

  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    loadArt(game.id)
      .then((rs) => { if (!cancelled) setArt(rs); })
      .catch(() => { if (!cancelled) setArt([]); });
    checkIllustrated();
    return () => { cancelled = true; };
  }, [game?.id]);

  if (!game) return <Empty title="Not found." line="This world may have been deleted." />;

  return (
    <div className="pf-in">
      <Btn kind="ghost" onClick={() => go("game", { id: game.id, from: "mine" })}
        style={{ marginBottom: 14 }}>back</Btn>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: T.serif, fontSize: 28, fontWeight: 400, margin: 0 }}>{game.title}</h1>
        <Chip status={game.status} published={game.published} />
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, marginBottom: 18 }}>
        {game.rooms} rooms &middot; {game.mobs} characters &middot; {game.plays.toLocaleString()} plays
      </div>

      {game.status === "ready" && (
        <div style={{ marginBottom: 22 }}>
          <Btn kind="solid" disabled={!chars?.length}
            onClick={() => go("play", { id: game.id, charId: chars?.[0]?.id })}>
            Play
          </Btn>
          {!chars?.length && (
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginLeft: 10 }}>
              Make a character on your profile first.
            </span>
          )}
        </div>
      )}

      {game.status === "failed" && game.failureNote && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7,
          border: "1px solid " + T.clay + "44", padding: 14, borderRadius: 2, marginBottom: 22 }}>
          {game.failureNote}
        </p>
      )}

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + T.edge, marginBottom: 24, flexWrap: "wrap" }}>
        {[["art", "Pictures"], ["world", "World"], ["details", "Details"], ["walkthrough", "Walkthrough"], ["settings", "Settings"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pf-btn"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 14px", fontFamily: T.mono, fontSize: 12,
              color: tab === k ? T.bone : T.boneDim, boxShadow: tab === k ? "inset 0 -2px 0 " + T.ochre : "none" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "art" && (
        art === null
          ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
          : art.length
            ? <ArtTab entries={art} setEntries={setArt} me={me} setMe={setMe} worldId={game.id} onDrawn={checkIllustrated} />
            : <Empty title="Nothing to draw yet." line="Pictures appear once the world has been built." />
      )}

      {tab === "world" && (
        game.status === "ready"
          ? <WorldTab game={game} refreshWorlds={refreshWorlds} me={me} setMe={setMe} go={go} />
          : <Empty title="Nothing to change yet." line="This world has not finished building." />
      )}

      {tab === "details" && <DetailsTab game={game} refreshWorlds={refreshWorlds} />}

      {tab === "walkthrough" && (
        game.status === "ready"
          ? <WalkthroughTab worldId={game.id} />
          : <Empty title="Nothing to walk through yet." line="This world has not finished building." />
      )}

      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <Field label="Published"
            hint={game.published
              ? "Unpublishing hides it from Browse. People mid-playthrough keep their saves."
              : illustrated
                ? "Every picture is drawn. Ready when you are."
                : "A world can be published once every room, character, item and prop has a picture. Check the Pictures tab."}>
            <Btn disabled={game.status !== "ready" || (!game.published && !illustrated)}
              onClick={async () => {
                setPubError(null);
                try {
                  await setPublished(game.id, !game.published);
                  await refreshWorlds();
                } catch (e) {
                  if (e.needsUsername) go("username", { reason: "publish", next: "mine" });
                  else setPubError(e.message);
                }
              }}>
              {game.published ? "Unpublish" : "Publish"}
            </Btn>
          </Field>
          {pubError && (
            <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, marginTop: -8, marginBottom: 18 }}>
              {pubError}
            </p>
          )}
          <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 20, marginTop: 20 }}>
            <Btn kind="danger" onClick={async () => {
              try { await deleteWorld(game.id); await refreshWorlds(); go("mine"); }
              catch (e) { console.error(e); }
            }}>
              Delete this world
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export function DetailsTab({ game, refreshWorlds }) {
  const [title, setTitle] = useState(game.title);
  const [brief, setBrief] = useState(game.brief ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const save = async (patch) => {
    setError(null);
    try {
      await saveWorldDetails(game.id, patch);
      await refreshWorlds();
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <Field label="Title" hint="Shown on the catalog card and used to build the splash screen.">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => save({ title })} style={inputStyle} />
      </Field>

      <Field label="Brief" hint="What you originally described. This is not shown to players, but it is what an amendment reads for context.">
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)}
          onBlur={() => save({ brief })} rows={10}
          style={{ ...inputStyle, lineHeight: 1.6, resize: "vertical" }} />
      </Field>

      <div style={{ fontFamily: T.mono, fontSize: 11, color: saved ? T.moss : T.clay, minHeight: 16 }}>
        {saved ? "saved" : error || "\u00a0"}
      </div>
    </div>
  );
}

function WalkthroughTab({ worldId }) {
  const [world, setWorld] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadWorldData(worldId)
      .then(({ data }) => { if (!cancelled) setWorld(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [worldId]);

  if (error) {
    return <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay }}>{error}</p>;
  }
  if (!world) {
    return <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>;
  }

  const steps = buildWalkthrough(world);
  if (!steps.length) {
    return <Empty title="No quests in this world." line="There is nothing to walk through yet." />;
  }

  const DIR_ARROW = { north: "\u2191", south: "\u2193", east: "\u2192", west: "\u2190", up: "\u2197", down: "\u2199" };

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 20px" }}>
        Computed directly from the world itself, the same way the reachability check is — not
        written by a model, so it cannot describe a step that does not actually work. If the world
        changes, so does this.
      </p>

      {steps.map((s, i) => (
        <div key={i} style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: "12px 16px", marginBottom: 10 }}>
          <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.ochre, marginBottom: 4 }}>
            {s.quest}
          </div>
          <div style={{ fontFamily: T.serif, fontSize: 15.5, marginBottom: 8 }}>
            {i + 1}. {s.goal}
          </div>

          {s.already ? (
            <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim }}>
              {"already true \u2014 "}{s.action}
            </div>
          ) : s.note ? (
            <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay }}>{s.note}</div>
          ) : (
            <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, lineHeight: 1.9 }}>
              <div>{"\ud83d\udccd "}{s.roomName}</div>
              <div>
                {"\ud83d\udeb6 "}{s.path.length
                  ? s.path.map((d) => `${DIR_ARROW[d] ?? d} ${d}`).join("  ")
                  : "already there"}
              </div>
              <div>{"\u26a1 "}{s.action}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
