/* Small pieces the play surface needs and nothing else does. */


export const titleCase = (str) =>
  String(str ?? "").replace(/\b([a-z])/g, (m) => m.toUpperCase());

export const DIR_LETTER = { north: "N", south: "S", east: "E", west: "W", up: "U", down: "D" };

/* Small line icons, drawn rather than imported: the set is tiny, they need to
   inherit colour from their button, and a dependency for six glyphs is not
   worth the weight. */

export const VERBS = [
  { key: "look",  label: "look" },
  { key: "talk",  label: "talk" },
  { key: "take",  label: "take" },
  { key: "drop",  label: "drop" },
  { key: "give",  label: "give" },
  { key: "use",   label: "use" },
  { key: "open",  label: "open" },
  { key: "close", label: "close" },
];

/* Pressing a button while the input has focus used to take two taps: the
   first blurred the field, which un-hid the transcript and moved the button
   out from under the finger, and only the second landed. Preventing the
   default on pointer-down keeps focus where it is, so the first tap works.

   Both handlers are needed. Touch devices do not fire mousedown until after
   the touch has already moved focus, so on a phone it is the touchstart
   that has to be stopped. */

export const keepFocus = {
  onMouseDown: (e) => e.preventDefault(),
  onTouchStart: (e) => e.preventDefault(),
};

/* The few things that must be allowed to take focus for themselves. Anything
   else tapped inside the play surface leaves focus where it was, so the
   keyboard does not drop when a player touches the room picture or the gap
   between two buttons. */

export function wantsFocus(el) {
  return Boolean(el?.closest?.("input, textarea, select, option, [contenteditable=true]"));
}

export const SPOKEN = new Set(["narration", "room", "room-under-art", "presence", "ambient"]);

export function readable(entries) {
  return entries
    .filter((e) => SPOKEN.has(e.kind) && e.text)
    .map((e) => (e.kind === "presence" && e.name ? `${e.name}. ${e.text}` : e.text))
    .join(" ");
}
