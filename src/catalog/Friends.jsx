import React, { useState } from "react";
import { GameCard } from "./Browse";
import { T, grid, inputStyle } from "../theme";
import { Avatar, Btn, Empty, H1 } from "../ui/primitives";

export const seedFriends = [{ id: "u2", name: "Nadia", tag: "NAD-9012" }, { id: "u3", name: "Ilse", tag: "ILS-3388" }];

/* ============================================================
   primitives
   ============================================================ */

export function Friends({ friends, setFriends, games, go }) {
  const [tag, setTag] = useState("");
  const [sent, setSent] = useState([]);
  const theirs = games.filter((g) => g.published && friends.some((f) => f.id === g.authorId));
  const add = () => { const t = tag.trim().toUpperCase(); if (!t) return; setSent((s) => [...s, t]); setTag(""); };

  return (
    <div className="pf-in">
      <H1 sub="Add someone by their gamer tag. They'll see your tag when the request arrives.">Friends</H1>
      <div style={{ display: "flex", gap: 8, marginBottom: 28, maxWidth: 420 }}>
        <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="ABC-1234" style={{ ...inputStyle, fontFamily: T.mono, fontSize: 13, letterSpacing: ".06em" }} />
        <Btn onClick={add}>Send request</Btn>
      </div>
      {sent.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontFamily: T.serif, fontSize: 18, fontWeight: 400, margin: "0 0 10px" }}>Waiting on a reply</h2>
          {sent.map((t, i) => <div key={t + i} style={{ fontFamily: T.mono, fontSize: 12, color: T.boneDim, padding: "7px 0", borderBottom: `1px solid ${T.edge}` }}>{t}</div>)}
        </div>
      )}
      <h2 style={{ fontFamily: T.serif, fontSize: 18, fontWeight: 400, margin: "0 0 10px" }}>Your friends</h2>
      <div style={{ marginBottom: 30 }}>
        {friends.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${T.edge}` }}>
            <Avatar name={f.name} tag={f.tag} size={28} />
            <span style={{ fontFamily: T.serif, fontSize: 16, flex: 1 }}>{f.name}</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>{f.tag}</span>
            <Btn kind="ghost" onClick={() => setFriends(friends.filter((x) => x.id !== f.id))}>remove</Btn>
          </div>
        ))}
      </div>
      <h2 style={{ fontFamily: T.serif, fontSize: 18, fontWeight: 400, margin: "0 0 14px" }}>What they've built</h2>
      {theirs.length ? <div style={grid}>{theirs.map((g) => <GameCard key={g.id} g={g} onClick={() => go("game", { id: g.id, from: "friends" })} />)}</div>
        : <Empty title="Nothing yet." line="When a friend publishes a world it turns up here." />}
    </div>
  );
}
