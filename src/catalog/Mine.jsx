import React from "react";
import { GameCard } from "./Browse";
import { grid } from "../theme";
import { Btn, Empty, H1 } from "../ui/primitives";

export function Mine({ games, go }) {
  return (
    <div className="pf-in">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}><H1 sub="Drafts stay private until you publish them.">Your games</H1></div>
        <Btn kind="solid" onClick={() => go("create")}>Create a game</Btn>
      </div>
      {games.length ? (
        <div style={grid}>{games.map((g) => <GameCard key={g.id} g={g} showStatus onClick={() => go("game", { id: g.id, from: "mine" })} />)}</div>
      ) : (
        <Empty title="You haven't built anything yet."
          line="A world takes one paragraph to describe and about a minute to generate."
          action={<Btn kind="solid" onClick={() => go("create")}>Create a game</Btn>} />
      )}
    </div>
  );
}
