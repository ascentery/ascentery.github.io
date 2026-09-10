import React, { useState } from "react";
import {
  SORTS,
  sortWorlds,
} from "../lib/db";
import { useNarrow } from "../hooks";
import { T, grid, inputStyle } from "../theme";
import { Chip, Empty, Splash } from "../ui/primitives";

export function Browse({ games, go }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("played");
  const narrow = useNarrow();

  const ranked = sortWorlds(games, sort);
  const shown = ranked.filter((g) => (g.title + g.author + g.blurb).toLowerCase().includes(q.toLowerCase()));

  // The showcase is the most played world overall, whatever the list below
  // is sorted by. On a phone it costs a whole screen before anyone sees a
  // second title, so it is left out entirely.
  const featured = narrow ? null : sortWorlds(games, "played")[0];
  const rest = featured ? shown.filter((g) => g.id !== featured.id) : shown;

  return (
    <div className="pf-in">
      {featured && (
        <div className="pf-card" onClick={() => go("game", { id: featured.id, from: "browse" })}
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)",
            gap: 24, marginBottom: 34, alignItems: "center" }}>
          <Splash seed={featured.id} src={featured.coverUrl} ratio={0.5625} />
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ochre, marginBottom: 8 }}>most played</div>
            <div className="pf-title" style={{ fontFamily: T.serif, fontSize: 30, lineHeight: 1.15, marginBottom: 8 }}>
              {featured.title}
            </div>
            <p style={{ fontFamily: T.serif, fontSize: 16, lineHeight: 1.55, color: T.boneDim, margin: "0 0 12px" }}>
              {featured.blurb}
            </p>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
              {featured.author} &middot; {featured.rooms} rooms &middot; {featured.plays.toLocaleString()} plays
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort worlds"
          style={{ background: T.ground, color: T.bone, border: `1px solid ${T.edge}`, borderRadius: 2,
            fontFamily: T.serif, fontSize: 17, padding: "6px 8px", cursor: "pointer" }}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>

        <span style={{ flex: 1 }} />

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search worlds"
          style={{ ...inputStyle, width: narrow ? "100%" : 200, fontFamily: T.mono, fontSize: 12, padding: "7px 10px" }} />
      </div>

      <div style={grid}>
        {rest.map((g) => (
          <GameCard key={g.id} g={g} onClick={() => go("game", { id: g.id, from: "browse" })}
            meta={sort === "week" && g.weekPlays ? `${g.weekPlays.toLocaleString()} plays this week` : null} />
        ))}
      </div>
      {!shown.length && <Empty title="Nothing matches that." line="Try a shorter word, or clear the search." />}
    </div>
  );
}

export function GameCard({ g, onClick, showStatus, meta }) {
  return (
    <div className="pf-card pf-in" onClick={onClick}>
      <Splash seed={g.id} pending={g.status === "generating"} src={g.coverUrl} />
      <div style={{ padding: "10px 2px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div className="pf-title" style={{ fontFamily: T.serif, fontSize: 18, flex: 1, lineHeight: 1.25 }}>{g.title}</div>
          {showStatus && <Chip status={g.status} published={g.published} />}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 5 }}>
          {g.author} · {meta ?? `${g.plays.toLocaleString()} plays`}
        </div>
      </div>
    </div>
  );
}
