import React, { useState, useEffect } from "react";
import {
  loadCompletedGames,
  loadCreatorGames,
  loadCreatorProfile,
} from "../lib/db";
import { T } from "../theme";
import { Avatar, Empty, H1 } from "../ui/primitives";

export function CreatorProfile({ username, go }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null);           // set once the profile loads
  const [games, setGames] = useState(null);
  const [completed, setCompleted] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadCreatorProfile(username)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        // A non-creator has no "their games" tab at all, so Completed is
        // the only sensible thing to open on.
        setTab(p.isCreator ? "games" : "completed");
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    if (!profile) return;
    if (profile.isCreator && games === null) {
      loadCreatorGames(profile.id).then(setGames).catch(() => setGames([]));
    }
    if (completed === null) {
      loadCompletedGames(profile.id).then(setCompleted).catch(() => setCompleted([]));
    }
  }, [profile, games, completed]);

  if (error) return <Empty title="That creator could not be found." line={error} />;
  if (!profile) return <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>;

  const tabs = [
    ...(profile.isCreator ? [["games", "Games"]] : []),
    ["completed", "Completed"],
    ["badges", "Badges"],
  ];

  return (
    <div className="pf-in" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <Avatar name={profile.name} tag={profile.username} size={62} src={profile.avatarUrl} />
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 22 }}>{profile.name}</div>
          <div style={{ fontFamily: T.mono, fontSize: 13, color: T.ochre }}>@{profile.username}</div>
        </div>
      </div>
      {/* Gamer tag is deliberately never shown here, or fetched by
          loadCreatorProfile at all — it stays private no matter who is
          looking, including on their own public page. */}

      {profile.bio && (
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "16px 0 0" }}>
          {profile.bio}
        </p>
      )}

      <div style={{ display: "flex", gap: 4, margin: "26px 0 20px" }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pf-btn"
            style={{ background: "transparent", cursor: "pointer", padding: "7px 12px", borderRadius: 2,
              fontFamily: T.mono, fontSize: 12, color: tab === k ? T.bone : T.boneDim,
              border: "1px solid " + (tab === k ? T.ochre : T.edge) }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "games" && (
        games === null ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        : !games.length ? <Empty title="Nothing published yet." />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {games.map((g) => (
              <button key={g.id} onClick={() => go("game", { id: g.id })} className="pf-btn"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ aspectRatio: "16/9", background: T.raised, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                  {g.coverUrl && <img src={g.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontFamily: T.serif, fontSize: 15, color: T.bone }}>{g.title}</div>
              </button>
            ))}
          </div>
        )
      )}

      {tab === "completed" && (
        completed === null ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        : !completed.length ? <Empty title="No completed games yet." />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {completed.map((g) => (
              <button key={g.worldId} onClick={() => go("game", { id: g.worldId })} className="pf-btn"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ aspectRatio: "16/9", background: T.raised, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                  {g.coverUrl && <img src={g.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontFamily: T.serif, fontSize: 15, color: T.bone }}>{g.title}</div>
              </button>
            ))}
          </div>
        )
      )}

      {tab === "badges" && (
        completed === null ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        : !completed.filter((g) => g.badgeUrl).length ? <Empty title="No badges yet." line="Finish a game to earn one." />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 16 }}>
            {completed.filter((g) => g.badgeUrl).map((g) => (
              <div key={g.worldId} style={{ textAlign: "center" }}>
                <div style={{ aspectRatio: "1/1", background: T.raised, borderRadius: "50%", overflow: "hidden", marginBottom: 6 }}>
                  <img src={g.badgeUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>{g.title}</div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
