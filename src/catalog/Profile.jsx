import React, { useState } from "react";
import {
  createCharacter,
  deleteCharacter,
  money,
  saveDisplayName,
  signOut,
  updateCharacterBio,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Avatar, Btn, Field, H1, hash } from "../ui/primitives";

export function Profile({ me, setMe, chars, setChars, go }) {
  const [copied, setCopied] = useState(false);
  const [newName, setNewName] = useState("");
  const addChar = async () => {
    const n = newName.trim(); if (!n) return;
    setNewName("");
    try {
      const row = await createCharacter(me.id, n);
      setChars((cs) => [...cs, row]);
    } catch (e) { console.error("could not create character", e); }
  };
  return (
    <div className="pf-in" style={{ maxWidth: 620 }}>
      <H1>Profile</H1>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 26 }}>
        <Avatar name={me.name} tag={me.tag} size={62} />
        <div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 3 }}>your gamer tag</div>
          <button className="pf-btn"
            onClick={() => { navigator.clipboard?.writeText(me.tag); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: T.mono, fontSize: 19, letterSpacing: ".1em", color: T.ochre }}>
            {me.tag}
          </button>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, height: 14, marginTop: 3 }}>{copied ? "copied" : "tap to copy"}</div>
        </div>
      </div>

      <Field label="Username" hint="How your published worlds are credited. It cannot be changed once claimed.">
        {me.username ? (
          <div style={{ fontFamily: T.mono, fontSize: 16, color: T.ochre, letterSpacing: ".02em" }}>
            @{me.username}
          </div>
        ) : (
          <Btn onClick={() => go("username", { next: "profile" })}>Choose a username</Btn>
        )}
      </Field>

      <Field label="Display name" hint="What friends see. Your tag never changes.">
        <input style={inputStyle} value={me.name}
          onChange={(e) => setMe({ ...me, name: e.target.value })}
          onBlur={(e) => saveDisplayName(me.id, e.target.value.trim() || "New player")
            .catch((err) => console.error("could not save name", err))} />
      </Field>

      <div style={{ borderTop: `1px solid ${T.edge}`, paddingTop: 24, marginTop: 10 }}>
        <h2 style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, margin: "0 0 4px" }}>Characters</h2>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.55, margin: "0 0 18px" }}>
          A character is a name and a face you bring into a world. Each world keeps separate progress for them,
          because no two worlds count health or items the same way.
        </p>
        {chars.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${T.edge}` }}>
            <div style={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              background: `linear-gradient(140deg, hsl(${hash(c.name) % 360} 26% 26%), hsl(${(hash(c.name) + 80) % 360} 30% 42%))` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.serif, fontSize: 16 }}>{c.name}</div>
              <input value={c.bio ?? ""} placeholder="one line about them"
                onChange={(e) => setChars(chars.map((x) => x.id === c.id ? { ...x, bio: e.target.value } : x))}
                onBlur={(e) => updateCharacterBio(c.id, e.target.value)
                  .catch((err) => console.error("could not save bio", err))}
                style={{ ...inputStyle, border: "none", padding: 0, fontSize: 13.5, color: T.boneDim, background: "none" }} />
            </div>
            <Btn kind="ghost" onClick={async () => {
              setChars(chars.filter((x) => x.id !== c.id));
              try { await deleteCharacter(c.id); } catch (e) { console.error("could not delete", e); }
            }}>remove</Btn>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addChar()}
            placeholder="New character's name" style={inputStyle} />
          <Btn onClick={addChar}>Add</Btn>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${T.edge}`, paddingTop: 22, marginTop: 28,
        display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn onClick={() => go("creator")}>
          {me.isCreator ? `Add funds \u00b7 ${money(me.balance)} left` : "Become a creator"}
        </Btn>
        {me.isAdmin && <Btn onClick={() => go("admin")}>Admin</Btn>}
        <Btn onClick={() => signOut()}>Sign out</Btn>
      </div>
    </div>
  );
}

/* ---------- create ---------- */
