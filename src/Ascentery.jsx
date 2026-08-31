import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { supabase, narrate } from "./lib/supabase";
import {
  loadMe, saveDisplayName,
  loadCharacters, createCharacter, updateCharacterBio, deleteCharacter,
  loadSaves, writeSave,
  signUp, signIn, signOut,
} from "./lib/db";

/* ============================================================
   ASCENTERY — platform shell + playable engine, joined.
   Sign in with anything. Hollowreach is fully playable.
   Progress is kept per character, per world, in memory.
   ============================================================ */

/* ---------- tokens ---------- */
const T = {
  ground: "#1E2119", raised: "#272B21", edge: "#3C4232",
  bone: "#E8E4D6", boneDim: "#9BA08C",
  ochre: "#C99A2E", moss: "#7A9152", clay: "#B4643C",
  serif: "Newsreader, Georgia, serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};
/* the game runs on paper — stepping in is a change of light */
const P = {
  paper: "#DCDFD7", paperDeep: "#CDD2C8",
  ink: "#232A1F", inkSoft: "#5A6353",
  ochre: "#9A7B18", rust: "#8C4A2F", moss: "#4A5D3F",
};

/* ============================================================
   WORLD — pure data
   ============================================================ */
const WORLD = {
  title: "Hollowreach",
  premise:
    "A dwarven holding cut into a cold mountainside above the treeline. Terraced gardens, a glasshouse " +
    "warmed by flue-pipes from the old smelt, and a flooded cistern below the gate. The holding is nearly " +
    "empty; Borin Ashgate is the last of the household still there.",
  items: {
    apple: { name: "a wild apple", short: "wild apple" },
    lemon: { name: "a waxy lemon", short: "waxy lemon" },
    knife: { name: "a pruning knife", short: "pruning knife", damage: [4, 7] },
    minetag: { name: "a corroded mine tag", short: "mine tag" },
  },
  startRoom: "switchback",
  rooms: {
    switchback: {
      name: "The Switchback",
      desc: "The path doubles back on itself against the rock. Below, cloud sits in the valley like poured milk. Above, a wall of dressed stone and a gate left standing open.",
      exits: { north: "gate" },
      ambient: ["Wind comes up the switchback and dies against the rock.", "Somewhere below the cloud, a bell rings twice and stops.", "Grit shifts under your boot and goes over the edge without a sound."],
    },
    gate: {
      name: "Ashgate",
      desc: "A gate house with no gate in it. The hinges are the size of your forearm and orange with rust. Stairs go down into dark on the left. Terraces climb east. The hall is north.",
      exits: { south: "switchback", east: "orchard", north: "hall", down: "cistern" },
      ambient: ["Water moves somewhere down the stairs, unhurried.", "The rust on the hinges is warm where the sun has been on it.", "A draught comes up from below, smelling of cold iron."],
    },
    orchard: {
      name: "The Wild Terrace",
      desc: "A terrace gone feral. Two apple trees have grown into each other over forty years of nobody pruning them. The fruit is small, hard and very red.",
      exits: { west: "gate" },
      ambient: ["An apple lets go somewhere in the tangle and knocks its way down.", "Bees work the last of the season without much conviction.", "The trees creak against each other in the wind."],
    },
    hall: {
      name: "Ash Hall",
      desc: "A long room built for forty people, holding one. There is a fire, and a table with a single place set at it, and a great deal of very good stonework nobody looks at anymore.",
      exits: { south: "gate", east: "glasshouse" },
      ambient: ["The fire settles.", "Something in the roof beams ticks as it cools.", "A draught walks the length of the hall and goes out under the door."],
    },
    glasshouse: {
      name: "The Glasshouse",
      desc: "Warm. Astonishingly warm, after the hall. Flue-pipes from the dead smelt run under the beds and the air smells green and wet. A lemon tree stands in the centre in a stone tub, heavy with fruit.",
      exits: { west: "hall" },
      ambient: ["Condensation gathers on the glass and runs.", "The flue-pipes tick under the beds.", "A leaf turns over, wet, and settles."],
    },
    cistern: {
      name: "The Black Cistern",
      desc: "The stair ends in water. A vaulted tank the size of the hall above it, half-flooded, the surface so still it looks solid until you disturb it. Your voice comes back wrong down here.",
      exits: { up: "gate" },
      ambient: ["A drop falls from the vault and the sound goes on much too long.", "The water shifts, though nothing has touched it.", "Cold comes off the surface in a sheet."],
    },
  },
  roomItems: { orchard: ["apple"], glasshouse: ["knife"] },
  mobs: {
    borin: {
      name: "Borin Ashgate", room: "hall", hp: 40, essential: true, inventory: ["lemon"],
      trades: [{ wants: "apple", gives: "lemon" }],
      card: {
        species: "dwarf",
        voice: "Old, dry, unhurried. Short sentences. Says 'aye' and 'lad' without warmth. Treats every conversation as an interruption to work he isn't doing.",
        disposition: "Not hostile. Not friendly. Waiting for you to leave.",
        knows: ["The holding emptied after the smelt failed; he stayed to keep the glasshouse alive.", "The cistern flooded that same winter and something got in with the water.", "His lemon tree is eighty years old and is the only one above the treeline."],
        withholds: ["Why he specifically stayed when the rest of the household left."],
        refusalStyle: "He does not argue and he does not explain twice. He restates the price and returns to what he was doing. Flattery gets a grunt. Threats get a long look and then nothing.",
      },
    },
    crawler: {
      name: "the sump crawler", room: "cistern", hp: 9, hostile: true, essential: false, inventory: ["minetag"],
      card: {
        species: "pale blind thing, long-limbed",
        voice: "Does not speak. Clicks. Tastes the air.",
        disposition: "Hostile. Territorial about the water.",
        knows: [], withholds: [],
        refusalStyle: "It has no language to refuse in. It withdraws or it comes forward.",
      },
    },
  },
  quests: { sourdebt: { name: "The Sour Debt", completeWhen: { playerHas: "lemon" } } },
};

/* ============================================================
   ENGINE — hand-written once, world-agnostic
   ============================================================ */
const freshState = () => ({
  turn: 0,
  player: { room: WORLD.startRoom, hp: 20, maxHp: 20, inventory: [] },
  mobs: Object.fromEntries(Object.entries(WORLD.mobs).map(([id, m]) => [id, { room: m.room, hp: m.hp, alive: true, met: false, inventory: [...m.inventory] }])),
  roomItems: JSON.parse(JSON.stringify(WORLD.roomItems)),
  quests: {}, flags: {}, over: null,
});

const roll = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));
const itemName = (id) => WORLD.items[id]?.short ?? id;
const mobsInRoom = (s, room) => Object.entries(s.mobs).filter(([, m]) => m.alive && m.room === room).map(([id]) => id);
const playerWeapon = (s) => {
  const armed = s.player.inventory.find((i) => WORLD.items[i]?.damage);
  return armed ? { id: armed, damage: WORLD.items[armed].damage } : { id: null, damage: [2, 4] };
};

