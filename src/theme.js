/* Two palettes. T is the catalog: dark, printed, editorial.
   P is the play surface: paper and ink, a different world entirely. */


export const T = {
  // Matches the "Old Ascentery" preset's own values exactly, on purpose —
  // this is what T falls back to if applyDefaultTheme ever fails for any
  // reason (a deleted preset, a missing setting, a DB hiccup), and it
  // used to silently match the "Original" preset instead, which is why
  // deleting that preset from the database never visibly changed
  // anything: this hardcoded copy never read from that row to begin with.
  ground: "#14161f", raised: "#1c1f2b", edge: "#2e3347",
  bone: "#e8e0cd", boneDim: "#9a937f",
  ochre: "#e3a44f", moss: "#8da876", clay: "#c75545",
  serif: "Newsreader, Georgia, serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};
/* Switched from a light "paper and ink" look to a dark one matching the
   rest of the app, per explicit direction — the paper/ink naming stays
   (every component references these exact keys), but the values are now
   inverted: paper/paperDeep are backgrounds again, just dark ones now,
   and ink/inkSoft are text colors again, just light ones now. Matches T's
   own values throughout, for one consistent dark palette across the
   whole app rather than two unrelated ones. */

export const P = {
  paper: "#14161f", paperDeep: "#1c1f2b",
  ink: "#e8e0cd", inkSoft: "#9a937f",
  ochre: "#e3a44f", rust: "#c75545", moss: "#8da876",
};


/* ============================================================
   ENGINE — hand-written once, world-agnostic
   ============================================================ */

/* background/border/color are getters, not plain values, on purpose: a
   plain `background: T.ground` copies whatever T.ground happened to be the
   moment this module first evaluated — before any theme has even loaded —
   and freezes it there forever, since T is mutated in place afterward and
   a copied value has no way to follow that. Every other colour in the app
   reads T.bone etc. fresh inside a component's own render, which is why
   it picks up a theme change and this never did. A getter re-runs on every
   `{...inputStyle}` spread, which is how every call site already uses
   this, so nothing else needs to change to fix it. */
export const inputStyle = {
  width: "100%",
  get background() { return T.ground; },
  get border() { return `1px solid ${T.edge}`; },
  get color() { return T.bone; },
  fontFamily: T.serif, fontSize: 15, padding: "10px 12px", borderRadius: 2,
};

export const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(238px, 1fr))", gap: 20 };
