import React, { useState, useEffect } from "react";
import {
  deleteWorld,
  isFullyIllustrated,
  loadArt,
  loadWorldData,
  money,
  repairWorld,
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
  const [deleteStage, setDeleteStage] = useState(0);      // 0 idle | 1 confirming | 2 typing the name
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

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
        {[["art", "Pictures"], ["world", "World"], ["details", "Details"], ["walkthrough", "Walkthrough"], ["repair", "Repair"], ["settings", "Settings"]].map(([k, label]) => (
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
            ? <ArtTab entries={art} setEntries={setArt} me={me} setMe={setMe} worldId={game.id} onDrawn={checkIllustrated} title={game.title} />
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

      {tab === "repair" && (
        game.status === "ready"
          ? <RepairTab worldId={game.id} title={game.title} isAdmin={me?.isAdmin} />
          : <Empty title="Nothing to repair yet." line="This world has not finished building." />
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
            {deleteStage === 0 && (
              <Btn kind="danger" onClick={() => setDeleteStage(1)}>
                Delete this world
              </Btn>
            )}

            {deleteStage === 1 && (
              <div>
                <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7, margin: "0 0 12px" }}>
                  This deletes "{game.title}" — every room, character, item, picture, and anyone's
                  save — for good. Are you sure?
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn kind="danger" onClick={() => setDeleteStage(2)}>Yes, delete it</Btn>
                  <Btn kind="ghost" onClick={() => setDeleteStage(0)}>Never mind</Btn>
                </div>
              </div>
            )}

            {deleteStage === 2 && (
              <div>
                <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Type the world's exact title to confirm — "{game.title}".
                </p>
                <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)}
                  placeholder={game.title}
                  style={{ ...inputStyle, marginBottom: 12 }} />
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn kind="danger" disabled={deleting || deleteText !== game.title}
                    onClick={async () => {
                      setDeleting(true);
                      try { await deleteWorld(game.id); await refreshWorlds(); go("mine"); }
                      catch (e) { console.error(e); setDeleting(false); }
                    }}>
                    {deleting ? "deleting…" : "Delete forever"}
                  </Btn>
                  <Btn kind="ghost" onClick={() => { setDeleteStage(0); setDeleteText(""); }}>Cancel</Btn>
                </div>
              </div>
            )}
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

function RepairTab({ worldId, title, isAdmin }) {
  const [world, setWorld] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [result, setResult] = useState(null);       // { status, reply, cost_cents }
  const [copied, setCopied] = useState(false);
  const [checkWalkthrough, setCheckWalkthrough] = useState(false);

  const refresh = () => {
    loadWorldData(worldId)
      .then(({ data }) => setWorld(data))
      .catch((e) => setLoadError(e.message));
  };
  useEffect(() => { refresh(); }, [worldId]);

  const send = async () => {
    if (!query.trim() || busy) return;
    setBusy(true); setError(null); setNeedsFunds(false); setCheckWalkthrough(false);
    try {
      const res = await repairWorld(worldId, query.trim());
      setResult(res);
      setWorld(res.world);
      setQuery("");
    } catch (e) {
      setError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
    } finally {
      setBusy(false);
    }
  };

  const copyJson = async () => {
    const text = JSON.stringify(world, null, 2);
    // The modern clipboard API is not universally available — older
    // Safari and some embedded webviews either lack it or reject it
    // depending on permissions, and fail silently rather than throwing
    // something visible. A classic textarea + execCommand fallback covers
    // far more of those cases, so this only reports failure if both fail.
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      return;
    } catch { /* fall through to the classic approach below */ }

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("execCommand copy returned false");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy — your browser may be blocking clipboard access. Select the text in the box above and copy it manually.");
    }
  };

  const walkthrough = checkWalkthrough && world ? buildWalkthrough(world) : null;

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 20px" }}>
        Describe what is going wrong, in plain words — "once inside the room there is no exit and
        the door is locked." The model reads the whole world and tries a fix, but nothing is ever
        applied unless it passes the same check every generated world already has to pass, so a
        proposed fix that breaks something else is refused rather than saved. Costs {money(10)}
        whether or not anything actually changes, since the attempt happens either way. Every
        change here is undoable from the World tab, the same as any other amendment.
      </p>

      {isAdmin && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
              World JSON (admin only)
            </div>
            <Btn kind="ghost" onClick={copyJson} disabled={!world}>
              {copied ? "copied" : "copy to clipboard"}
            </Btn>
          </div>
          {loadError ? (
            <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay }}>{loadError}</p>
          ) : (
            <textarea readOnly value={world ? JSON.stringify(world, null, 2) : "loading"} rows={14}
              style={{ ...inputStyle, fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, resize: "vertical" }} />
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 18, marginBottom: 18 }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 8 }}>
          Response
        </div>
        {result ? (
          <div style={{ border: "1px solid " + (result.status === "modified" ? T.moss : T.edge) + "88",
            borderRadius: 2, padding: "12px 14px" }}>
            <div style={{ fontFamily: T.mono, fontSize: 10.5, color: result.status === "modified" ? T.moss : T.boneDim,
              marginBottom: 8 }}>
              {result.status === "modified" ? "repaired \u2014 the world was changed" : "unchanged"}
            </div>
            <p style={{ fontFamily: T.serif, fontSize: 15, lineHeight: 1.6, margin: 0 }}>{result.reply}</p>
          </div>
        ) : (
          <p style={{ fontFamily: T.mono, fontSize: 12, color: T.boneDim }}>Nothing asked yet.</p>
        )}
      </div>

      {result && (
        <div style={{ marginBottom: 18 }}>
          {!checkWalkthrough ? (
            <Btn kind="ghost" onClick={() => setCheckWalkthrough(true)}>
              Check the walkthrough
            </Btn>
          ) : (
            <>
              <p style={{ fontFamily: T.mono, fontSize: 10.5, color: T.boneDim, lineHeight: 1.7, margin: "0 0 12px" }}>
                Computed directly from the world as it stands right now \u2014 not a second AI call,
                which could describe a step that does not actually work. This is the same
                deterministic check the Walkthrough tab uses, so if it completes cleanly here, the
                problem is genuinely solved.
              </p>
              {walkthrough && !walkthrough.length && (
                <p style={{ fontFamily: T.mono, fontSize: 12, color: T.boneDim }}>No quests in this world.</p>
              )}
              {walkthrough && walkthrough.map((s, i) => (
                <div key={i} style={{ fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.9, color: T.boneDim,
                  borderBottom: "1px solid " + T.edge + "55", padding: "6px 0" }}>
                  <span style={{ color: s.note ? T.clay : T.boneDim }}>{i + 1}. {s.goal}</span>
                  {s.note && <span style={{ color: T.clay }}> \u2014 {s.note}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <Field label="What's going wrong">
        <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={4}
          placeholder="Once inside the room there is no exit and the door is locked."
          style={{ ...inputStyle, lineHeight: 1.6, resize: "vertical" }} />
      </Field>

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "-8px 0 14px" }}>
          {error}
          {needsFunds && <Btn kind="ghost" style={{ marginLeft: 10 }}>Add funds</Btn>}
        </p>
      )}

      <Btn kind="solid" disabled={busy || !query.trim()} onClick={send}>
        {busy ? "looking\u2026" : `Ask \u00b7 ${money(10)}`}
      </Btn>
    </div>
  );
}