function affordances(s) {
  const room = WORLD.rooms[s.player.room];
  const L = [];
  L.push("- move " + Object.keys(room.exits).map((d) => `${d} (to ${WORLD.rooms[room.exits[d]].name})`).join(", "));
  const here = s.roomItems[s.player.room] ?? [];
  if (here.length) L.push("- take " + here.map(itemName).join(", "));
  if (s.player.inventory.length) L.push("- drop " + s.player.inventory.map(itemName).join(", "));
  for (const id of mobsInRoom(s, s.player.room)) {
    const def = WORLD.mobs[id];
    L.push(`- talk to ${def.name} about anything`);
    L.push(def.essential
      ? `- ${def.name} CANNOT be killed or harmed. Any attack simply fails.`
      : `- attack ${def.name} (this is permitted)`);
    for (const t of def.trades ?? []) {
      if (!s.mobs[id].inventory.includes(t.gives)) continue;
      L.push(s.player.inventory.includes(t.wants)
        ? `- give the ${itemName(t.wants)} to ${def.name}; he will hand over the ${itemName(t.gives)} in exchange`
        : `- ${def.name} holds the ${itemName(t.gives)}. He will part with it for a ${itemName(t.wants)} and NOTHING ELSE. The player does not have one. No amount of talking, bargaining, bribing, threatening, pleading or cleverness will move him. Do not let him give it up.`);
    }
  }
  return L.join("\n");
}

const resolveItem = (input, pool) => {
  const q = String(input).toLowerCase().trim();
  return pool.find((id) => id === q) ?? pool.find((id) => itemName(id).toLowerCase() === q)
    ?? pool.find((id) => itemName(id).toLowerCase().includes(q) || q.includes(id)) ?? null;
};
const resolveMob = (input, pool) => {
  const q = String(input).toLowerCase().trim();
  return pool.find((id) => id === q) ?? pool.find((id) => WORLD.mobs[id].name.toLowerCase().includes(q))
    ?? pool.find((id) => q.includes(id)) ?? null;
};

function applyEffects(prev, effects) {
  const s = JSON.parse(JSON.stringify(prev));
  const log = [];
  const note = (text, kind = "system") => log.push({ kind, text });

  for (const e of (effects || []).slice(0, 4)) {
    const room = WORLD.rooms[s.player.room];

    if (e.move) {
      const dest = room.exits[String(e.move).toLowerCase()];
      if (!dest) { note(`There is no way ${e.move} from here.`); continue; }
      s.player.room = dest;
      for (const id of mobsInRoom(s, dest)) {
        if (!s.mobs[id].met) {
          s.mobs[id].met = true;
          if (WORLD.mobs[id].hostile) {
            const d = roll([1, 3]); s.player.hp -= d;
            note(`${WORLD.mobs[id].name} is on you before you have both feet down. −${d} health.`, "hit");
          }
        }
      }
      continue;
    }

    if (e.take) {
      const id = resolveItem(e.take, s.roomItems[s.player.room] ?? []);
      if (!id) { note(`There is no ${e.take} here to take.`); continue; }
      s.roomItems[s.player.room] = s.roomItems[s.player.room].filter((x) => x !== id);
      s.player.inventory.push(id);
      note(`Taken: ${itemName(id)}.`, "gain");
      continue;
    }

    if (e.drop) {
      const id = resolveItem(e.drop, s.player.inventory);
      if (!id) { note(`You are not carrying ${e.drop}.`); continue; }
      s.player.inventory = s.player.inventory.filter((x) => x !== id);
      (s.roomItems[s.player.room] ??= []).push(id);
      note(`Dropped: ${itemName(id)}.`);
      continue;
    }

    if (e.give) {
      const { item, to } = e.give;
      const mobId = resolveMob(to, mobsInRoom(s, s.player.room));
      if (!mobId) { note(`There is nobody here called ${to}.`); continue; }
      const itemId = resolveItem(item, s.player.inventory);
      if (!itemId) { note(`You are not carrying ${item}.`); continue; }
      const def = WORLD.mobs[mobId];
      const trade = (def.trades ?? []).find((t) => t.wants === itemId && s.mobs[mobId].inventory.includes(t.gives));
      s.player.inventory = s.player.inventory.filter((x) => x !== itemId);
      s.mobs[mobId].inventory.push(itemId);
      note(`Given: ${itemName(itemId)} to ${def.name}.`);
      if (trade) {
        s.mobs[mobId].inventory = s.mobs[mobId].inventory.filter((x) => x !== trade.gives);
        s.player.inventory.push(trade.gives);
        note(`Received: ${itemName(trade.gives)}.`, "gain");
      }
      continue;
    }

    if (e.attack) {
      const mobId = resolveMob(e.attack, mobsInRoom(s, s.player.room));
      if (!mobId) { note(`There is nothing here called ${e.attack} to fight.`); continue; }
      const def = WORLD.mobs[mobId];
      if (def.essential) { note(`${def.name} cannot be harmed. Nothing about the world changes.`); continue; }
      const w = playerWeapon(s);
      const dmg = roll(w.damage);
      s.mobs[mobId].hp -= dmg;
      note(`You hit ${def.name}${w.id ? ` with the ${itemName(w.id)}` : ""} for ${dmg}. ` +
        (s.mobs[mobId].hp > 0 ? `It has ${s.mobs[mobId].hp} left.` : "It goes down."), "hit");
      if (s.mobs[mobId].hp <= 0) {
        s.mobs[mobId].alive = false;
        const drops = s.mobs[mobId].inventory;
        if (drops.length) {
          (s.roomItems[s.player.room] ??= []).push(...drops);
          note(`It leaves behind: ${drops.map(itemName).join(", ")}.`);
          s.mobs[mobId].inventory = [];
        }
      } else {
        const back = roll([1, 3]); s.player.hp -= back;
        note(`It comes back at you. −${back} health.`, "hit");
      }
      continue;
    }
  }

  for (const [qid, q] of Object.entries(WORLD.quests)) {
    if (s.quests[qid]) continue;
    if (q.completeWhen.playerHas && s.player.inventory.includes(q.completeWhen.playerHas)) {
      s.quests[qid] = true;
      note(`Quest complete: ${q.name}.`, "quest");
    }
  }
  if (s.player.hp <= 0) { s.player.hp = 0; s.over = "dead"; note("You do not get up.", "hit"); }
  s.turn = prev.turn + 1;
  return { state: s, log };
}

