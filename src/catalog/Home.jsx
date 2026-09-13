import React, { useState, useEffect } from "react";
import { loadHomeFeed } from "../lib/db";
import { T, grid } from "../theme";
import { Empty } from "../ui/primitives";
import { GameCard } from "./Browse";

export function Home({ me, go }) {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadHomeFeed(me.id)
      .then((f) => { if (!cancelled) setFeed(f); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [me.id]);

  if (error) return <Empty title="Could not load your home feed." line={error} />;
  if (!feed) return <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>;

  return (
    <div className="pf-in">
      {feed.recentlyPlayed.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 14 }}>Recently played</div>
          <div style={grid}>
            {feed.recentlyPlayed.map((g) => (
              <GameCard key={g.id} g={g} go={go} onClick={() => go("game", { id: g.id, from: "home" })} />
            ))}
          </div>
        </div>
      )}

      {feed.newest.length > 0 && (
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 14 }}>Newest games</div>
          <div style={grid}>
            {feed.newest.map((g) => (
              <GameCard key={g.id} g={g} go={go} onClick={() => go("game", { id: g.id, from: "home" })} />
            ))}
          </div>
        </div>
      )}

      {!feed.recentlyPlayed.length && !feed.newest.length && (
        <Empty title="Nothing here yet." line="Browse to find something to play." />
      )}
    </div>
  );
}
