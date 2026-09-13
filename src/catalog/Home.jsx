import React from "react";
import { T, grid } from "../theme";
import { Empty, H1 } from "../ui/primitives";
import { GameCard } from "./Browse";

/** Computed entirely from data already sitting in React state — games and
    saves are both loaded once at app boot, the same way Browse and Mine
    already use them. An earlier version of this page fetched its own
    data fresh on every visit, several sequential queries deep, which is
    exactly why it loaded slower than every other tab: this fixes that by
    not fetching anything at all. */
export function Home({ games, saves, go }) {
  const lastPlayedAt = {};
  for (const key of Object.keys(saves ?? {})) {
    const worldId = key.split(":")[0];
    const t = saves[key]?.updatedAt;
    if (t && (!lastPlayedAt[worldId] || t > lastPlayedAt[worldId])) lastPlayedAt[worldId] = t;
  }

  const recentlyPlayed = games
    .filter((g) => lastPlayedAt[g.id])
    .sort((a, b) => (lastPlayedAt[b.id] > lastPlayedAt[a.id] ? 1 : -1));

  const remaining = Math.max(0, 12 - recentlyPlayed.length);
  const newest = remaining > 0
    ? games
        .filter((g) => g.published && !lastPlayedAt[g.id])
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
        .slice(0, remaining)
    : [];

  return (
    <div className="pf-in">
      <H1 sub="Games you have recently played.">Recently played</H1>

      {recentlyPlayed.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={grid}>
            {recentlyPlayed.map((g) => (
              <GameCard key={g.id} g={g} go={go} onClick={() => go("game", { id: g.id, from: "home" })} />
            ))}
          </div>
        </div>
      )}

      {newest.length > 0 && (
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 14 }}>Newest games</div>
          <div style={grid}>
            {newest.map((g) => (
              <GameCard key={g.id} g={g} go={go} onClick={() => go("game", { id: g.id, from: "home" })} />
            ))}
          </div>
        </div>
      )}

      {!recentlyPlayed.length && !newest.length && (
        <Empty title="Nothing here yet." line="Browse to find something to play." />
      )}
    </div>
  );
}