function buildPrompt(state, charName) {
  const room = WORLD.rooms[state.player.room];
  const present = mobsInRoom(state, state.player.room);
  const cards = present.map((id) => {
    const d = WORLD.mobs[id], c = d.card;
    return `${d.name} — ${c.species}\n  voice: ${c.voice}\n  disposition: ${c.disposition}\n` +
      (c.knows.length ? `  knows: ${c.knows.join(" ")}\n` : "") +
      (c.withholds.length ? `  will not discuss: ${c.withholds.join(" ")}\n` : "") +
      `  refuses like this: ${c.refusalStyle}\n` +
      `  carrying: ${state.mobs[id].inventory.map(itemName).join(", ") || "nothing"}\n` +
      `  has met the player before: ${state.mobs[id].met ? "yes" : "no"}`;
  }).join("\n\n");
  const here = state.roomItems[state.player.room] ?? [];

  return `You are the narrator and the character voices for a text adventure called ${WORLD.title}.

WORLD
${WORLD.premise}

THE PLAYER
They are called ${charName}. Characters may address them by name.

CURRENT ROOM
${room.name} — ${room.desc}
Exits: ${Object.entries(room.exits).map(([d, r]) => `${d} to ${WORLD.rooms[r].name}`).join("; ")}
Lying here: ${here.length ? here.map(itemName).join(", ") : "nothing"}
Present: ${present.length ? present.map((id) => WORLD.mobs[id].name).join(", ") : "nobody"}

${cards ? "CHARACTERS PRESENT\n" + cards + "\n" : ""}
STATE
Health ${state.player.hp}/${state.player.maxHp}. Carrying: ${state.player.inventory.map(itemName).join(", ") || "nothing"}. Turn ${state.turn}.

WHAT IS ACTUALLY POSSIBLE THIS TURN
${affordances(state)}

HOW TO WRITE
- Second person, present tense. One to three short paragraphs. Restraint over flourish.
- Speak in each character's voice. Dialogue in double quotes.
- NEVER state that the player gained or lost an item, took damage, healed, or finished a quest.
  The interface reports all of that. You describe the moment, not the bookkeeping.
- If the player tries something the list above forbids, let the world or the character refuse it
  from inside the fiction, in their own style. Never mention rules, systems, or that you are an AI.
- If the player just talks, that is a complete turn. Nothing has to change.

REPLY FORMAT
Reply with JSON only. No markdown fences, no preamble.
{"reply": "your prose", "effects": []}

Effects — use only these, at most two per turn, only for what the list above permits:
{"move":"north"} {"take":"apple"} {"drop":"apple"} {"give":{"item":"apple","to":"borin"}} {"attack":"crawler"}
Conversation, looking and examining need no effects. Use an empty array.`;
}

/* ============================================================
   art placeholders
   ============================================================ */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}
function Splash({ seed, ratio = 0.5625, pending, style }) {
  const h = hash(seed || "x"), a = h % 360, b = (h >> 3) % 60;
  return (
    <div style={{ position: "relative", width: "100%", paddingTop: `${ratio * 100}%`, overflow: "hidden",
      background: `linear-gradient(${h % 180}deg, hsl(${a} 34% 22%), hsl(${(a + 40 + b) % 360} 30% 34%))`, ...style }}>
      {!pending && (
        <svg viewBox="0 0 100 56" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <circle cx={h % 100} cy={(h >> 5) % 56} r={18 + (h % 14)} fill={`hsl(${(a + 90) % 360} 44% 52%)`} opacity=".34" />
          <circle cx={(h >> 7) % 100} cy={(h >> 9) % 56} r={10 + (h % 20)} fill={`hsl(${(a + 200) % 360} 40% 60%)`} opacity=".22" />
          <path d={`M0 ${34 + (h % 12)} Q 25 ${18 + (h % 20)} 50 ${30 + (h % 16)} T 100 ${26 + (h % 14)} V56 H0Z`} fill="rgba(0,0,0,.36)" />
        </svg>
      )}
      {pending && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
        fontFamily: T.mono, fontSize: 10, letterSpacing: ".08em", color: T.boneDim }}>drawing</div>}
    </div>
  );
}

/* ============================================================
   mock data
   ============================================================ */

const seedGames = [
  { id: "hollowreach", playable: true, title: "Hollowreach", author: "Wei", authorId: "u1", tag: "WEI-4417", status: "ready", published: true, plays: 214, rooms: 6, mobs: 2, blurb: "A dwarven holding above the treeline. One lemon tree. One dwarf who will not be talked out of it." },
  { id: "g2", title: "The Long Ward", author: "Nadia", authorId: "u2", tag: "NAD-9012", status: "ready", published: true, plays: 1877, rooms: 14, mobs: 9, blurb: "Night shift in a hospital that has more corridors than it did yesterday." },
  { id: "g3", title: "Saltpetre", author: "Ilse", authorId: "u3", tag: "ILS-3388", status: "ready", published: true, plays: 640, rooms: 11, mobs: 6, blurb: "A powder mill, a strike, and four hours before the inspector arrives." },
  { id: "g4", title: "Nine Tenths of the Law", author: "Marek", authorId: "u4", tag: "MRK-7761", status: "ready", published: true, plays: 92, rooms: 8, mobs: 5, blurb: "You have inherited a house. So have several other people." },
  { id: "g5", title: "Cold Open", author: "Wei", authorId: "u1", tag: "WEI-4417", status: "draft", published: false, plays: 0, rooms: 4, mobs: 1, blurb: "Unfinished. A television studio at four in the morning." },
  { id: "g6", title: "Vetch", author: "Tomas", authorId: "u5", tag: "TOM-2245", status: "ready", published: true, plays: 431, rooms: 9, mobs: 7, blurb: "Everything in the fen wants something from you and only one of them will say what." },
];
const seedFriends = [{ id: "u2", name: "Nadia", tag: "NAD-9012" }, { id: "u3", name: "Ilse", tag: "ILS-3388" }];
const seedRooms = [
  { id: "r1", name: "The Switchback", locked: false, art: true },
  { id: "r2", name: "Ashgate", locked: true, art: true },
  { id: "r3", name: "The Wild Terrace", locked: false, art: true },
  { id: "r4", name: "Ash Hall", locked: false, art: true },
  { id: "r5", name: "The Glasshouse", locked: false, art: false },
  { id: "r6", name: "The Black Cistern", locked: false, art: false },
];

/* ============================================================
   primitives
   ============================================================ */
