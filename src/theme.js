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

export const inputStyle = { width: "100%", background: T.ground, border: `1px solid ${T.edge}`, color: T.bone,
  fontFamily: T.serif, fontSize: 15, padding: "10px 12px", borderRadius: 2 };

export const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(238px, 1fr))", gap: 20 };
