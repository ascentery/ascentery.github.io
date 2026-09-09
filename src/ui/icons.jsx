import React from "react";
import { grid } from "../theme";

export function Glyph({ name }) {
  const p = { stroke: "currentColor", strokeWidth: 1.15, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
  const paths = {
    look: <><path d="M1.5 8s2.6-4.5 6.5-4.5S14.5 8 14.5 8s-2.6 4.5-6.5 4.5S1.5 8 1.5 8z" {...p} /><circle cx="8" cy="8" r="1.9" {...p} /></>,
    talk: <path d="M13.5 9.5a1.5 1.5 0 01-1.5 1.5H6l-3 2.5V4a1.5 1.5 0 011.5-1.5h7.5A1.5 1.5 0 0113.5 4z" {...p} />,
    take: <><path d="M8 10.5V2.5" {...p} /><path d="M4.5 6L8 2.5 11.5 6" {...p} /><path d="M2.5 13.5h11" {...p} /></>,
    drop: <><path d="M8 2.5v8" {...p} /><path d="M4.5 7L8 10.5 11.5 7" {...p} /><path d="M2.5 13.5h11" {...p} /></>,
    give: <><rect x="2.5" y="6.5" width="11" height="7" rx="1" {...p} /><path d="M8 6.5v7" {...p} /><path d="M2.5 9.5h11" {...p} /><path d="M8 6.5S6 2.5 4.5 3.9 6.5 6.5 8 6.5zM8 6.5s2-4 3.5-2.6S9.5 6.5 8 6.5z" {...p} /></>,
    use: <path d="M10.5 2.5a3.5 3.5 0 00-3.1 5.1l-4.6 4.6 1.4 1.4 4.6-4.6a3.5 3.5 0 104.2-4.5l-1.9 1.9-1.5-1.5 1.9-1.9a3.5 3.5 0 00-1-.5z" {...p} />,
    open: <><path d="M3.5 13.5V3.5l6-1.5v13z" {...p} /><path d="M9.5 4.5h3v9h-3" {...p} /><circle cx="7.6" cy="8" r=".6" fill="currentColor" stroke="none" /></>,
    close: <><rect x="4" y="2.5" width="8" height="11" rx="1" {...p} /><circle cx="9.6" cy="8" r=".6" fill="currentColor" stroke="none" /></>,
    keys: <><rect x="1.5" y="4.5" width="13" height="8" rx="1.2" {...p} /><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M4.5 10h7" {...p} /></>,
    grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" {...p} /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" {...p} /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" {...p} /><rect x="9" y="9" width="4.5" height="4.5" rx="1" {...p} /></>,
  };
  return <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>{paths[name] ?? null}</svg>;
}

/* look and talk are questions, so they go to the narrator. take and drop are
   settled by the engine. give and use may be either, depending on what the
   world says. */

export function EyeIcon({ open }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      {!open && <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

export function PinIcon({ pinned }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden
      style={{ transform: pinned ? "none" : "rotate(-90deg)", transition: "transform .18s" }}>
      <path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6z" fill="currentColor" />
      <path d="M12 14v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/* The play surface is pinned to the *visual* viewport rather than to 100vh.
   When a phone keyboard opens, the layout viewport stays full height while
   the visible area shrinks, so a 100vh element hangs below the fold and the
   page pans around to follow the caret — which reads as the whole interface
   sliding and zooming. Measuring visualViewport instead keeps the input
   sitting directly above the keyboard. */
/* Width is a poor test for "is there an on-screen keyboard": a narrow
   desktop window is not a phone, and a tablet in landscape is. Pointer
   coarseness asks the question directly. */