const Btn = ({ children, kind = "quiet", full, ...p }) => {
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

const inputStyle = { width: "100%", background: T.ground, border: `1px solid ${T.edge}`, color: T.bone,
  fontFamily: T.serif, fontSize: 15, padding: "10px 12px", borderRadius: 2 };

const Field = ({ label, hint, children }) => (
  <label style={{ display: "block", marginBottom: 20 }}>
    <div style={{ fontFamily: T.serif, fontSize: 15, marginBottom: 2 }}>{label}</div>
    {hint && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>}
    {children}
  </label>
);

const Chip = ({ status }) => {
  const map = { ready: [T.moss, "published"], draft: [T.clay, "draft"], generating: [T.ochre, "building"], failed: [T.clay, "failed"] };
  const [c, label] = map[status] ?? [T.boneDim, status];
  return <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: ".04em", color: c,
    border: `1px solid ${c}55`, padding: "2px 7px", borderRadius: 2, whiteSpace: "nowrap" }}>{label}</span>;
};

const H1 = ({ children, sub }) => (
  <div style={{ marginBottom: 22 }}>
    <h1 style={{ fontFamily: T.serif, fontSize: 27, fontWeight: 400, margin: 0, lineHeight: 1.2 }}>{children}</h1>
    {sub && <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, margin: "5px 0 0", lineHeight: 1.5, maxWidth: 480 }}>{sub}</p>}
  </div>
);

const Empty = ({ title, line, action }) => (
  <div style={{ border: `1px dashed ${T.edge}`, padding: "44px 24px", textAlign: "center", borderRadius: 2 }}>
    <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 6 }}>{title}</div>
    <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, margin: "0 0 16px", lineHeight: 1.5 }}>{line}</p>
    {action}
  </div>
);

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(238px, 1fr))", gap: 20 };
const Avatar = ({ name, tag, size = 32 }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
    fontFamily: T.serif, fontSize: size * 0.44,
    background: `linear-gradient(140deg, hsl(${hash(tag) % 360} 30% 30%), hsl(${(hash(tag) + 60) % 360} 34% 44%))` }}>
    {name[0]}
  </div>
);

/* ============================================================
   app
   ============================================================ */
