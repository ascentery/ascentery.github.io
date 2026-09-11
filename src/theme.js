/* Two palettes. T is the catalog: dark, printed, editorial.
   P is the play surface: paper and ink, a different world entirely. */


export const T = {
  ground: "#1E2119", raised: "#272B21", edge: "#3C4232",
  bone: "#E8E4D6", boneDim: "#9BA08C",
  ochre: "#C99A2E", moss: "#7A9152", clay: "#B4643C",
  serif: "Newsreader, Georgia, serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};
/* the game runs on paper — stepping in is a change of light */

export const P = {
  paper: "#DCDFD7", paperDeep: "#CDD2C8",
  ink: "#232A1F", inkSoft: "#5A6353",
  ochre: "#9A7B18", rust: "#8C4A2F", moss: "#4A5D3F",
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
