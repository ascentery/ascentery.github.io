/* The handful of elements every page is built from. */

import React, { useState, useEffect } from "react";
import { T } from "../theme";

export function hash(str) {
  // Guarded because callers routinely pass a person's username as the
  // seed for their avatar's colour, and a username is often genuinely
  // absent — not every account has claimed one. This was the actual
  // cause of the follower-list crash: hash(null).length with no fallback.
  const s = str || "x";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}

export function Splash({ seed, ratio = 0.5625, pending, src, style }) {
  const h = hash(seed || "x"), a = h % 360, b = (h >> 3) % 60;
  const [loaded, setLoaded] = useState(false);
  // Reset if the image itself changes (a redraw swapping to a new url) —
  // otherwise a previously-loaded flag would wrongly skip the fade-in for
  // the new picture.
  useEffect(() => { setLoaded(false); }, [src]);

  return (
    <div style={{ position: "relative", width: "100%", paddingTop: `${ratio * 100}%`, overflow: "hidden",
      background: `linear-gradient(${h % 180}deg, hsl(${a} 34% 22%), hsl(${(a + 40 + b) % 360} 30% 34%))`, ...style }}>
      {src && (
        <img src={src} alt="" loading="lazy"
          onLoad={() => setLoaded(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", imageRendering: "pixelated",
            // Invisible until the browser actually has pixels to show —
            // some browsers paint an image element's own blank state the
            // moment it starts loading, regardless of any CSS background
            // set on it, which is what caused the white flash this
            // replaces. The gradient behind it (never covered while
            // opacity is 0) is what's visible during that gap instead.
            opacity: loaded ? 1 : 0, transition: "opacity 120ms ease-out" }} />
      )}
      {!pending && !src && (
        <svg viewBox="0 0 100 56" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <circle cx={h % 100} cy={(h >> 5) % 56} r={18 + (h % 14)} fill={`hsl(${(a + 90) % 360} 44% 52%)`} opacity=".34" />
          <circle cx={(h >> 7) % 100} cy={(h >> 9) % 56} r={10 + (h % 20)} fill={`hsl(${(a + 200) % 360} 40% 60%)`} opacity=".22" />
          <path d={`M0 ${34 + (h % 12)} Q 25 ${18 + (h % 20)} 50 ${30 + (h % 16)} T 100 ${26 + (h % 14)} V56 H0Z`} fill="rgba(0,0,0,.36)" />
        </svg>
      )}
      {pending && !src && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
        fontFamily: T.mono, fontSize: 10, letterSpacing: ".08em", color: T.boneDim }}>drawing</div>}
    </div>
  );
}

/* ============================================================
   mock data
   ============================================================ */

export const Btn = ({ children, kind = "quiet", full, ...p }) => {
  const base = { fontFamily: T.mono, fontSize: 12, padding: "9px 16px", borderRadius: 2,
    cursor: p.disabled ? "not-allowed" : "pointer", opacity: p.disabled ? 0.45 : 1, width: full ? "100%" : undefined };
  const kinds = {
    solid: { background: T.ochre, color: "#221D0C", border: `1px solid ${T.ochre}` },
    quiet: { background: "transparent", color: T.bone, border: `1px solid ${T.edge}` },
    ghost: { background: "transparent", color: T.boneDim, border: "1px solid transparent", padding: "6px 8px" },
    danger: { background: "transparent", color: T.clay, border: `1px solid ${T.clay}66` },
  };
  return <button className="pf-btn" {...p} style={{ ...base, ...kinds[kind], ...(p.style || {}) }}>{children}</button>;
};

export const Field = ({ label, hint, children }) => (
  <label style={{ display: "block", marginBottom: 20 }}>
    <div style={{ fontFamily: T.serif, fontSize: 15, marginBottom: 2 }}>{label}</div>
    {hint && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>}
    {children}
  </label>
);

/* "ready" only ever meant "finished building, playable" — it said nothing
   about whether anyone else can see it. Conflating the two showed a
   "published" tag on every freshly-built draft. published is now read
   separately, and only a ready world that is actually published gets that
   label; a ready-but-unpublished one reads as a draft.

   A genuine status: "draft" row (the Create wizard autosaving mid-way,
   before anything has been built at all) is a third, different thing
   again — it used to collapse onto the same "draft" label as a
   ready-but-unpublished game, which made an unfinished wizard look like
   a complete, playable game nobody had published yet. "unfinished" is
   now its own label so the two don't read as the same state. */
export const Chip = ({ status, published }) => {
  const key = status === "draft" ? "unfinished" : status === "ready" ? (published ? "published" : "draft") : status;
  const map = { published: [T.moss, "published"], draft: [T.clay, "draft"], unfinished: [T.boneDim, "unfinished"], generating: [T.ochre, "building"], failed: [T.clay, "failed"] };
  const [c, label] = map[key] ?? [T.boneDim, status];
  return <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: ".04em", color: c,
    border: `1px solid ${c}55`, padding: "2px 7px", borderRadius: 2, whiteSpace: "nowrap" }}>{label}</span>;
};

export const H1 = ({ children, sub }) => (
  <div style={{ marginBottom: 22 }}>
    <h1 style={{ fontFamily: T.serif, fontSize: 27, fontWeight: 400, margin: 0, lineHeight: 1.2 }}>{children}</h1>
    {sub && <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, margin: "5px 0 0", lineHeight: 1.5, maxWidth: 480 }}>{sub}</p>}
  </div>
);

export const Empty = ({ title, line, action }) => (
  <div style={{ border: `1px dashed ${T.edge}`, padding: "44px 24px", textAlign: "center", borderRadius: 2 }}>
    <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 6 }}>{title}</div>
    <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, margin: "0 0 16px", lineHeight: 1.5 }}>{line}</p>
    {action}
  </div>
);

/* One breakpoint, used for the handful of places where a phone needs a
   different layout rather than a narrower one. */

export const Avatar = ({ name, tag, size = 32, src, bgColor, bgColor2, letterColor }) =>
  src ? (
    <img src={src} alt="" style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
      fontFamily: T.serif, fontSize: size * 0.44, color: letterColor || undefined,
      // Always a two-tone gradient, same as the original hash-derived
      // look — a chosen colour replaces one of the two hues fed into it
      // rather than flattening the style into a single flat fill.
      background: `linear-gradient(140deg, ${bgColor || `hsl(${hash(tag) % 360} 30% 30%)`}, ${bgColor2 || bgColor || `hsl(${(hash(tag) + 60) % 360} 34% 44%)`})` }}>
      {(name || "?")[0]}
    </div>
  );

/* ============================================================
   app
   ============================================================ */