export default function Ascentery() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState({ name: "browse" });
  const [games, setGames] = useState(seedGames);   // still mock until world generation exists
  const [me, setMe] = useState(null);
  const [friends, setFriends] = useState(seedFriends);
  const [chars, setChars] = useState([]);
  const [rooms, setRooms] = useState(seedRooms);
  const [saves, setSaves] = useState({}); // `${worldId}:${charId}` -> { state, log }

  const go = (name, params = {}) => setView({ name, ...params });

  // One listener handles first load, sign-in, sign-out and token refresh.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setMe(null); setChars([]); setSaves({}); setBooting(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Pull everything that belongs to this user once we have a session.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const uid = session.user.id;
        const [m, cs, sv] = await Promise.all([loadMe(uid), loadCharacters(uid), loadSaves(uid)]);
        if (cancelled) return;
        setMe(m); setChars(cs); setSaves(sv); setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  if (booting) return <Shell><Splash1 /></Shell>;
  if (!session) return <Shell><Auth /></Shell>;
  if (loadError) return (
    <Shell>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontFamily: T.serif, fontSize: 22, marginBottom: 8 }}>Couldn't load your account</div>
          <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7 }}>{loadError}</p>
          <Btn onClick={() => signOut()} style={{ marginTop: 14 }}>Sign out</Btn>
        </div>
      </div>
    </Shell>
  );
  if (!me) return <Shell><Splash1 /></Shell>;

  if (view.name === "play") {
    const key = `${view.id}:${view.charId}`;
    return (
      <Play
        char={chars.find((c) => c.id === view.charId)}
        save={saves[key]}
        onSave={(v) => {
          setSaves((s) => ({ ...s, [key]: v }));
          writeSave({ userId: me.id, worldId: view.id, characterId: view.charId, ...v })
            .catch((e) => console.error("save failed", e));
        }}
        onExit={() => go("game", { id: view.id })}
      />
    );
  }

  return (
    <Shell>
      <TopBar me={me} view={view} go={go} />
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 22px 80px" }}>
        {view.name === "browse" && <Browse games={games.filter((g) => g.published)} go={go} />}
        {view.name === "mine" && <Mine games={games.filter((g) => g.authorId === me.id)} go={go} />}
        {view.name === "friends" && <Friends friends={friends} setFriends={setFriends} games={games} go={go} />}
        {view.name === "profile" && <Profile me={me} setMe={setMe} chars={chars} setChars={setChars} />}
        {view.name === "create" && <Create me={me} setMe={setMe} games={games} setGames={setGames} go={go} />}
        {view.name === "game" && <GameDetail game={games.find((g) => g.id === view.id)} chars={chars} saves={saves} go={go} isMine={games.find((g) => g.id === view.id)?.authorId === me.id} />}
        {view.name === "edit" && <EditGame game={games.find((g) => g.id === view.id)} setGames={setGames} rooms={rooms} setRooms={setRooms} me={me} setMe={setMe} go={go} />}
      </main>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ background: T.ground, color: T.bone, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .pf-btn:hover:not(:disabled) { background: ${T.raised}; }
        .pf-btn:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.ochre}; outline-offset: 2px; }
        input:focus, textarea:focus { outline: none; }
        .pf-card { cursor: pointer; }
        .pf-card:hover .pf-title { color: ${T.ochre}; }
        ::-webkit-scrollbar { width: 8px; height: 8px }
        ::-webkit-scrollbar-thumb { background: ${T.edge} }
        @keyframes pfIn { from { opacity: 0 } to { opacity: 1 } }
        .pf-in { animation: pfIn .35s ease both }
        @media (prefers-reduced-motion: reduce) { .pf-in { animation: none } }
      `}</style>
      {children}
    </div>
  );
}

function Splash1() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ fontFamily: T.serif, fontSize: 26, color: T.boneDim }}>Ascentery</div>
    </div>
  );
}

function Auth() {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const go = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === "in") {
        await signIn({ email, password });
        // onAuthStateChange in the root takes it from here.
      } else {
        const { needsConfirmation } = await signUp({ email, password, displayName });
        if (needsConfirmation) {
          setNotice("Check your email for a confirmation link, then sign in.");
          setMode("in");
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 22 }}>
      <div style={{ width: "100%", maxWidth: 380 }} className="pf-in">
        <div style={{ fontFamily: T.serif, fontSize: 34, lineHeight: 1.1, marginBottom: 6 }}>Ascentery</div>
        <p style={{ fontFamily: T.serif, fontSize: 16, color: T.boneDim, lineHeight: 1.55, margin: "0 0 30px" }}>
          Worlds written by people, played a sentence at a time.
        </p>

        <Field label="Email">
          <input style={inputStyle} type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="you@example.com" />
        </Field>
        <Field label="Password" hint={mode === "up" ? "At least six characters." : undefined}>
          <input style={inputStyle} type="password" value={password}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="••••••••" />
        </Field>
        {mode === "up" && (
          <Field label="Display name" hint="Your gamer tag is generated for you and can't be changed.">
            <input style={inputStyle} value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="Wei" />
          </Field>
        )}

        {error && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, lineHeight: 1.6, margin: "0 0 14px" }}>
            {error}
          </p>
        )}
        {notice && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.moss, lineHeight: 1.6, margin: "0 0 14px" }}>
            {notice}
          </p>
        )}

        <Btn kind="solid" full disabled={busy || !email || !password} onClick={go} style={{ marginBottom: 14 }}>
          {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
        </Btn>
        <button className="pf-btn" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}
          style={{ background: "none", border: "none", color: T.boneDim, fontFamily: T.mono, fontSize: 11.5, cursor: "pointer", padding: 0 }}>
          {mode === "in" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

function TopBar({ me, view, go }) {
  const tabs = [["browse", "Browse"], ["mine", "Your games"], ["friends", "Friends"]];
  const frac = me.credits / me.creditCap;
  return (
    <header style={{ borderBottom: `1px solid ${T.edge}`, position: "sticky", top: 0, background: T.ground, zIndex: 10 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 22px", display: "flex", alignItems: "center", gap: 18, height: 58 }}>
        <button onClick={() => go("browse")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: T.serif, fontSize: 20, color: T.bone }}>
          Ascentery
        </button>
        <nav style={{ display: "flex", gap: 2, flex: 1, overflowX: "auto" }}>
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => go(k)} className="pf-btn"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "19px 12px",
                fontFamily: T.mono, fontSize: 12, whiteSpace: "nowrap",
                color: view.name === k ? T.bone : T.boneDim,
                boxShadow: view.name === k ? `inset 0 -2px 0 ${T.ochre}` : "none" }}>
              {label}
            </button>
          ))}
        </nav>
        <div title={`${me.credits} of ${me.creditCap} image credits`} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span aria-hidden style={{ width: 46, height: 3, background: T.edge, position: "relative", display: "inline-block" }}>
            <span style={{ position: "absolute", inset: 0, width: `${frac * 100}%`, background: frac > 0.2 ? T.ochre : T.clay }} />
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>{me.credits}</span>
        </div>
        <button onClick={() => go("profile")} title={me.tag}
          style={{ padding: 0, borderRadius: "50%", cursor: "pointer", background: "none",
            border: `1px solid ${view.name === "profile" ? T.ochre : T.edge}` }}>
          <Avatar name={me.name} tag={me.tag} />
        </button>
      </div>
    </header>
  );
}

/* ---------- browse ---------- */
function Browse({ games, go }) {
  const [q, setQ] = useState("");
  const shown = games.filter((g) => (g.title + g.author + g.blurb).toLowerCase().includes(q.toLowerCase()));
  const featured = games.find((g) => g.playable) ?? games[0];
  const rest = shown.filter((g) => g.id !== featured.id);

  return (
    <div className="pf-in">
      <div className="pf-card" onClick={() => go("game", { id: featured.id })}
        style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 24, marginBottom: 34, alignItems: "center" }}>
        <Splash seed={featured.id} ratio={0.5} />
        <div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ochre, marginBottom: 8 }}>most played this week</div>
          <div className="pf-title" style={{ fontFamily: T.serif, fontSize: 30, lineHeight: 1.15, marginBottom: 8 }}>{featured.title}</div>
          <p style={{ fontFamily: T.serif, fontSize: 16, lineHeight: 1.55, color: T.boneDim, margin: "0 0 12px" }}>{featured.blurb}</p>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {featured.author} · {featured.rooms} rooms · {featured.plays.toLocaleString()} plays
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <h2 style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, margin: 0, flex: 1 }}>Everything else</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search worlds"
          style={{ ...inputStyle, width: 200, fontFamily: T.mono, fontSize: 12, padding: "7px 10px" }} />
      </div>

      <div style={grid}>{rest.map((g) => <GameCard key={g.id} g={g} onClick={() => go("game", { id: g.id })} />)}</div>
      {!shown.length && <Empty title="Nothing matches that." line="Try a shorter word, or open the featured world above." />}
    </div>
  );
}

function GameCard({ g, onClick, showStatus }) {
  return (
    <div className="pf-card pf-in" onClick={onClick}>
      <Splash seed={g.id} pending={g.status === "generating"} />
      <div style={{ padding: "10px 2px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div className="pf-title" style={{ fontFamily: T.serif, fontSize: 18, flex: 1, lineHeight: 1.25 }}>{g.title}</div>
          {showStatus && <Chip status={g.status} />}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 5 }}>
          {g.author} · {g.plays.toLocaleString()} plays
        </div>
      </div>
    </div>
  );
}

function Mine({ games, go }) {
  return (
    <div className="pf-in">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}><H1 sub="Drafts stay private until you publish them.">Your games</H1></div>
        <Btn kind="solid" onClick={() => go("create")}>Create a game</Btn>
      </div>
      {games.length ? (
        <div style={grid}>{games.map((g) => <GameCard key={g.id} g={g} showStatus onClick={() => go("edit", { id: g.id })} />)}</div>
      ) : (
        <Empty title="You haven't built anything yet."
          line="A world takes one paragraph to describe and about a minute to generate."
          action={<Btn kind="solid" onClick={() => go("create")}>Create a game</Btn>} />
      )}
    </div>
  );
}

function Friends({ friends, setFriends, games, go }) {
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
      {theirs.length ? <div style={grid}>{theirs.map((g) => <GameCard key={g.id} g={g} onClick={() => go("game", { id: g.id })} />)}</div>
        : <Empty title="Nothing yet." line="When a friend publishes a world it turns up here." />}
    </div>
  );
}

function Profile({ me, setMe, chars, setChars }) {
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

      <div style={{ borderTop: `1px solid ${T.edge}`, paddingTop: 22, marginTop: 28 }}>
        <Btn onClick={() => signOut()}>Sign out</Btn>
      </div>
    </div>
  );
}

/* ---------- create ---------- */
const EXAMPLE =
  "A lighthouse on a tidal island, cut off for six hours either side of high water. The keeper died last " +
  "month and I've been sent to take over. There's a locked lamp room, a cellar full of somebody else's " +
  "belongings, and a woman from the village who rows out every day and will not say why. She knows what's " +
  "in the cellar. She'll only tell me if I bring her the keeper's logbook, and nothing else will make her talk.";

function Create({ me, setMe, games, setGames, go }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [phase, setPhase] = useState("idle");
  const [art, setArt] = useState({ state: "none", prompt: "" });
  const [gameId] = useState(() => "g" + Math.random().toString(36).slice(2, 7));
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);

  const build = () => { setPhase("building"); setStep(3); timer.current = setTimeout(() => setPhase("review"), 3200); };
  const draw = () => {
    if (me.credits < 12) return;
    setArt({ ...art, state: "drawing" });
    setMe({ ...me, credits: me.credits - 12 });
    timer.current = setTimeout(() => setArt((a) => ({ ...a, state: "done" })), 2200);
  };
  const publish = (published) => {
    setGames([{ id: gameId, title: title || "Untitled world", author: me.name, authorId: me.id, tag: me.tag,
      status: published ? "ready" : "draft", published, plays: 0, rooms: 9, mobs: 5,
      blurb: desc.slice(0, 120) + (desc.length > 120 ? "…" : "") }, ...games]);
    go("mine");
  };

  const steps = ["Describe it", "Check it over", "Give it a face"];
  return (
    <div className="pf-in" style={{ maxWidth: 660 }}>
      <H1>Create a game</H1>
      <div style={{ display: "flex", gap: 18, marginBottom: 28, flexWrap: "wrap" }}>
        {steps.map((s, i) => (
          <div key={s} style={{ fontFamily: T.mono, fontSize: 11.5,
            color: step === i + 1 ? T.ochre : step > i + 1 ? T.boneDim : T.edge }}>
            {step > i + 1 ? "✓ " : `${i + 1}. `}{s}
          </div>
        ))}
      </div>

      {step === 1 && (<>
        <Field label="Title"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Lamp Room" /></Field>
        <Field label="Describe the world" hint="Places, who's in them, what they want, and above all what can't be talked around. The rules you write here are the ones the game will actually enforce.">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={10}
            placeholder="Somewhere real enough to walk around in…"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
          <Btn kind="ghost" onClick={() => { setDesc(EXAMPLE); setTitle("The Lamp Room"); }}>use an example</Btn>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {desc.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </div>
        <Btn kind="solid" disabled={desc.trim().length < 40} onClick={() => setStep(2)}>Continue</Btn>
      </>)}

      {step === 2 && (<>
        <p style={{ fontFamily: T.serif, fontSize: 16, lineHeight: 1.6, color: T.boneDim, marginTop: 0 }}>
          Building takes about a minute. You can leave this page — the game shows up under Your games and finishes on its own.
        </p>
        <div style={{ border: `1px solid ${T.edge}`, padding: 18, borderRadius: 2, marginBottom: 24 }}>
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 8 }}>{title || "Untitled world"}</div>
          <p style={{ fontFamily: T.serif, fontSize: 15, lineHeight: 1.6, color: T.boneDim, margin: 0, whiteSpace: "pre-wrap" }}>{desc}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={() => setStep(1)}>Back</Btn>
          <Btn kind="solid" onClick={build}>Build the world</Btn>
        </div>
      </>)}

      {step === 3 && phase === "building" && <Building />}

      {step === 3 && phase === "review" && (<>
        <div style={{ border: `1px solid ${T.edge}`, borderRadius: 2, marginBottom: 24 }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.edge}`, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: T.serif, fontSize: 17, flex: 1 }}>What got built</span><Chip status="ready" />
          </div>
          <div style={{ padding: "14px 18px", fontFamily: T.mono, fontSize: 12.5, lineHeight: 2, color: T.boneDim }}>
            <div>9 rooms, every exit leads somewhere and comes back</div>
            <div>5 characters, all placed in rooms that exist</div>
            <div>2 quests, 7 items, 1 locked door with a key that exists</div>
            <div style={{ color: T.clay }}>1 warning — the cellar has no way out except the way in</div>
          </div>
        </div>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, marginTop: 0 }}>
          Now give it a cover. This costs 12 credits, and you can redraw it later.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, alignItems: "start", marginBottom: 24 }}>
          <Splash seed={gameId} ratio={0.75} pending={art.state !== "done"} />
          <div>
            <textarea rows={4} value={art.prompt || (desc ? desc.slice(0, 140) : "")}
              onChange={(e) => setArt({ ...art, prompt: e.target.value })}
              placeholder="What the cover should show"
              style={{ ...inputStyle, fontSize: 14, lineHeight: 1.55, resize: "vertical", marginBottom: 10 }} />
            <Btn onClick={draw} disabled={art.state === "drawing" || me.credits < 12}>
              {art.state === "drawing" ? "drawing…" : art.state === "done" ? "Redraw · 12" : "Draw cover · 12"}
            </Btn>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn kind="solid" onClick={() => publish(true)}>Publish</Btn>
          <Btn onClick={() => publish(false)}>Keep as draft</Btn>
          <Btn kind="danger" onClick={() => { setPhase("idle"); setStep(1); }}>Start over</Btn>
        </div>
      </>)}
    </div>
  );
}

