import React from "react";
import { P } from "../theme";

export function LogLine({ entry }) {
  const base = { fontFamily: "Newsreader, serif", margin: "0 0 18px" };

  if (entry.kind === "presence")
    return (
      <div className="hr-fade" style={{ display: "flex", gap: 14, alignItems: "flex-start", margin: "0 0 20px" }}>
        {entry.url && (
          <img
            src={entry.url}
            alt={entry.name || ""}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            style={{
              // Square and the same size as an item tile, so a room's
              // characters and its objects read as one row of things rather
              // than two unrelated treatments. Same border and shadow as the
              // tiles over the room picture, so they are recognisably the
              // same objects in two places.
              width: 74, height: 74, flexShrink: 0, objectFit: "cover",
              objectPosition: "50% 25%",   // portraits are tall; keep the head
              imageRendering: "pixelated", background: P.ink,
              border: `1px solid ${P.paper}`, boxShadow: "0 1px 3px rgba(0,0,0,.35)",
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "Newsreader, serif", fontSize: 16, marginBottom: 3 }}>{entry.name}</div>
          <p style={{ fontFamily: "Newsreader, serif", fontSize: 16, lineHeight: 1.55, margin: 0, color: P.inkSoft }}>
            {entry.text}
          </p>
        </div>
      </div>
    );

  if (entry.kind === "items")
    return (
      <div className="hr-fade" style={{ margin: "0 0 20px" }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft, marginBottom: 8 }}>
          {entry.label ?? "You see"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {entry.items.map((it) => (
            <div key={it.key} style={{ width: 74 }}>
              {it.url ? (
                <img
                  src={it.url}
                  alt={it.name}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{
                    width: 74, height: 74, objectFit: "cover", display: "block",
                    imageRendering: "pixelated", background: P.ink,
                    border: `1px solid ${P.paper}`, boxShadow: "0 1px 3px rgba(0,0,0,.35)",
                  }}
                />
              ) : (
                <div style={{ width: 74, height: 74, border: `1px dashed ${P.inkSoft}44` }} />
              )}
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5,
                lineHeight: 1.35, color: P.inkSoft, marginTop: 5 }}>
                {it.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    );

  if (entry.kind === "art")
    return (
      <div className="hr-fade" style={{ margin: "26px 0 12px" }}>
        <img
          src={entry.url}
          alt={entry.text || ""}
          loading="lazy"
          onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }}
          style={{
            display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "cover",
            imageRendering: "pixelated",
            border: `1px solid ${P.inkSoft}33`,
          }}
        />
      </div>
    );
  if (entry.kind === "room")
    return <p className="hr-fade" style={{ ...base, fontSize: 21, margin: "26px 0 10px", paddingBottom: 6, borderBottom: `1px solid ${P.inkSoft}2e` }}>{entry.text}</p>;

  if (entry.kind === "room-under-art")
    return <p className="hr-fade" style={{ ...base, fontSize: 21, margin: "0 0 10px", paddingBottom: 6, borderBottom: `1px solid ${P.inkSoft}2e` }}>{entry.text}</p>;
  if (entry.kind === "you")
    return <p className="hr-fade" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: P.inkSoft, margin: "22px 0 14px" }}>
      <span style={{ color: P.ochre }}>›</span> {entry.text}</p>;
  if (entry.kind === "ambient")
    return <p className="hr-fade" style={{ ...base, fontSize: 15, fontStyle: "italic", color: P.inkSoft }}>{entry.text}</p>;
  if (entry.kind === "narration")
    return <div className="hr-fade">{entry.text.split(/\n\n+/).map((p, i) =>
      <p key={i} style={{ ...base, fontSize: 17, lineHeight: 1.62 }}>{p}</p>)}</div>;

  const tone = entry.kind === "hit" ? P.rust : (entry.kind === "gain" || entry.kind === "quest") ? P.moss : P.inkSoft;
  return <p className="hr-fade" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, lineHeight: 1.6,
    color: tone, margin: "0 0 14px", paddingLeft: 11, borderLeft: `2px solid ${tone}55` }}>{entry.text}</p>;
}