function Building() {
  const lines = ["Reading the description", "Laying out rooms and exits", "Placing characters", "Checking every door leads somewhere"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => Math.min(x + 1, lines.length - 1)), 800); return () => clearInterval(t); }, []);
  return (
    <div style={{ border: `1px solid ${T.edge}`, padding: "36px 22px", borderRadius: 2 }}>
      {lines.map((l, n) => (
        <div key={l} style={{ fontFamily: T.mono, fontSize: 12.5, lineHeight: 2.1,
          color: n < i ? T.boneDim : n === i ? T.ochre : T.edge }}>
          {n < i ? "✓ " : n === i ? "· " : "  "}{l}
        </div>
      ))}
    </div>
  );
}

/* ---------- game detail ---------- */
function GameDetail({ game, chars, saves, go, isMine }) {
  const [picked, setPicked] = useState(chars[0]?.id ?? null);
  if (!game) return <Empty title="That world is gone." line="It may have been unpublished by its author." />;
  const save = saves[`${game.id}:${picked}`];

  return (
    <div className="pf-in">
      <Btn kind="ghost" onClick={() => go("browse")} style={{ marginBottom: 16 }}>back</Btn>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 26, alignItems: "start" }}>
        <Splash seed={game.id} ratio={0.56} />
        <div>
          <h1 style={{ fontFamily: T.serif, fontSize: 30, fontWeight: 400, margin: "0 0 8px", lineHeight: 1.15 }}>{game.title}</h1>
          <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, marginBottom: 14 }}>
            {game.author} · {game.tag} · {game.rooms} rooms · {game.plays.toLocaleString()} plays
          </div>
          <p style={{ fontFamily: T.serif, fontSize: 16.5, lineHeight: 1.6, margin: "0 0 22px" }}>{game.blurb}</p>

          <div style={{ fontFamily: T.serif, fontSize: 15, marginBottom: 8 }}>Play as</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {chars.map((c) => (
              <button key={c.id} onClick={() => setPicked(c.id)} className="pf-btn"
                style={{ fontFamily: T.mono, fontSize: 12, padding: "8px 13px", cursor: "pointer", borderRadius: 2,
                  background: "transparent", color: picked === c.id ? T.bone : T.boneDim,
                  border: `1px solid ${picked === c.id ? T.ochre : T.edge}` }}>
                {c.name}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 20, height: 16 }}>
            {save ? `turn ${save.state.turn} — picks up where they left off` : picked ? "new game" : "make a character on your profile first"}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn kind="solid" disabled={!picked || !game.playable} onClick={() => go("play", { id: game.id, charId: picked })}>
              {save ? "Continue" : "Start"}
            </Btn>
            {isMine && <Btn onClick={() => go("edit", { id: game.id })}>Edit</Btn>}
            <Btn kind="ghost">report</Btn>
          </div>
          {!game.playable && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.clay, marginTop: 12 }}>
              Not built yet in this prototype. Hollowreach is the one with a world behind it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- edit ---------- */
function EditGame({ game, setGames, rooms, setRooms, me, setMe, go }) {
  const [tab, setTab] = useState("rooms");
  if (!game) return <Empty title="Not found." line="This game may have been deleted." />;
  return (
    <div className="pf-in">
      <Btn kind="ghost" onClick={() => go("mine")} style={{ marginBottom: 14 }}>back</Btn>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: T.serif, fontSize: 28, fontWeight: 400, margin: 0 }}>{game.title}</h1>
        <Chip status={game.status} />
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, marginBottom: 22 }}>
        {game.rooms} rooms · {game.mobs} characters · {game.plays.toLocaleString()} plays
      </div>
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${T.edge}`, marginBottom: 24 }}>
        {[["rooms", "Rooms"], ["world", "World"], ["settings", "Settings"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pf-btn"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 14px", fontFamily: T.mono, fontSize: 12,
              color: tab === k ? T.bone : T.boneDim, boxShadow: tab === k ? `inset 0 -2px 0 ${T.ochre}` : "none" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "rooms" && <RoomsTab rooms={rooms} setRooms={setRooms} me={me} setMe={setMe} />}
      {tab === "world" && (
        <p style={{ fontFamily: T.serif, fontSize: 16, lineHeight: 1.6, color: T.boneDim, maxWidth: 560 }}>
          The room graph, characters, items and quests, with the validator's warnings inline. Editing here
          re-runs validation before anything saves.
        </p>
      )}
      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <Field label="Published" hint="Unpublishing hides it from Browse. People mid-playthrough keep their saves.">
            <Btn onClick={() => setGames((gs) => gs.map((g) => g.id === game.id ? { ...g, published: !g.published, status: g.published ? "draft" : "ready" } : g))}>
              {game.published ? "Unpublish" : "Publish"}
            </Btn>
          </Field>
          <div style={{ borderTop: `1px solid ${T.edge}`, paddingTop: 20, marginTop: 20 }}>
            <Btn kind="danger" onClick={() => { setGames((gs) => gs.filter((g) => g.id !== game.id)); go("mine"); }}>Delete this world</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomsTab({ rooms, setRooms, me, setMe }) {
  const [drawing, setDrawing] = useState(null);
  const missing = rooms.filter((r) => !r.art).length;
  const draw = (id) => {
    if (me.credits < 12) return;
    setDrawing(id);
    setMe((m) => ({ ...m, credits: m.credits - 12 }));
    setTimeout(() => {
      setRooms((rs) => rs.map((r) => r.id === id ? { ...r, art: true, seed: Math.random().toString(36) } : r));
      setDrawing(null);
    }, 1800);
  };
  const drawAll = () => rooms.filter((r) => !r.art && !r.locked).forEach((r, i) => setTimeout(() => draw(r.id), i * 400));

  return (<>
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
      <p style={{ fontFamily: T.serif, fontSize: 15.5, color: T.boneDim, lineHeight: 1.55, margin: 0, flex: 1, minWidth: 260 }}>
        Lock a room once you're happy with it. Locked rooms are skipped by redraws, including bulk ones.
      </p>
      {missing > 0 && <Btn onClick={drawAll} disabled={me.credits < missing * 12}>Draw {missing} missing · {missing * 12}</Btn>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 18 }}>
      {rooms.map((r) => (
        <div key={r.id}>
          <div style={{ position: "relative" }}>
            <Splash seed={(r.seed || "") + r.id} pending={drawing === r.id || !r.art} />
            <button onClick={() => setRooms(rooms.map((x) => x.id === r.id ? { ...x, locked: !x.locked } : x))}
              title={r.locked ? "Unlock to allow redraws" : "Lock to protect from redraws"} className="pf-btn"
              style={{ position: "absolute", top: 7, right: 7, width: 27, height: 27, borderRadius: 2, cursor: "pointer",
                background: r.locked ? T.ochre : "rgba(20,22,17,.72)", border: `1px solid ${r.locked ? T.ochre : T.edge}`,
                color: r.locked ? "#221D0C" : T.bone, fontSize: 12, lineHeight: 1 }}>
              {r.locked ? "🔒" : "🔓"}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <span style={{ fontFamily: T.serif, fontSize: 15.5, flex: 1 }}>{r.name}</span>
            <button onClick={() => !r.locked && draw(r.id)} disabled={r.locked || drawing === r.id || me.credits < 12} className="pf-btn"
              style={{ background: "none", border: "none", padding: 0, fontFamily: T.mono, fontSize: 11,
                color: r.locked ? T.edge : T.boneDim, cursor: r.locked ? "not-allowed" : "pointer" }}>
              {drawing === r.id ? "drawing" : r.art ? "redraw · 12" : "draw · 12"}
            </button>
          </div>
        </div>
      ))}
    </div>
  </>);
}

/* ============================================================
   PLAY — the world runs on paper
   ============================================================ */
function Play({ char, save, onSave, onExit }) {
  const [state, setState] = useState(() => save?.state ?? freshState());
  const [log, setLog] = useState(() => save?.log ?? [
    { kind: "room", text: WORLD.rooms[WORLD.startRoom].name },
    { kind: "narration", text: WORLD.rooms[WORLD.startRoom].desc },
    { kind: "narration", text: `You have been climbing since first light. The gate is open.` },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const logRef = useRef(null), inputRef = useRef(null), stateRef = useRef(state), busyRef = useRef(busy);
  stateRef.current = state; busyRef.current = busy;

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log, busy]);
  useEffect(() => { onSave({ state, log }); }, [state, log]);

  useEffect(() => {
    const t = setInterval(() => {
      if (busyRef.current || stateRef.current.over) return;
      const pool = WORLD.rooms[stateRef.current.player.room].ambient;
      setLog((l) => [...l, { kind: "ambient", text: pool[Math.floor(Math.random() * pool.length)] }]);
    }, 24000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback(async () => {
    const command = input.trim();
    if (!command || busy || state.over) return;
    setInput("");
    setLog((l) => [...l, { kind: "you", text: command }]);
    setBusy(true);
    try {
      // Goes to the narrate edge function, which holds the DeepSeek key
      // and returns { reply, effects } already parsed.
      const parsed = await narrate({
        prompt: buildPrompt(state, char?.name ?? "the traveller"),
        command,
      });

      const { state: next, log: engineLog } = applyEffects(state, parsed.effects ?? []);
      const entries = [];
      if (parsed.reply) entries.push({ kind: "narration", text: parsed.reply });
      entries.push(...engineLog);
      if (next.player.room !== state.player.room) {
        entries.push({ kind: "room", text: WORLD.rooms[next.player.room].name });
        entries.push({ kind: "narration", text: WORLD.rooms[next.player.room].desc });
      }
      setLog((l) => [...l, ...entries]);
      setState(next);
    } catch (err) {
      setLog((l) => [...l, { kind: "system", text: err.message || "The connection dropped mid-sentence. Try the command again." }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [input, busy, state, char]);

  const restart = () => {
    setState(freshState());
    setLog([{ kind: "room", text: WORLD.rooms[WORLD.startRoom].name },
      { kind: "narration", text: WORLD.rooms[WORLD.startRoom].desc }]);
  };

  const room = WORLD.rooms[state.player.room];
  const carrying = state.player.inventory.map(itemName);
  const hpFrac = state.player.hp / state.player.maxHp;

  return (
    <div style={{ background: P.paper, minHeight: "100vh", color: P.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; } body { margin: 0 }
        .hr-log::-webkit-scrollbar { width: 3px }
        .hr-log::-webkit-scrollbar-thumb { background: ${P.inkSoft}44 }
        .hr-in::placeholder { color: ${P.inkSoft}88 }
        .hr-in:focus { outline: none }
        .hr-btn:focus-visible { outline: 2px solid ${P.ochre}; outline-offset: 2px }
        @keyframes hrIn { from { opacity: 0 } to { opacity: 1 } }
        .hr-fade { animation: hrIn .5s ease both }
        @media (prefers-reduced-motion: reduce) { .hr-fade { animation: none } }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column",
        borderLeft: `1px solid ${P.inkSoft}22`, borderRight: `1px solid ${P.inkSoft}22` }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "12px 20px 10px", borderBottom: `1px solid ${P.inkSoft}33`,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft }}>
          <button onClick={onExit} className="hr-btn"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: P.inkSoft }}>
            ‹ leave
          </button>
          <span style={{ fontFamily: "Newsreader, serif", fontSize: 16, color: P.ink }}>
            {WORLD.title}<span style={{ color: P.inkSoft }}> · {char?.name}</span>
          </span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden style={{ width: 30, height: 3, background: `${P.inkSoft}33`, display: "inline-block", position: "relative" }}>
                <span style={{ position: "absolute", inset: 0, width: `${hpFrac * 100}%`, background: hpFrac > 0.4 ? P.moss : P.rust }} />
              </span>
              {state.player.hp}
            </span>
            <span>t{state.turn}</span>
          </span>
        </div>

        <div ref={logRef} className="hr-log" style={{ flex: 1, overflowY: "auto", padding: "22px 20px 8px", minHeight: 0 }}>
          {log.map((e, i) => <LogLine key={i} entry={e} />)}
          {busy && <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft, margin: "18px 0" }}>…</p>}
        </div>

        <div style={{ borderTop: `1px solid ${P.inkSoft}33`, padding: "10px 20px", background: P.paperDeep,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.7, color: P.inkSoft }}>
          <div>{room.name.toLowerCase()} · exits {Object.keys(room.exits).join(" ")}</div>
          <div>carrying {carrying.length ? carrying.join(" · ") : "nothing"}</div>
        </div>

        {state.over ? (
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${P.inkSoft}33`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <p style={{ fontFamily: "Newsreader, serif", fontSize: 16, margin: 0, flex: 1, minWidth: 180 }}>The cistern keeps you.</p>
            <button className="hr-btn" onClick={restart}
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 16px", background: "transparent", border: `1px solid ${P.ink}`, color: P.ink, cursor: "pointer" }}>
              Climb back up
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px 14px", borderTop: `1px solid ${P.inkSoft}33` }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: P.ochre, fontSize: 13 }}>›</span>
            <input ref={inputRef} className="hr-in" value={input} autoFocus disabled={busy}
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="go north · talk to borin · take the apple"
              style={{ flex: 1, background: "transparent", border: "none", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: P.ink, padding: "4px 0" }} />
            <button className="hr-btn" onClick={submit} disabled={busy}
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, background: "transparent",
                border: `1px solid ${P.inkSoft}55`, color: P.inkSoft, padding: "5px 10px", cursor: busy ? "default" : "pointer" }}>
              send
            </button>
          </div>
        )}

        <div style={{ borderTop: `1px solid ${P.inkSoft}22` }}>
          <button className="hr-btn" onClick={() => setShowPrompt((v) => !v)}
            style={{ width: "100%", textAlign: "left", padding: "9px 20px", background: "transparent", border: "none",
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: ".04em", color: P.inkSoft, cursor: "pointer" }}>
            {showPrompt ? "hide" : "show"} what gets prepended to your next command
          </button>
          {showPrompt && (
            <pre style={{ margin: 0, padding: "0 20px 20px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
              lineHeight: 1.65, color: P.inkSoft, whiteSpace: "pre-wrap", maxHeight: 340, overflowY: "auto" }}>
              {buildPrompt(state, char?.name ?? "the traveller")}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function LogLine({ entry }) {
  const base = { fontFamily: "Newsreader, serif", margin: "0 0 18px" };
  if (entry.kind === "room")
    return <p className="hr-fade" style={{ ...base, fontSize: 21, margin: "26px 0 10px", paddingBottom: 6, borderBottom: `1px solid ${P.inkSoft}2e` }}>{entry.text}</p>;
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
