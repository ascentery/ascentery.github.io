import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { supabase, narrate } from "./lib/supabase";
import {
  loadMe, saveDisplayName,
  loadCharacters, createCharacter, updateCharacterBio, deleteCharacter,
  loadSaves, writeSave,
  loadWorlds, loadWorldData, createWorld, generateWorld,
  setPublished, deleteWorld, bumpPlays,
  loadArt, drawArt, setArtLock, setArtPrompt,
  loadArtConfig, saveArtConfig, DEFAULT_ART, ENGINES, money, PRICE_CENTS,
  SORTS, sortWorlds,
  ROOM_CHOICES, genCost, GEN_BASE_CENTS, GEN_PER_ROOM_CENTS,
  renameEntity, loadNameables, amendWorld,
  REPORT_REASONS, reportWorld, loadReports, resolveReport, unpublishWorld,
  checkUsername, claimUsername, startCheckout, TOPUPS,
  loadSetting, saveSetting, PROVIDERS,
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
   ENGINE — hand-written once, world-agnostic
   ============================================================ */
export function makeEngine(WORLD) {

const freshState = () => ({
  turn: 0,
  player: { room: WORLD.startRoom, hp: 20, maxHp: 20, inventory: [] },
  mobs: Object.fromEntries(Object.entries(WORLD.mobs).map(([id, m]) => [id, { room: m.room, hp: m.hp, alive: true, met: false, inventory: [...m.inventory] }])),
  roomItems: JSON.parse(JSON.stringify(WORLD.roomItems)),
  quests: Object.fromEntries(Object.keys(WORLD.quests ?? {}).map((k) => [k, 0])),
  /* Doors you have opened, keyed "room:direction". Having the key is not
     the same as having used it: a locked door should be a moment, not a
     silent tax on your inventory. */
  opened: {},
  flags: {}, over: null,
});

const roll = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));
const itemName = (id) => WORLD.items[id]?.short ?? id;
/** Exits may be "room_key" or { to, locked }. One accessor, used everywhere,
    so the rest of the engine never has to care which. */
const exitOf = (room, dir) => {
  const ex = room?.exits?.[dir];
  if (!ex) return null;
  return typeof ex === "string" ? { to: ex, locked: null } : { to: ex.to, locked: ex.locked ?? null };
};
const exitsOf = (room) => Object.keys(room?.exits ?? {}).map((d) => ({ dir: d, ...exitOf(room, d) }));

const mobsInRoom = (s, room) => Object.entries(s.mobs).filter(([, m]) => m.alive && m.room === room).map(([id]) => id);
const playerWeapon = (s) => {
  const armed = s.player.inventory.find((i) => WORLD.items[i]?.damage);
  return armed ? { id: armed, damage: WORLD.items[armed].damage } : { id: null, damage: [2, 4] };
};

function affordances(s) {
  const room = WORLD.rooms[s.player.room];
  const L = [];
  const held = new Set(s.player.inventory);
  L.push("- move " + exitsOf(room).map(({ dir, to, locked }) => {
    const dest = WORLD.rooms[to]?.name ?? to;
    if (!locked) return `${dir} (to ${dest})`;
    if (s.opened?.[`${s.player.room}:${dir}`]) return `${dir} (to ${dest}, unlocked earlier)`;
    return held.has(locked)
      ? `${dir} (to ${dest}, LOCKED. The player holds the ${itemName(locked)} but has not used it. ` +
        `They must open it before they can pass; carrying the key is not the same as having opened the door)`
      : `${dir} (to ${dest}, LOCKED — the player does not have the ${itemName(locked)} and cannot pass)`;
  }).join(", "));
  const here = s.roomItems[s.player.room] ?? [];
  if (here.length) L.push("- take " + here.map(itemName).join(", "));
  if (s.player.inventory.length) L.push("- drop " + s.player.inventory.map(itemName).join(", "));
  for (const id of mobsInRoom(s, s.player.room)) {
    const def = WORLD.mobs[id];
    L.push(`- talk to ${def.name} about anything`);
    L.push(`- ${def.name} cannot be fought, harmed or threatened into anything. ` +
      `Violence is not part of this game; if the player reaches for it, the world declines ` +
      `in its own voice rather than explaining a rule.`);
    for (const t of def.trades ?? []) {
      if (!s.mobs[id].inventory.includes(t.gives)) continue;
      L.push(s.player.inventory.includes(t.wants)
        ? `- give the ${itemName(t.wants)} to ${def.name}; they hand over the ${itemName(t.gives)} in exchange. ` +
          `This REQUIRES the effect {"give":{"item":"${t.wants}","to":"${id}"}}. Describing the exchange ` +
          `without that effect leaves the player empty-handed.`
        : `- ${def.name} holds the ${itemName(t.gives)}. He will part with it for a ${itemName(t.wants)} and NOTHING ELSE. The player does not have one. No amount of talking, bargaining, bribing, threatening, pleading or cleverness will move him. Do not let him give it up.`);
    }
  }
  const active = questProgress(s).filter((p) => !p.done);
  if (active.length) {
    L.push("");
    L.push("WHAT THE PLAYER IS TRYING TO DO RIGHT NOW");
    for (const p of active) {
      L.push(`- ${p.quest.name}: ${p.stages[p.at].goal}`);
    }
    L.push("Characters may allude to this if it is their business. Do not announce it as a task list.");
  }

  return L.join("\n");
}

/* Models write "the Golden Fleece"; the world calls it `golden_fleece` and
   displays it as "golden fleece". Comparing raw strings makes underscores
   and a leading article enough to lose a match, so everything is flattened
   the same way before any of it is compared. */
const norm = (str) =>
  String(str ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/^(the|a|an|some|my|your|his|her|their)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

/* Every item in `pool` that the phrase could plausibly mean, best tier
   first. "golden" matches both the apples and the fleece; the caller asks
   rather than guessing. */
const matchItems = (input, pool) => {
  const q = norm(input);
  if (!q) return [];
  const names = (id) => [norm(id), norm(itemName(id)), norm(WORLD.items[id]?.name)].filter(Boolean);

  const exact = pool.filter((id) => names(id).includes(q));
  if (exact.length) return exact;

  const partial = pool.filter((id) => names(id).some((n) => n.includes(q) || q.includes(n)));
  if (partial.length) return partial;

  const words = new Set(q.split(" ").filter((w) => w.length > 2));
  return pool.filter((id) => names(id).some((n) => n.split(" ").some((w) => words.has(w))));
};

const resolveItem = (input, pool) => {
  const q = norm(input);
  if (!q) return null;
  const names = (id) => [norm(id), norm(itemName(id)), norm(WORLD.items[id]?.name)];

  return (
    pool.find((id) => names(id).includes(q)) ??
    // "give him the fleece" against "golden fleece", or the other way round
    pool.find((id) => names(id).some((n) => n && (n.includes(q) || q.includes(n)))) ??
    // last resort: any shared word longer than three letters
    pool.find((id) => {
      const words = new Set(q.split(" ").filter((w) => w.length > 3));
      return names(id).some((n) => n && n.split(" ").some((w) => words.has(w)));
    }) ?? null
  );
};

const resolveMob = (input, pool) => {
  const q = norm(input);
  if (!q) return null;
  const names = (id) => [norm(id), norm(WORLD.mobs[id]?.name)];

  return (
    pool.find((id) => names(id).includes(q)) ??
    pool.find((id) => names(id).some((n) => n && (n.includes(q) || q.includes(n)))) ??
    // "Chiron the Centaur" against "chiron"
    pool.find((id) => {
      const words = new Set(q.split(" ").filter((w) => w.length > 2));
      return names(id).some((n) => n && n.split(" ").some((w) => words.has(w)));
    }) ?? null
  );
};

/* Quest stages. A quest is an ordered chain; `s.quests[qid]` is the index of
   the stage still to be done, and the quest is finished once that index runs
   past the end. A stage can satisfy itself the moment the previous one does,
   so this advances in a loop rather than one step per turn. */
const stagesOf = (q) => (Array.isArray(q?.stages) && q.stages.length)
  ? q.stages
  // A world written before chains existed: one condition, one stage.
  : (q?.completeWhen?.playerHas
      ? [{ goal: `Obtain the ${itemName(q.completeWhen.playerHas)}`, when: { playerHas: q.completeWhen.playerHas } }]
      : []);

function stageMet(s, when) {
  if (!when) return false;
  if (when.playerHas) return s.player.inventory.includes(when.playerHas);
  if (when.inRoom) return s.player.room === when.inRoom;
  if (when.mobDead) return s.mobs[when.mobDead] ? !s.mobs[when.mobDead].alive : false;
  if (when.mobHas) {
    const m = s.mobs[when.mobHas.mob];
    return Boolean(m && (m.inventory ?? []).includes(when.mobHas.item));
  }
  return false;
}

function questProgress(s) {
  const out = [];
  for (const [qid, q] of Object.entries(WORLD.quests ?? {})) {
    const stages = stagesOf(q);
    if (!stages.length) continue;
    const raw = s.quests?.[qid];
    // `true` is how a save from before chains recorded completion.
    const at = raw === true ? stages.length : (Number(raw) || 0);
    out.push({ qid, quest: q, stages, at, done: at >= stages.length });
  }
  return out;
}

function advanceQuests(s, note) {
  for (const { qid, quest, stages, at, done } of questProgress(s)) {
    if (done) continue;
    let i = at;
    while (i < stages.length && stageMet(s, stages[i].when)) i++;
    if (i === at) continue;

    s.quests[qid] = i;
    if (i >= stages.length) {
      note(`Quest complete: ${quest.name}.`, "quest");
    } else {
      note(`${quest.name} — ${stages[i].goal}`, "quest");
    }
  }
}

/* A save is a snapshot of a world that may since have been edited: a
   character added, an item retired, a room renamed. Rather than throwing the
   playthrough away, bring it into line with what the world says now.

   Anything the player is holding or has already done is left alone. Only
   things that no longer exist are dropped, and things that did not exist
   before are added where the world puts them. */
function reconcile(state) {
  const s = JSON.parse(JSON.stringify(state));
  const changes = [];

  s.mobs ??= {};
  s.roomItems ??= {};
  s.player ??= { room: WORLD.startRoom, hp: 20, maxHp: 20, inventory: [] };
  s.player.inventory ??= [];
  s.quests ??= {};
  s.opened ??= {};

  // characters the world has gained
  for (const [id, def] of Object.entries(WORLD.mobs ?? {})) {
    if (s.mobs[id]) continue;
    s.mobs[id] = {
      room: def.room, hp: def.hp, alive: true, met: false,
      inventory: [...(def.inventory ?? [])],
    };
    changes.push(`${def.name} is here now.`);
  }

  // and characters it has lost
  for (const id of Object.keys(s.mobs)) {
    if (!WORLD.mobs?.[id]) { delete s.mobs[id]; changes.push("Someone has gone."); }
  }

  // items that no longer exist, wherever they are
  const known = (id) => Boolean(WORLD.items?.[id]);
  const dropped = s.player.inventory.filter((i) => !known(i));
  if (dropped.length) {
    s.player.inventory = s.player.inventory.filter(known);
    changes.push("Something you were carrying is no longer part of this world.");
  }
  for (const [rk, list] of Object.entries(s.roomItems)) {
    if (!WORLD.rooms?.[rk]) { delete s.roomItems[rk]; continue; }
    s.roomItems[rk] = (list ?? []).filter(known);
  }
  for (const m of Object.values(s.mobs)) {
    m.inventory = (m.inventory ?? []).filter(known);
  }

  // anything the world now places that no save has seen
  for (const [rk, list] of Object.entries(WORLD.roomItems ?? {})) {
    if (!s.roomItems[rk]) s.roomItems[rk] = [...list];
  }

  // and a room that was renamed out from under the player
  if (!WORLD.rooms?.[s.player.room]) {
    s.player.room = WORLD.startRoom;
    changes.push("Where you were standing is gone. You are back at the beginning.");
  }

  return { state: s, changes };
}

function applyEffects(prev, effects) {
  const s = JSON.parse(JSON.stringify(prev));
  const log = [];
  const note = (text, kind = "system") => log.push({ kind, text });

  for (const e of (effects || []).slice(0, 4)) {
    const room = WORLD.rooms[s.player.room];

    if (e.move) {
      const dir = String(e.move).toLowerCase();
      const ex = exitOf(room, dir);
      if (!ex?.to || !WORLD.rooms[ex.to]) { note(`There is no way ${e.move} from here.`); continue; }
      if (ex.locked && !s.opened?.[`${s.player.room}:${dir}`]) {
        note(s.player.inventory.includes(ex.locked)
          ? `The way ${dir} is locked. You have the ${itemName(ex.locked)}; open it first.`
          : `The way ${dir} is locked. It needs the ${itemName(ex.locked)}.`);
        continue;
      }
      const dest = ex.to;
      s.player.room = dest;
      // Nobody ambushes anybody while fighting is shelved; meeting is
      // still recorded, because characters greet a stranger differently
      // from someone they have seen before.
      for (const id of mobsInRoom(s, dest)) s.mobs[id].met = true;
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
      /* The prompt asks for {"give":{"item","to"}}, but models drift toward
         {"give":"logbook","to":"mara"} and {"give":{"what","target"}}.
         All three mean the same thing, so accept all three rather than
         drop a turn the player thought worked. */
      const g = e.give;
      const item = typeof g === "string" ? g : (g.item ?? g.what ?? g.object);
      const to = (typeof g === "string" ? e.to : (g.to ?? g.target ?? g.who)) ?? e.to;
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

    /* Fighting is shelved, not deleted. The resolution below still works
       and can be switched back on by removing this guard; for now a world
       that asks for it is told nothing happened, which is true. */
    if (e.attack || e.kill || e.fight) {
      note("Nothing here can be fought.");
      continue;
    }

    if (false) {
      const target = e.attack ?? e.kill ?? e.fight;
      const mobId = resolveMob(target, mobsInRoom(s, s.player.room));
      if (!mobId) { note(`There is nothing here called ${target} to fight.`); continue; }
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

    if (e.open || e.close) {
      const closing = Boolean(e.close);
      const dir = String(e.open ?? e.close).toLowerCase();
      const ex = exitOf(room, dir);
      if (!ex?.to) { note(`There is nothing ${dir} of here to open.`); continue; }
      if (!ex.locked) {
        note(closing ? `The way ${dir} has no lock on it.` : `The way ${dir} is already open.`);
        continue;
      }

      const key = `${s.player.room}:${dir}`;
      if (closing) {
        if (!s.opened[key]) { note(`The way ${dir} is already shut.`); continue; }
        delete s.opened[key];
        note(`You shut the way ${dir}. It locks behind you.`);
        continue;
      }

      if (s.opened[key]) { note(`The way ${dir} is already open.`); continue; }
      if (!s.player.inventory.includes(ex.locked)) {
        note(`It will not open. It needs the ${itemName(ex.locked)}.`);
        continue;
      }
      s.opened[key] = true;
      note(`The ${itemName(ex.locked)} turns. The way ${dir} is open.`, "gain");
      continue;
    }

    /* Nothing matched. Silence here is how a player comes to believe a trade
       happened: the prose says it did and the state disagrees. Say so, and
       log the shape so it can be handled above. */
    console.warn("unrecognised effect", JSON.stringify(e));
    note("Nothing about the world actually changed.");
  }

  advanceQuests(s, note);
  if (s.player.hp <= 0) { s.player.hp = 0; s.over = "dead"; note("You do not get up.", "hit"); }
  s.turn = prev.turn + 1;
  return { state: s, log };
}

function buildPrompt(state, charName) {
  const room = WORLD.rooms[state.player.room];
  const present = mobsInRoom(state, state.player.room);
  const cards = present.map((id) => {
    const d = WORLD.mobs[id], c = d.card ?? {};
    return `${d.name} — ${c.species}${c.pronouns ? `, ${c.pronouns}` : ""}\n` +
      `  refer to them as: ${c.pronouns || "they/them"}\n` +
      `  voice: ${c.voice}\n  disposition: ${c.disposition}\n` +
      ((c.knows ?? []).length ? `  knows: ${c.knows.join(" ")}\n` : "") +
      ((c.withholds ?? []).length ? `  will not discuss: ${c.withholds.join(" ")}\n` : "") +
      `  refuses like this: ${c.refusalStyle ?? "plainly, and without explaining any rules"}\n` +
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
${room.name} (${room.exposure ?? "indoors"}) — ${room.desc}
Exits: ${exitsOf(room).map(({ dir, to, locked }) => `${dir} to ${WORLD.rooms[to]?.name ?? to}${locked ? " (locked)" : ""}`).join("; ")}
Lying here: ${here.length ? here.map(itemName).join(", ") : "nothing"}
Present: ${present.length ? present.map((id) => WORLD.mobs[id].name).join(", ") : "nobody"}

${cards ? "CHARACTERS PRESENT\n" + cards + "\n" : ""}
STATE
Health ${state.player.hp}/${state.player.maxHp}. Carrying: ${state.player.inventory.map(itemName).join(", ") || "nothing"}. Turn ${state.turn}.

WHAT IS ACTUALLY POSSIBLE THIS TURN
${affordances(state)}

HOW TO WRITE
- Second person, present tense. One to three short paragraphs. Restraint over flourish.
- The word in brackets after the room name says how exposed it is: open, sheltered, indoors,
  sealed or underground. Do not put weather or daylight into a sealed or underground room.
- Speak in each character's voice. Dialogue in double quotes.
- Use each character's stated pronouns every time. Do not infer them from a name.
- NEVER state that the player gained or lost an item, took damage, healed, or finished a quest.
  The interface reports all of that. You describe the moment, not the bookkeeping.
- If the player tries something the list above forbids, let the world or the character refuse it
  from inside the fiction, in their own style. Never mention rules, systems, or that you are an AI.
- If the player just talks, that is a complete turn. Nothing has to change.

REPLY FORMAT
Reply with JSON only. No markdown fences, no preamble.
{"reply": "your prose", "effects": []}

Effects — use only these, at most two per turn, only for what the list above permits:
{"move":"north"} {"take":"apple"} {"drop":"apple"} {"give":{"item":"apple","to":"borin"}}
{"open":"north"} {"close":"north"}   — only for exits that are locked
Conversation, looking and examining need no effects. Use an empty array.`;
}

/* Commands the engine can answer by itself. Movement, looking and
   checking your pockets are deterministic — sending them to a model is
   slow, costs tokens, and risks prose that says you moved when you did
   not. Anything with judgement in it still goes to the narrator. */
const SHORT = {
  n: "north", s: "south", e: "east", w: "west",
  u: "up", d: "down", ne: null, nw: null, se: null, sw: null,
  north: "north", south: "south", east: "east", west: "west",
  up: "up", down: "down",
};

function directCommand(state, input) {
  const raw = input.trim().toLowerCase().replace(/[.!?]+$/, "");
  const words = raw.split(/\s+/);
  const room = WORLD.rooms[state.player.room];

  // "north", "n", "go north", "walk to the north", "head up"
  const moveWords = ["go", "walk", "head", "move", "run", "climb", "travel"];
  let dirWord = null;
  if (words.length === 1) dirWord = words[0];
  else if (moveWords.includes(words[0])) dirWord = words[words.length - 1];

  if (dirWord && Object.prototype.hasOwnProperty.call(SHORT, dirWord)) {
    const dir = SHORT[dirWord];
    if (!dir) return { handled: true, entries: [{ kind: "system", text: "Only north, south, east, west, up and down work here." }] };
    if (!exitOf(room, dir)) {
      return { handled: true, entries: [{ kind: "system", text: `There is no way ${dir} from here.` }] };
    }
    return { handled: true, effects: [{ move: dir }] };
  }

  if (raw === "look" || raw === "l" || raw === "look around") {
    // Handled by the caller, which has the art maps. The engine only says
    // that this is a look, not what a look renders.
    return { handled: true, look: true };
  }

  /* Taking and dropping are as deterministic as walking, and just as
     annoying to wait on. Handling them here means "take fleece" works as
     well as "take the golden fleece", instantly and for nothing. */
  const takeMatch = raw.match(/^(?:take|get|grab|pick up|pickup|pick)\s+(.+)$/);
  if (takeMatch) {
    const here = state.roomItems[state.player.room] ?? [];
    if (!here.length) {
      return { handled: true, entries: [{ kind: "system", text: "There is nothing here to pick up." }] };
    }
    const found = matchItems(takeMatch[1].replace(/^up\s+/, ""), here);
    if (!found.length) {
      return { handled: true, entries: [{ kind: "system",
        text: `No ${takeMatch[1]} here. Lying here: ${here.map(itemName).join(", ")}.` }] };
    }
    if (found.length > 1) {
      return { handled: true, entries: [{ kind: "system",
        text: `Which one — ${found.map(itemName).join(", ")}?` }] };
    }
    return { handled: true, effects: [{ take: found[0] }] };
  }

  const dropMatch = raw.match(/^(?:drop|put down|discard)\s+(.+)$/);
  if (dropMatch) {
    const inv = state.player.inventory;
    if (!inv.length) {
      return { handled: true, entries: [{ kind: "system", text: "You are carrying nothing." }] };
    }
    const found = matchItems(dropMatch[1].replace(/^down\s+/, ""), inv);
    if (!found.length) {
      return { handled: true, entries: [{ kind: "system",
        text: `You are not carrying ${dropMatch[1]}.` }] };
    }
    if (found.length > 1) {
      return { handled: true, entries: [{ kind: "system",
        text: `Which one — ${found.map(itemName).join(", ")}?` }] };
    }
    return { handled: true, effects: [{ drop: found[0] }] };
  }

  if (["take", "get", "grab"].includes(raw)) {
    const here = state.roomItems[state.player.room] ?? [];
    return { handled: true, entries: [{ kind: "system",
      text: here.length ? `Take what? ${here.map(itemName).join(", ")}.` : "There is nothing here to pick up." }] };
  }

  const doorMatch = raw.match(/^(open|unlock|close|lock|shut)\s*(.*)$/);
  if (doorMatch) {
    const closing = ["close", "lock", "shut"].includes(doorMatch[1]);
    const rest = doorMatch[2].replace(/^(the|a)\s+/, "").replace(/\b(door|gate|hatch|way|exit)\b/g, "").trim();

    const locked = exitsOf(room).filter((e) => e.locked);
    let dir = SHORT[rest] ?? null;

    // "open the door" is unambiguous when there is only one locked way out.
    if (!dir && locked.length === 1) dir = locked[0].dir;

    if (!dir) {
      return { handled: true, entries: [{ kind: "system", text: locked.length
        ? `Which one? ${locked.map((e) => e.dir).join(", ")}.`
        : "Nothing here is locked." }] };
    }
    return { handled: true, effects: [closing ? { close: dir } : { open: dir }] };
  }

  if (["q", "quest", "quests", "journal"].includes(raw)) {
    const progress = questProgress(state);
    if (!progress.length) {
      return { handled: true, entries: [{ kind: "system", text: "Nothing is asked of you here." }] };
    }
    const entries = progress.map((p) => ({
      kind: "system",
      text: p.done
        ? `${p.quest.name} — done.`
        : `${p.quest.name} — ${p.stages[p.at].goal}  (${p.at + 1} of ${p.stages.length})`,
    }));
    return { handled: true, entries };
  }

  if (["i", "inv", "inventory"].includes(raw)) {
    // Rendered by the caller, which has the pictures.
    return { handled: true, inventory: true };
  }

  return { handled: false };
}

/* exposureOf is here for the weather system to come: given the state it
   returns one of the five tags, so the interface can decide between showing
   rain, only playing it, or ignoring it entirely. */
const exposureOf = (s) => WORLD.rooms?.[s?.player?.room]?.exposure ?? "indoors";

return { WORLD, freshState, reconcile, itemName, mobsInRoom, exitOf, exposureOf, applyEffects, buildPrompt, directCommand };
}

/* ============================================================
   art placeholders
   ============================================================ */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}
function Splash({ seed, ratio = 0.5625, pending, src, style }) {
  const h = hash(seed || "x"), a = h % 360, b = (h >> 3) % 60;
  return (
    <div style={{ position: "relative", width: "100%", paddingTop: `${ratio * 100}%`, overflow: "hidden",
      background: `linear-gradient(${h % 180}deg, hsl(${a} 34% 22%), hsl(${(a + 40 + b) % 360} 30% 34%))`, ...style }}>
      {src && (
        <img src={src} alt="" loading="lazy"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", imageRendering: "pixelated" }} />
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

const seedFriends = [{ id: "u2", name: "Nadia", tag: "NAD-9012" }, { id: "u3", name: "Ilse", tag: "ILS-3388" }];

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

/* One breakpoint, used for the handful of places where a phone needs a
   different layout rather than a narrower one. */
function useNarrow(px = 700) {
  const [narrow, setNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < px : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return narrow;
}

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
  const [games, setGames] = useState([]);
  const [me, setMe] = useState(null);
  const [friends, setFriends] = useState(seedFriends);
  const [chars, setChars] = useState([]);

  const [saves, setSaves] = useState({}); // `${worldId}:${charId}` -> { state, log }

  const go = (name, params = {}) => setView({ name, ...params });
  const refreshWorlds = async () => {
    if (!session) return;
    try { setGames(await loadWorlds(session.user.id)); } catch (e) { console.error(e); }
  };

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

  /* Stripe sends the customer back with ?paid=1. The balance is changed by
     the webhook, not by this redirect, so all we do here is re-read it and
     tidy the URL. There can be a second or two of lag. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("paid")) return;
    const paid = params.get("paid") === "1";
    window.history.replaceState({}, "", window.location.pathname);
    if (!paid || !session) return;
    const t = setTimeout(() => {
      loadMe(session.user.id)
        .then((m) => {
          setMe(m);
          // A first purchase with no username yet: the next thing they need.
          if (!m.username) setView({ name: "username", next: "mine" });
        })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [session]);

  // Pull everything that belongs to this user once we have a session.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const uid = session.user.id;
        const [m, cs, sv, ws] = await Promise.all([
          loadMe(uid), loadCharacters(uid), loadSaves(uid), loadWorlds(uid),
        ]);
        if (cancelled) return;
        setMe(m); setChars(cs); setSaves(sv); setGames(ws); setLoadError(null);
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
      <PlayLoader
        worldId={view.id}
        char={chars.find((c) => c.id === view.charId)}
        save={saves[key]}
        onSave={(v) => {
          setSaves((s) => ({ ...s, [key]: v }));
          writeSave({ userId: me.id, worldId: view.id, characterId: view.charId, ...v })
            .catch((e) => console.error("save failed", e));
        }}
        onExit={() => go("game", { id: view.id })}
        onHome={() => go("mine")}
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
        {view.name === "profile" && <Profile me={me} setMe={setMe} chars={chars} setChars={setChars} go={go} />}
        {view.name === "creator" && <CreatorPage me={me} go={go} />}
        {view.name === "admin" && <AdminPage me={me} go={go} />}
        {view.name === "username" && <UsernamePage me={me} setMe={setMe} go={go} reason={view.reason} next={view.next} />}
        {view.name === "create" && <Create me={me} refreshWorlds={refreshWorlds} go={go} />}
        {view.name === "game" && <GameDetail game={games.find((g) => g.id === view.id)} chars={chars} saves={saves} go={go} from={view.from ?? "browse"} isMine={games.find((g) => g.id === view.id)?.authorId === me.id} />}
        {view.name === "edit" && <EditGame game={games.find((g) => g.id === view.id)} refreshWorlds={refreshWorlds} me={me} setMe={setMe} go={go} />}
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
  const frac = me.balanceCap ? me.balance / me.balanceCap : 0;
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
        <button
          onClick={() => go("creator")}
          title={me.isCreator ? `${money(me.balance)} left \u2014 add more` : "Become a creator"}
          className="pf-btn"
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
            background: "none", border: "none", padding: "4px 2px", cursor: "pointer" }}>
          <span aria-hidden style={{ width: 46, height: 3, background: T.edge, position: "relative", display: "inline-block" }}>
            <span style={{ position: "absolute", inset: 0, width: `${frac * 100}%`, background: frac > 0.2 ? T.ochre : T.clay }} />
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>{money(me.balance)}</span>
        </button>
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
  const [sort, setSort] = useState("played");
  const narrow = useNarrow();

  const ranked = sortWorlds(games, sort);
  const shown = ranked.filter((g) => (g.title + g.author + g.blurb).toLowerCase().includes(q.toLowerCase()));

  // The showcase is the most played world overall, whatever the list below
  // is sorted by. On a phone it costs a whole screen before anyone sees a
  // second title, so it is left out entirely.
  const featured = narrow ? null : sortWorlds(games, "played")[0];
  const rest = featured ? shown.filter((g) => g.id !== featured.id) : shown;

  return (
    <div className="pf-in">
      {featured && (
        <div className="pf-card" onClick={() => go("game", { id: featured.id, from: "browse" })}
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)",
            gap: 24, marginBottom: 34, alignItems: "center" }}>
          <Splash seed={featured.id} src={featured.coverUrl} ratio={0.5625} />
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ochre, marginBottom: 8 }}>most played</div>
            <div className="pf-title" style={{ fontFamily: T.serif, fontSize: 30, lineHeight: 1.15, marginBottom: 8 }}>
              {featured.title}
            </div>
            <p style={{ fontFamily: T.serif, fontSize: 16, lineHeight: 1.55, color: T.boneDim, margin: "0 0 12px" }}>
              {featured.blurb}
            </p>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
              {featured.author} &middot; {featured.rooms} rooms &middot; {featured.plays.toLocaleString()} plays
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort worlds"
          style={{ background: T.ground, color: T.bone, border: `1px solid ${T.edge}`, borderRadius: 2,
            fontFamily: T.serif, fontSize: 17, padding: "6px 8px", cursor: "pointer" }}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>

        <span style={{ flex: 1 }} />

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search worlds"
          style={{ ...inputStyle, width: narrow ? "100%" : 200, fontFamily: T.mono, fontSize: 12, padding: "7px 10px" }} />
      </div>

      <div style={grid}>
        {rest.map((g) => (
          <GameCard key={g.id} g={g} onClick={() => go("game", { id: g.id, from: "browse" })}
            meta={sort === "week" && g.weekPlays ? `${g.weekPlays.toLocaleString()} plays this week` : null} />
        ))}
      </div>
      {!shown.length && <Empty title="Nothing matches that." line="Try a shorter word, or clear the search." />}
    </div>
  );
}


function GameCard({ g, onClick, showStatus, meta }) {
  return (
    <div className="pf-card pf-in" onClick={onClick}>
      <Splash seed={g.id} pending={g.status === "generating"} src={g.coverUrl} />
      <div style={{ padding: "10px 2px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div className="pf-title" style={{ fontFamily: T.serif, fontSize: 18, flex: 1, lineHeight: 1.25 }}>{g.title}</div>
          {showStatus && <Chip status={g.status} />}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 5 }}>
          {g.author} · {meta ?? `${g.plays.toLocaleString()} plays`}
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
        <div style={grid}>{games.map((g) => <GameCard key={g.id} g={g} showStatus onClick={() => go("game", { id: g.id, from: "mine" })} />)}</div>
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
      {theirs.length ? <div style={grid}>{theirs.map((g) => <GameCard key={g.id} g={g} onClick={() => go("game", { id: g.id, from: "friends" })} />)}</div>
        : <Empty title="Nothing yet." line="When a friend publishes a world it turns up here." />}
    </div>
  );
}

function Profile({ me, setMe, chars, setChars, go }) {
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
const EXAMPLE =
  "A lighthouse on a tidal island, cut off for six hours either side of high water. The keeper died last " +
  "month and I've been sent to take over. There's a locked lamp room, a cellar full of somebody else's " +
  "belongings, and a woman from the village who rows out every day and will not say why. She knows what's " +
  "in the cellar. She'll only tell me if I bring her the keeper's logbook, and nothing else will make her talk.";

function ReportBox({ worldId, onDone }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      await reportWorld(worldId, reason, detail);
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 16, marginTop: 16 }}>
        <p style={{ fontFamily: T.serif, fontSize: 15, lineHeight: 1.6, margin: 0, color: T.boneDim }}>
          Thank you. Somebody will look at it. You can keep playing in the meantime.
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 16, marginTop: 16 }}>
      <div style={{ fontFamily: T.serif, fontSize: 16, marginBottom: 10 }}>What is wrong with it?</div>

      <div style={{ display: "grid", gap: 5, marginBottom: 12 }}>
        {REPORT_REASONS.map((r) => (
          <button key={r} className="pf-btn" onClick={() => setReason(r)}
            style={{ textAlign: "left", padding: "7px 10px", borderRadius: 2, cursor: "pointer",
              background: "transparent", fontFamily: T.mono, fontSize: 12,
              color: reason === r ? T.bone : T.boneDim,
              border: "1px solid " + (reason === r ? T.ochre : T.edge) }}>
            {r}
          </button>
        ))}
      </div>

      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={3}
        placeholder="Where in the world is it, if that helps."
        style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical", marginBottom: 12 }} />

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, margin: "0 0 12px" }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="solid" onClick={send} disabled={busy}>{busy ? "\u2026" : "Send"}</Btn>
        <Btn kind="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  );
}

function ReportQueue({ me }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const refresh = () => loadReports().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  const act = async (row, unpublish) => {
    setBusy(row.id);
    try {
      if (unpublish) await unpublishWorld(row.world_id);
      await resolveReport(row.id);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!me.isAdmin) return null;

  return (
    <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 24, marginTop: 28 }}>
      <h2 style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, margin: "0 0 4px" }}>Reports</h2>
      <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 18px" }}>
        Unpublishing hides a world without destroying the creator's work or anyone's playthrough,
        which makes it the right first move in nearly every case.
      </p>

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7 }}>{error}</p>
      )}

      {rows === null ? (
        <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
      ) : rows.length === 0 ? (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.boneDim }}>Nothing waiting.</p>
      ) : (
        rows.map((r) => (
          <div key={r.id} style={{ border: "1px solid " + T.edge, borderRadius: 2,
            padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: T.serif, fontSize: 16, flex: 1 }}>{r.world_title}</span>
              {r.report_count > 1 && (
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.clay }}>
                  {r.report_count} reports
                </span>
              )}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, lineHeight: 1.8, marginBottom: 10 }}>
              <div>{r.reason}</div>
              {r.detail && <div style={{ color: T.bone }}>{r.detail}</div>}
              <div>by @{r.owner_username ?? "unknown"} · {new Date(r.created_at).toLocaleDateString()}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn kind="danger" disabled={busy === r.id} onClick={() => act(r, true)}>
                Unpublish and close
              </Btn>
              <Btn disabled={busy === r.id} onClick={() => act(r, false)}>Leave it, close</Btn>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- admin ---------- */

function AdminPage({ me, go }) {
  const [setting, setSetting] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSetting("generator")
      .then((v) => setSetting({ provider: v.provider ?? "deepseek", model: v.model ?? "" }))
      .catch((e) => setError(e.message));
  }, []);

  const write = async (next) => {
    setSetting(next);
    setError(null);
    try {
      await saveSetting("generator", next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!me.isAdmin) {
    return <Empty title="Not for you." line="This page is for platform administrators." />;
  }

  return (
    <div className="pf-in" style={{ maxWidth: 620 }}>
      <Btn kind="ghost" onClick={() => go("browse")} style={{ marginBottom: 16 }}>back</Btn>

      <H1 sub="Platform settings. These apply to every creator, so a bad choice here is felt by everyone.">
        Admin
      </H1>

      {!setting ? (
        <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
      ) : (
        <>
          <Field
            label="World generator"
            hint="Which model turns a creator's brief into a world. The prompt is identical for all three; only the model changes.">
            <div style={{ display: "grid", gap: 8 }}>
              {PROVIDERS.map((p) => {
                const on = setting.provider === p.key;
                return (
                  <button key={p.key} className="pf-btn"
                    onClick={() => write({ ...setting, provider: p.key })}
                    style={{ textAlign: "left", padding: "12px 14px", borderRadius: 2, cursor: "pointer",
                      background: "transparent",
                      border: "1px solid " + (on ? T.ochre : T.edge) }}>
                    <div style={{ fontFamily: T.serif, fontSize: 17,
                      color: on ? T.bone : T.boneDim, marginBottom: 4 }}>
                      {p.label}{p.key === "deepseek" ? " — default" : ""}
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.6, color: T.boneDim }}>
                      {p.note}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field
            label="Model override"
            hint="Leave empty to use the default for the chosen provider. Set it to pin a specific version, or to try a newer one without a redeploy.">
            <input
              value={setting.model}
              onChange={(e) => setSetting({ ...setting, model: e.target.value })}
              onBlur={(e) => write({ ...setting, model: e.target.value.trim() })}
              placeholder="e.g. claude-sonnet-5"
              style={{ ...inputStyle, fontFamily: T.mono, fontSize: 13 }} />
          </Field>

          <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, lineHeight: 1.7 }}>
            {saved ? "saved" : "\u00a0"}
          </p>

          <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 18, marginTop: 8 }}>
            <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: 0 }}>
              Each provider needs its key set on the project: DEEPSEEK_API_KEY, ANTHROPIC_API_KEY
              or OPENAI_API_KEY. Choosing one without its key fails the next generation with a
              message saying which is missing. The result of every build names the model that made
              it, so the same brief can be run through two and compared.
            </p>
          </div>
        </>
      )}

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7,
          border: "1px solid " + T.clay + "44", padding: 12, borderRadius: 2, marginTop: 18 }}>
          {error}
        </p>
      )}

      <ReportQueue me={me} />
    </div>
  );
}

/* ---------- becoming a creator ---------- */

function CreatorPage({ me, go }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const first = !me.isCreator;

  const buy = async (amount) => {
    setBusy(amount); setError(null);
    try {
      const url = await startCheckout(amount);
      window.location.href = url;
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  };

  return (
    <div className="pf-in" style={{ maxWidth: 620 }}>
      <Btn kind="ghost" onClick={() => go("browse")} style={{ marginBottom: 16 }}>back</Btn>

      <H1 sub={first
        ? "Playing is free and always will be. Making a world costs money because every picture in it costs money to draw, so creators pay for what they use and nothing else."
        : "Add more whenever you run out. It never expires, and there is no subscription."}>
        {first ? "Become a creator" : "Add funds"}
      </H1>

      {first && (
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 18, marginBottom: 26 }}>
          <div style={{ fontFamily: T.serif, fontSize: 17, marginBottom: 10 }}>What $5 gets you</div>
          <div style={{ fontFamily: T.mono, fontSize: 12.5, lineHeight: 2, color: T.boneDim }}>
            <div>Unlimited worlds. Building one is free; only pictures cost.</div>
            <div>A room, character or item on the pixel engine &mdash; {money(PRICE_CENTS.pixel)}</div>
            <div>The same on Flux, and every splash screen &mdash; {money(PRICE_CENTS.flux)}</div>
            <div>Roughly four or five fully illustrated worlds</div>
          </div>
        </div>
      )}

      {!first && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.boneDim, margin: "0 0 22px" }}>
          You have {money(me.balance)} left.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 10, marginBottom: 20 }}>
        {TOPUPS.map((amount) => (
          <button key={amount} className="pf-btn" onClick={() => buy(amount)} disabled={Boolean(busy)}
            style={{ padding: "18px 12px", borderRadius: 2, cursor: busy ? "default" : "pointer",
              background: amount === "5" ? T.ochre : "transparent",
              color: amount === "5" ? "#221D0C" : T.bone,
              border: "1px solid " + (amount === "5" ? T.ochre : T.edge),
              fontFamily: T.serif, fontSize: 22 }}>
            {busy === amount ? "\u2026" : "$" + amount}
          </button>
        ))}
      </div>

      <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, lineHeight: 1.7, margin: "0 0 20px" }}>
        Every amount buys the same thing. The larger ones are only there to save you coming back.
        Payment is handled by Stripe; we never see your card.
      </p>

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7,
          border: "1px solid " + T.clay + "44", padding: 12, borderRadius: 2 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- claiming a name ---------- */

function UsernamePage({ me, setMe, go, reason, next }) {
  const [name, setName] = useState(me.username ?? "");
  const [state, setState] = useState("idle");   // idle | checking | free | taken
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Debounced, because every keystroke would otherwise be a round trip.
  useEffect(() => {
    const value = name.trim().toLowerCase();
    if (!value || value === me.username) { setState("idle"); return; }
    setState("checking");
    const t = setTimeout(async () => {
      try {
        setState((await checkUsername(value)) ? "free" : "taken");
      } catch {
        setState("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [name, me.username]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const claimed = await claimUsername(name.trim().toLowerCase());
      setMe((m) => ({ ...m, username: claimed }));
      go(next ?? "mine");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-in" style={{ maxWidth: 520 }}>
      <H1 sub="Your worlds are published under this name, and it is how people find you. Pick carefully: it cannot be changed later.">
        {me.username ? "Your username" : "Choose a username"}
      </H1>

      {reason === "publish" && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.ochre, lineHeight: 1.7,
          border: "1px solid " + T.ochre + "44", padding: 12, borderRadius: 2, margin: "0 0 22px" }}>
          A world needs a name to be published under. Choose one and we will carry on.
        </p>
      )}

      <Field label="Username" hint="Three to twenty characters. Letters, numbers and hyphens.">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.mono, fontSize: 16, color: T.boneDim }}>@</span>
          <input
            value={name}
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && state === "free" && save()}
            placeholder="wei"
            style={{ ...inputStyle, fontFamily: T.mono, fontSize: 16, letterSpacing: ".02em" }} />
        </div>
      </Field>

      <div style={{ fontFamily: T.mono, fontSize: 11.5, minHeight: 18, marginBottom: 18,
        color: state === "taken" ? T.clay : state === "free" ? T.moss : T.boneDim }}>
        {state === "checking" ? "checking"
          : state === "free" ? "@" + name.trim().toLowerCase() + " is available"
          : state === "taken" ? "That one is taken or reserved"
          : ""}
      </div>

      {error && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7, margin: "0 0 16px" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="solid" disabled={state !== "free" || busy} onClick={save}>
          {busy ? "\u2026" : "Claim it"}
        </Btn>
        {me.username && <Btn onClick={() => go("profile")}>Back</Btn>}
      </div>
    </div>
  );
}

function Create({ me, refreshWorlds, go }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [phase, setPhase] = useState("idle");   // idle | building | review | failed
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [worldId, setWorldId] = useState(null);
  const [size, setSize] = useState("auto");
  const [needsFunds, setNeedsFunds] = useState(false);

  const build = async () => {
    setPhase("building"); setStep(3); setError(null);
    try {
      const choice = ROOM_CHOICES.find((c) => c.key === size) ?? ROOM_CHOICES[0];
      const id = worldId ?? await createWorld({
        userId: me.id,
        title: title.trim() || "Untitled world",
        brief: desc.trim(),
        roomMin: choice.min,
        roomMax: choice.max,
      });
      setWorldId(id);
      const res = await generateWorld(id);
      setResult(res);
      setPhase("review");
      refreshWorlds();
    } catch (e) {
      setError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
      setPhase("failed");
      refreshWorlds();
    }
  };

  const finish = async (published) => {
    if (published && worldId) {
      try {
        await setPublished(worldId, true);
      } catch (e) {
        if (e.needsUsername) {
          await refreshWorlds();
          go("username", { reason: "publish", next: "mine" });
          return;
        }
        console.error(e);
      }
    }
    await refreshWorlds();
    go("mine");
  };

  const steps = ["Describe it", "Check it over", "What got built"];

  return (
    <div className="pf-in" style={{ maxWidth: 660 }}>
      <H1>Create a game</H1>
      <div style={{ display: "flex", gap: 18, marginBottom: 28, flexWrap: "wrap" }}>
        {steps.map((label, i) => (
          <div key={label} style={{ fontFamily: T.mono, fontSize: 11.5,
            color: step === i + 1 ? T.ochre : step > i + 1 ? T.boneDim : T.edge }}>
            {step > i + 1 ? "\u2713 " : (i + 1) + ". "}{label}
          </div>
        ))}
      </div>

      {step === 1 && (<>
        <Field label="Title">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Lamp Room" />
        </Field>
        <Field label="Describe the world"
          hint="Places, who is in them, what they want, and above all what cannot be talked around. The rules you write here are the ones the game will enforce.">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={10}
            placeholder="Somewhere real enough to walk around in"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </Field>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
          <Btn kind="ghost" onClick={() => { setDesc(EXAMPLE); setTitle("The Lamp Room"); }}>use an example</Btn>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
            {desc.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </div>
        <Field label="How big" hint="Rooms are what a world costs, to build and to illustrate. You can leave this to the brief.">
          <div style={{ display: "grid", gap: 8 }}>
            {ROOM_CHOICES.map((c) => {
              const on = size === c.key;
              return (
                <button key={c.key} className="pf-btn" onClick={() => setSize(c.key)}
                  style={{ textAlign: "left", padding: "11px 13px", borderRadius: 2, cursor: "pointer",
                    background: "transparent", border: "1px solid " + (on ? T.ochre : T.edge) }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: T.serif, fontSize: 16, flex: 1,
                      color: on ? T.bone : T.boneDim }}>{c.label}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
                      {c.min ? `${money(genCost(c.min))}\u2013${money(genCost(c.max))}` : "from " + money(genCost(4))}
                    </span>
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 3, lineHeight: 1.5 }}>
                    {c.note}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        <Btn kind="solid" disabled={desc.trim().length < 40 || !title.trim()} onClick={() => setStep(2)}>Continue</Btn>
      </>)}

      {step === 2 && (<>
        <p style={{ fontFamily: T.serif, fontSize: 16, lineHeight: 1.6, color: T.boneDim, marginTop: 0 }}>
          Building takes a minute or two. Anything your brief says cannot be talked around becomes a
          rule the game enforces, so it is worth saying it plainly.
        </p>
        <p style={{ fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.7, color: T.boneDim, margin: "0 0 20px" }}>
          {money(GEN_BASE_CENTS)} plus {money(GEN_PER_ROOM_CENTS)} a room, charged only if it builds.
          Pictures are separate and optional. You have {money(me.balance)}.
        </p>
        <div style={{ border: "1px solid " + T.edge, padding: 18, borderRadius: 2, marginBottom: 24 }}>
          <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 8 }}>{title || "Untitled world"}</div>
          <p style={{ fontFamily: T.serif, fontSize: 15, lineHeight: 1.6, color: T.boneDim, margin: 0, whiteSpace: "pre-wrap" }}>{desc}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={() => setStep(1)}>Back</Btn>
          <Btn kind="solid" onClick={build}>Build the world</Btn>
        </div>
      </>)}

      {step === 3 && phase === "building" && <Building />}

      {step === 3 && phase === "failed" && (<>
        <div style={{ border: "1px solid " + T.clay + "55", padding: 18, borderRadius: 2, marginBottom: 22 }}>
          <div style={{ fontFamily: T.serif, fontSize: 18, marginBottom: 8 }}>It did not come together</div>
          <p style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.7, color: T.clay, margin: 0 }}>{error}</p>
        </div>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, marginTop: 0 }}>
          Usually this means the brief asks for something the world cannot hold: a character who gives
          you information rather than an object, or a thing with no way to reach it. Try again, or go
          back and make the gate concrete.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {needsFunds
            ? <Btn kind="solid" onClick={() => go("creator")}>Add funds</Btn>
            : <Btn kind="solid" onClick={build}>Try again</Btn>}
          <Btn onClick={() => { setPhase("idle"); setStep(1); }}>Edit the brief</Btn>
        </div>
      </>)}

      {step === 3 && phase === "review" && result && (<>
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, marginBottom: 24 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid " + T.edge, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: T.serif, fontSize: 17, flex: 1 }}>{result.title}</span>
            {/* Which model built it is an operational detail, not something
                a creator needs. Admins see it because they chose it. */}
            {me.isAdmin && result.built_by && (
              <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.boneDim }}>{result.built_by}</span>
            )}
            <Chip status="ready" />
          </div>
          <div style={{ padding: "14px 18px", fontFamily: T.mono, fontSize: 12.5, lineHeight: 2, color: T.boneDim }}>
            <div>{result.stats.rooms} rooms, every exit leads somewhere and comes back</div>
            <div>{result.stats.mobs} characters, all placed in rooms that exist</div>
            <div>{result.stats.quests} quests, {result.stats.items} items, all of them reachable</div>
            {typeof result.cost_cents === "number" && (
              <div>Cost {money(result.cost_cents)}{typeof result.balance_cents === "number"
                ? ` \u00b7 ${money(result.balance_cents)} left` : ""}</div>
            )}
            {(result.warnings || []).map((w, i) => (
              <div key={i} style={{ color: T.clay }}>{w.message || String(w)}</div>
            ))}
          </div>
        </div>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, marginTop: 0 }}>
          Publishing puts it in Browse for everyone. A draft stays yours alone, and you can publish
          later from its settings.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn kind="solid" onClick={() => finish(true)}>Publish</Btn>
          <Btn onClick={() => finish(false)}>Keep as draft</Btn>
        </div>
      </>)}
    </div>
  );
}

function Building() {
  /* This used to tick through a list of named steps, which read as progress
     and was not: the model is working the whole time and nothing reports
     back until it finishes. A world that failed at the end looked like it
     had failed at whichever line the timer had reached, which sent us
     looking in the wrong place. An elapsed clock is honest. */
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div style={{ border: "1px solid " + T.edge, padding: "34px 22px", borderRadius: 2 }}>
      <div style={{ fontFamily: T.serif, fontSize: 19, marginBottom: 8 }}>
        Building the world
      </div>
      <p style={{ fontFamily: T.serif, fontSize: 15.5, color: T.boneDim, lineHeight: 1.6, margin: "0 0 16px" }}>
        Rooms and exits, characters and what they carry, then a check that every door leads
        somewhere and everything you need can be reached. If it does not hold together it goes
        back to be fixed, which is why this sometimes takes two passes.
      </p>
      <div style={{ fontFamily: T.mono, fontSize: 12, color: secs > 120 ? T.clay : T.ochre }}>
        {clock}{secs > 120 ? " — longer than usual" : ""}
      </div>
    </div>
  );
}

/* ---------- game detail ---------- */
function GameDetail({ game, chars, saves, go, from = "browse", isMine }) {
  const [picked, setPicked] = useState(chars[0]?.id ?? null);
  const [reporting, setReporting] = useState(false);
  const narrow = useNarrow();
  if (!game) return <Empty title="That world is gone." line="It may have been unpublished by its author." />;
  const save = saves[`${game.id}:${picked}`];

  return (
    <div className="pf-in">
      <Btn kind="ghost" onClick={() => go(from)} style={{ marginBottom: 14 }}>back</Btn>

      {/* the splash screen leads, full width, before anything is said about it */}
      <Splash seed={game.id} src={game.coverUrl} ratio={0.5625} style={{ marginBottom: 26 }} />

      <div style={{ display: "grid", gap: narrow ? 26 : 34, alignItems: "start",
        gridTemplateColumns: narrow ? "1fr" : "minmax(0, 1.5fr) minmax(240px, 1fr)" }}>

        <div>
          <h1 style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 400, margin: "0 0 8px", lineHeight: 1.15 }}>
            {game.title}
          </h1>
          <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, marginBottom: 16 }}>
            {game.author} &middot; {game.tag} &middot; {game.rooms} rooms &middot; {game.mobs} characters
            &middot; {game.plays.toLocaleString()} plays
          </div>
          <p style={{ fontFamily: T.serif, fontSize: 17, lineHeight: 1.62, margin: 0 }}>{game.blurb}</p>
        </div>

        <div>
          <div style={{ fontFamily: T.serif, fontSize: 15, marginBottom: 8 }}>Play as</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {chars.map((c) => (
              <button key={c.id} onClick={() => setPicked(c.id)} className="pf-btn"
                style={{ fontFamily: T.mono, fontSize: 12, padding: "8px 13px", cursor: "pointer", borderRadius: 2,
                  background: "transparent", color: picked === c.id ? T.bone : T.boneDim,
                  border: "1px solid " + (picked === c.id ? T.ochre : T.edge) }}>
                {c.name}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 20, minHeight: 16 }}>
            {save ? `turn ${save.state.turn} \u2014 picks up where they left off`
              : picked ? "new game"
              : "make a character on your profile first"}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn kind="solid" disabled={!picked || !game.playable}
              onClick={() => { bumpPlays(game.id); go("play", { id: game.id, charId: picked }); }}>
              {save ? "Continue" : "Start"}
            </Btn>
            {isMine && <Btn onClick={() => go("edit", { id: game.id })}>Edit</Btn>}
            {!isMine && (
              <Btn kind="ghost" onClick={() => setReporting((v) => !v)}>
                {reporting ? "cancel" : "report"}
              </Btn>
            )}
          </div>

          {!game.playable && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.clay, marginTop: 12, lineHeight: 1.6 }}>
              {game.status === "generating" ? "Still being built. Check back in a minute."
                : game.status === "failed" ? (game.failureNote || "This world failed to build.")
                : "This world isn't finished yet."}
            </div>
          )}
          {reporting && <ReportBox worldId={game.id} onDone={() => setReporting(false)} />}

          {isMine && !game.published && game.playable && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 12, lineHeight: 1.6 }}>
              A draft. Only you can see this until you publish it from Edit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- edit ---------- */
function EditGame({ game, refreshWorlds, me, setMe, go }) {
  const [tab, setTab] = useState("art");
  const [art, setArt] = useState(null);

  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    loadArt(game.id)
      .then((rs) => { if (!cancelled) setArt(rs); })
      .catch(() => { if (!cancelled) setArt([]); });
    return () => { cancelled = true; };
  }, [game?.id]);

  if (!game) return <Empty title="Not found." line="This world may have been deleted." />;

  return (
    <div className="pf-in">
      <Btn kind="ghost" onClick={() => go("game", { id: game.id, from: "mine" })}
        style={{ marginBottom: 14 }}>back</Btn>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: T.serif, fontSize: 28, fontWeight: 400, margin: 0 }}>{game.title}</h1>
        <Chip status={game.status} />
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.boneDim, marginBottom: 22 }}>
        {game.rooms} rooms &middot; {game.mobs} characters &middot; {game.plays.toLocaleString()} plays
      </div>

      {game.status === "failed" && game.failureNote && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7,
          border: "1px solid " + T.clay + "44", padding: 14, borderRadius: 2, marginBottom: 22 }}>
          {game.failureNote}
        </p>
      )}

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + T.edge, marginBottom: 24 }}>
        {[["art", "Pictures"], ["world", "World"], ["settings", "Settings"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pf-btn"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 14px", fontFamily: T.mono, fontSize: 12,
              color: tab === k ? T.bone : T.boneDim, boxShadow: tab === k ? "inset 0 -2px 0 " + T.ochre : "none" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "art" && (
        art === null
          ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
          : art.length
            ? <ArtTab entries={art} setEntries={setArt} me={me} setMe={setMe} worldId={game.id} />
            : <Empty title="Nothing to draw yet." line="Pictures appear once the world has been built." />
      )}

      {tab === "world" && (
        game.status === "ready"
          ? <WorldTab game={game} refreshWorlds={refreshWorlds} me={me} setMe={setMe} go={go} />
          : <Empty title="Nothing to change yet." line="This world has not finished building." />
      )}

      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <Field label="Published" hint="Unpublishing hides it from Browse. People mid-playthrough keep their saves.">
            <Btn disabled={game.status !== "ready"} onClick={async () => {
              try {
                await setPublished(game.id, !game.published);
                await refreshWorlds();
              } catch (e) {
                // The database refuses to publish anonymously. Send them to
                // claim a name and come straight back here.
                if (e.needsUsername) go("username", { reason: "publish", next: "mine" });
                else console.error(e);
              }
            }}>
              {game.published ? "Unpublish" : "Publish"}
            </Btn>
          </Field>
          <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 20, marginTop: 20 }}>
            <Btn kind="danger" onClick={async () => {
              try { await deleteWorld(game.id); await refreshWorlds(); go("mine"); }
              catch (e) { console.error(e); }
            }}>
              Delete this world
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

const KINDS = [
  { key: "cover", label: "Splash", ratio: 0.5625 },
  { key: "room",  label: "Rooms", ratio: 0.5625 },
  { key: "mob",   label: "Characters", ratio: 1.33 },
  { key: "item",  label: "Items", ratio: 1 },
];

// Items and splash screens are always flux: the LoRA is trained heavily on
// sprite sheets and fights a single object, and a titled splash needs type
// the model can actually render.
const ENGINE_LOCKED = { item: "flux", cover: "flux" };

const KIND_LABEL = { cover: "the splash screen", room: "rooms", mob: "characters", item: "items" };

const AMEND_KINDS = [
  {
    key: "plot",
    label: "Change what happens",
    note: "Keeps the map and every room picture. Rewrites characters, items, trades and the quest chain around your instruction. Character and item pictures may be orphaned if something gets replaced, and playthroughs in progress are cleared.",
  },
  {
    key: "prose",
    label: "Change the words",
    note: "Keeps everything as it is and rewrites descriptions and character voices. Nothing structural moves, so pictures and saves are untouched.",
  },
];

function WorldTab({ game, refreshWorlds, me, setMe, go }) {
  const [names, setNames] = useState(null);
  const [kind, setKind] = useState("plot");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [needsFunds, setNeedsFunds] = useState(false);

  useEffect(() => {
    loadNameables(game.id).then(setNames).catch(() => setNames([]));
  }, [game.id]);

  const cost = kind === "prose" ? GEN_BASE_CENTS : genCost(game.rooms || 8);

  /* Saving on blur alone is invisible: no button, no confirmation, and from
     the creator's side it looks as though nothing happened. Enter also
     commits, and each row reports its own result. */
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState(null);
  const [rowError, setRowError] = useState(null);

  const rowId = (entry) => `${entry.kind}:${entry.key}`;

  const rename = async (entry, value) => {
    const next = String(value ?? "").trim();
    if (!next || next === entry.name) return;

    setSaving(rowId(entry));
    setRowError(null);
    try {
      const clean = await renameEntity(game.id, entry.kind, entry.key, next);
      setNames((ns) => ns.map((n) =>
        n.kind === entry.kind && n.key === entry.key ? { ...n, name: clean } : n));
      setSaved(rowId(entry));
      setTimeout(() => setSaved((cur) => (cur === rowId(entry) ? null : cur)), 1800);
    } catch (e) {
      setRowError({ id: rowId(entry), message: e.message });
    } finally {
      setSaving(null);
    }
  };

  const amend = async () => {
    setBusy(true); setError(null); setResult(null); setNeedsFunds(false);
    try {
      const res = await amendWorld(game.id, kind, note.trim());
      setResult(res);
      setNote("");
      if (typeof res.balance_cents === "number") setMe((m) => ({ ...m, balance: res.balance_cents }));
      await refreshWorlds();
      loadNameables(game.id).then(setNames).catch(() => {});
    } catch (e) {
      setError(e.message);
      setNeedsFunds(Boolean(e.needsFunds));
    } finally {
      setBusy(false);
    }
  };

  const group = (k) => (names ?? []).filter((n) => n.kind === k);

  return (
    <div style={{ maxWidth: 620 }}>
      {/* ---- ask for a change ---- */}
      <h2 style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, margin: "0 0 4px" }}>
        Ask for a change
      </h2>
      <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 18px" }}>
        Say what you want different in plain words. Put a magician in the tower, give the innkeeper
        something she is hiding, make the ending harder to reach.
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
        {AMEND_KINDS.map((k) => {
          const on = kind === k.key;
          return (
            <button key={k.key} className="pf-btn" onClick={() => setKind(k.key)}
              style={{ textAlign: "left", padding: "12px 14px", borderRadius: 2, cursor: "pointer",
                background: "transparent", border: "1px solid " + (on ? T.ochre : T.edge) }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: T.serif, fontSize: 16, flex: 1, color: on ? T.bone : T.boneDim }}>
                  {k.label}
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
                  {money(k.key === "prose" ? GEN_BASE_CENTS : genCost(game.rooms || 8))}
                </span>
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 4, lineHeight: 1.6 }}>
                {k.note}
              </div>
            </button>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={5}
        placeholder="Put a magician in the tower. He carries a sealed letter the innkeeper wants, and will not part with it until someone brings him water from the well."
        style={{ ...inputStyle, lineHeight: 1.6, resize: "vertical", marginBottom: 14 }} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 22 }}>
        <Btn kind="solid" disabled={busy || note.trim().length < 8 || me.balance < cost} onClick={amend}>
          {busy ? "working\u2026" : `Rebuild \u00b7 ${money(cost)}`}
        </Btn>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>
          {me.balance < cost ? "Not enough left." : `${money(me.balance)} left`}
        </span>
      </div>

      {busy && (
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 20px" }}>
          Rewriting and checking it holds together. A minute or so. If the result does not validate
          nothing is changed and nothing is charged.
        </p>
      )}

      {result && (
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: "12px 16px", marginBottom: 22,
          fontFamily: T.mono, fontSize: 12, lineHeight: 1.9, color: T.boneDim }}>
          <div style={{ color: T.moss }}>Rebuilt. {result.stats.rooms} rooms, {result.stats.mobs} characters,
            {" "}{result.stats.items} items, {result.stats.quests} quests.</div>
          {result.saves_cleared && <div>Playthroughs in progress were cleared.</div>}
          {(result.warnings ?? []).map((w, i) => (
            <div key={i} style={{ color: T.clay }}>{w.message ?? String(w)}</div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ border: "1px solid " + T.clay + "44", borderRadius: 2, padding: 12, marginBottom: 22 }}>
          <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7, margin: 0 }}>{error}</p>
          {needsFunds && (
            <Btn kind="solid" onClick={() => go("creator")} style={{ marginTop: 12 }}>Add funds</Btn>
          )}
        </div>
      )}

      {/* ---- renames ---- */}
      <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 22 }}>
        <h2 style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, margin: "0 0 4px" }}>Names</h2>
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 18px" }}>
          Renaming is free and immediate. Press Enter or click away to save. It changes nothing
          else, so pictures and playthroughs are unaffected — but a character's written voice will
          still describe the old name, so use <em>Change the words</em> above if that matters.
        </p>

        {names === null ? (
          <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        ) : (
          [["mob", "Characters"], ["room", "Rooms"], ["item", "Items"]].map(([k, label]) =>
            group(k).length ? (
              <div key={k} style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginBottom: 8 }}>{label}</div>
                {group(k).map((entry) => {
                  const id = rowId(entry);
                  return (
                    <div key={id} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          defaultValue={entry.name}
                          onBlur={(e) => rename(entry, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          style={{ ...inputStyle, fontSize: 14, padding: "7px 10px" }} />
                        <span style={{ fontFamily: T.mono, fontSize: 10.5, width: 96, flexShrink: 0,
                          color: saved === id ? T.moss : T.edge,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {saving === id ? "saving" : saved === id ? "saved" : entry.key}
                        </span>
                      </div>
                      {rowError?.id === id && (
                        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.clay, marginTop: 4 }}>
                          {rowError.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null)
        )}
      </div>
    </div>
  );
}

function ArtTab({ entries, setEntries, me, setMe, worldId }) {
  const [kind, setKind] = useState("room");
  const [config, setConfig] = useState(null);
  const [showStyle, setShowStyle] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drawing, setDrawing] = useState(null);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // artId whose prompt is open

  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    loadArtConfig(worldId)
      .then((c) => { if (!cancelled) setConfig(c); })
      .catch(() => { if (!cancelled) setConfig({ ...DEFAULT_ART }); });
    return () => { cancelled = true; };
  }, [worldId]);

  const writeConfig = async (next) => {
    setConfig(next);
    try {
      await saveArtConfig(worldId, next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) { console.error(e); }
  };

  const engine = ENGINE_LOCKED[kind] ?? (config?.[`engine_${kind}`] ?? "pixel");
  const COST = PRICE_CENTS[engine] ?? 5;      // cents
  const styleKey = engine === "flux" ? "style_flux" : "style_pixel";
  const shown = entries.filter((e) => e.kind === kind);
  const ratio = KINDS.find((k) => k.key === kind)?.ratio ?? 1;
  const missing = shown.filter((e) => !e.art && !e.locked);
  const affordable = Math.floor(me.balance / COST);

  const draw = async (entry) => {
    if (entry.locked || drawing) return;
    setDrawing(entry.id);
    setError(null);
    try {
      const { url, balance_cents } = await drawArt(entry.id);
      setEntries((es) => es.map((e) => e.id === entry.id ? { ...e, url, art: true } : e));
      if (typeof balance_cents === "number") setMe((m) => ({ ...m, balance: balance_cents }));
    } catch (e) {
      setError(e.message);
      if (typeof e.balanceCents === "number") setMe((m) => ({ ...m, balance: e.balanceCents }));
      setQueue([]);          // stop the run rather than repeat the same failure
    } finally {
      setDrawing(null);
    }
  };

  // Serial on purpose: the provider is slower under parallel load, and one
  // failure should stop the run rather than spend money on five more.
  useEffect(() => {
    if (drawing || !queue.length) return;
    const [next, ...rest] = queue;
    const entry = entries.find((e) => e.id === next);
    setQueue(rest);
    if (entry && !entry.art && !entry.locked) draw(entry);
  }, [queue, drawing]);

  const savePrompt = async (entry, prompt) => {
    setEntries((es) => es.map((e) => e.id === entry.id ? { ...e, prompt } : e));
    try { await setArtPrompt(entry.id, prompt); } catch (e) { console.error(e); }
  };

  const toggleLock = async (entry) => {
    setEntries((es) => es.map((e) => e.id === entry.id ? { ...e, locked: !e.locked } : e));
    try { await setArtLock(entry.id, !entry.locked); } catch (e) { console.error(e); }
  };

  const busy = Boolean(drawing) || queue.length > 0;
  const batch = Math.min(missing.length, affordable);

  return (<>
    <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
      {KINDS.map((k) => {
        const n = entries.filter((e) => e.kind === k.key).length;
        const done = entries.filter((e) => e.kind === k.key && e.art).length;
        if (!n) return null;
        return (
          <button key={k.key} onClick={() => setKind(k.key)} className="pf-btn"
            style={{ background: "transparent", cursor: "pointer", padding: "7px 12px", borderRadius: 2,
              fontFamily: T.mono, fontSize: 12,
              color: kind === k.key ? T.bone : T.boneDim,
              border: "1px solid " + (kind === k.key ? T.ochre : T.edge) }}>
            {k.label}{k.key === "cover" ? (done ? " ✓" : "") : ` ${done}/${n}`}
          </button>
        );
      })}
    </div>

    <div style={{ border: `1px solid ${T.edge}`, borderRadius: 2, marginBottom: 18 }}>
      <button className="pf-btn" onClick={() => setShowStyle((v) => !v)}
        style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
          padding: "11px 14px", fontFamily: T.mono, fontSize: 11.5, color: T.boneDim,
          display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1 }}>{showStyle ? "hide" : "show"} art direction</span>
        {saved && <span style={{ color: T.moss }}>saved</span>}
      </button>

      {showStyle && config && (
        <div style={{ padding: "0 14px 16px" }}>
          <p style={{ fontFamily: T.serif, fontSize: 14.5, color: T.boneDim, lineHeight: 1.6, margin: "0 0 16px" }}>
            Every picture is drawn from three pieces joined together: the art style, the framing for
            its kind, and the description of the thing itself. The two boxes at the bottom say what
            to avoid. Changes save when you click away and apply to the next draw, not to pictures
            already made.
          </p>

          <Field
            label={`Engine for ${KIND_LABEL[kind] ?? kind}`}
            hint={ENGINE_LOCKED[kind]
              ? (kind === "item"
                  ? "Items always use Flux. The pixel LoRA is trained heavily on sprite sheets and fights a single object."
                  : "Splash screens always use Flux, because the title has to be readable.")
              : ENGINES.find((x) => x.key === engine)?.note}>
            <div style={{ display: "flex", gap: 6 }}>
              {ENGINES.map((x) => {
                const locked = Boolean(ENGINE_LOCKED[kind]);
                const on = engine === x.key;
                return (
                  <button key={x.key} className="pf-btn"
                    disabled={locked}
                    onClick={() => writeConfig({ ...config, [`engine_${kind}`]: x.key })}
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 2, fontFamily: T.mono, fontSize: 12,
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked && !on ? 0.35 : 1,
                      background: "transparent",
                      color: on ? T.bone : T.boneDim,
                      border: `1px solid ${on ? T.ochre : T.edge}` }}>
                    {x.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field
            label="Art style"
            hint={engine === "flux"
              ? "Flux follows written direction closely, so be specific and imperative. Colour limits and dithering instructions work well here."
              : "Shared by every picture drawn with the pixel LoRA. The look, not the subject."}>
            <textarea
              defaultValue={config[styleKey] ?? ""}
              rows={4}
              key={styleKey}
              onBlur={(e) => writeConfig({ ...config, [styleKey]: e.target.value })}
              style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
          </Field>

          {kind === "cover" ? (
            <p style={{ fontFamily: T.serif, fontSize: 14.5, color: T.boneDim, lineHeight: 1.6, margin: "0 0 18px" }}>
              The splash screen is framed for you as <em>splash screen of a game with the title
              '{"{title}"}' by '{"{your name}"}'</em>, followed by the description below. Rename the
              world and the next draw follows.
            </p>
          ) : (
          <Field
            label={`Framing for ${KIND_LABEL[kind] ?? kind}`}
            hint="How this kind is composed. Rooms are wide views, characters are portraits, items are single objects.">
            <textarea
              defaultValue={config[kind] ?? ""}
              rows={3}
              key={kind}
              onBlur={(e) => writeConfig({ ...config, [kind]: e.target.value })}
              style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
          </Field>
          )}

          {engine === "pixel" && (
          <div style={{ borderTop: `1px solid ${T.edge}`, paddingTop: 16, marginTop: 4 }}>
            <Field label="Avoid, everywhere"
              hint="Sent as the negative prompt on every picture in this world.">
              <textarea
                defaultValue={config.neg ?? ""}
                rows={2}
                onBlur={(e) => writeConfig({ ...config, neg: e.target.value })}
                style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
            </Field>

            <Field
              label={`Avoid, ${(KIND_LABEL[kind] ?? kind).toLowerCase()} only`}
              hint={kind === "item"
                ? "Items go wrong in one particular way: the model draws a sheet of sprites or an inventory screen instead of the object. Most of this list is there to stop that."
                : "Added to the list above when drawing this kind."}>
              <textarea
                defaultValue={config[`neg_${kind}`] ?? ""}
                rows={3}
                key={`neg_${kind}`}
                onBlur={(e) => writeConfig({ ...config, [`neg_${kind}`]: e.target.value })}
                style={{ ...inputStyle, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
            </Field>
          </div>
          )}

          <Btn kind="ghost"
            onClick={() => writeConfig({
              ...config,
              [styleKey]: DEFAULT_ART[styleKey],
              [kind]: DEFAULT_ART[kind],
              ...(engine === "pixel"
                ? { neg: DEFAULT_ART.neg, [`neg_${kind}`]: DEFAULT_ART[`neg_${kind}`] }
                : {}),
            })}>
            reset to defaults
          </Btn>
        </div>
      )}
    </div>

    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
      <p style={{ fontFamily: T.serif, fontSize: 15.5, color: T.boneDim, lineHeight: 1.55, margin: 0, flex: 1, minWidth: 240 }}>
        Lock one once you are happy with it. Locked pictures are skipped by redraws, including bulk ones.
      </p>
      {missing.length > 0 && (
        <Btn onClick={() => { setError(null); setQueue(missing.slice(0, affordable).map((e) => e.id)); }}
          disabled={busy || batch < 1}>
          {busy
            ? "drawing" + (queue.length ? " \u00b7 " + queue.length + " left" : "")
            : "Draw " + batch + " missing \u00b7 " + money(batch * COST)}
        </Btn>
      )}
    </div>

    {affordable < 1 && (
      <p style={{ fontFamily: T.mono, fontSize: 11, color: T.clay, margin: "0 0 14px" }}>
        Not enough left to draw anything. One picture here costs {money(COST)}.
      </p>
    )}
    {error && (
      <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, lineHeight: 1.7,
        border: "1px solid " + T.clay + "44", padding: 12, borderRadius: 2, margin: "0 0 16px" }}>
        {error}
      </p>
    )}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 18 }}>
      {shown.map((e) => (
        <div key={e.id}>
          <div style={{ position: "relative" }}>
            <Splash seed={e.key} src={e.url} pending={drawing === e.id} ratio={ratio} />
            <button onClick={() => toggleLock(e)}
              title={e.locked ? "Unlock to allow redraws" : "Lock to protect from redraws"} className="pf-btn"
              style={{ position: "absolute", top: 7, right: 7, width: 27, height: 27, borderRadius: 2, cursor: "pointer",
                background: e.locked ? T.ochre : "rgba(20,22,17,.72)", border: "1px solid " + (e.locked ? T.ochre : T.edge),
                color: e.locked ? "#221D0C" : T.bone, fontSize: 12, lineHeight: 1 }}>
              {e.locked ? "\ud83d\udd12" : "\ud83d\udd13"}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <span style={{ fontFamily: T.serif, fontSize: 15.5, flex: 1, minWidth: 0 }}>{e.name}</span>
            <button onClick={() => draw(e)} disabled={e.locked || busy || me.balance < COST} className="pf-btn"
              style={{ background: "none", border: "none", padding: 0, fontFamily: T.mono, fontSize: 11,
                color: e.locked ? T.edge : T.boneDim, cursor: (e.locked || busy) ? "not-allowed" : "pointer" }}>
              {drawing === e.id ? "drawing" : (e.art ? "redraw \u00b7 " : "draw \u00b7 ") + money(COST)}
            </button>
          </div>

          <button onClick={() => setEditing(editing === e.id ? null : e.id)} className="pf-btn"
            style={{ background: "none", border: "none", padding: "2px 0 0", fontFamily: T.mono, fontSize: 10.5,
              color: T.edge, cursor: "pointer" }}>
            {editing === e.id ? "hide prompt" : "edit prompt"}
          </button>

          {editing === e.id && (
            <textarea
              defaultValue={e.prompt}
              rows={4}
              onBlur={(ev) => savePrompt(e, ev.target.value)}
              placeholder="What the picture should show"
              style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.5, marginTop: 6, resize: "vertical" }} />
          )}
        </div>
      ))}
    </div>
  </>);
}


/* Item and room names arrive lowercase from the world data ("waxy lemon"),
   because that is how they read inside a sentence. In the chrome they are
   labels, so they get capitals. */
const titleCase = (str) =>
  String(str ?? "").replace(/\b([a-z])/g, (m) => m.toUpperCase());

const DIR_LETTER = { north: "N", south: "S", east: "E", west: "W", up: "U", down: "D" };

/* Small line icons, drawn rather than imported: the set is tiny, they need to
   inherit colour from their button, and a dependency for six glyphs is not
   worth the weight. */
function Glyph({ name }) {
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
const VERBS = [
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
const keepFocus = {
  onMouseDown: (e) => e.preventDefault(),
  onTouchStart: (e) => e.preventDefault(),
};

/* The few things that must be allowed to take focus for themselves. Anything
   else tapped inside the play surface leaves focus where it was, so the
   keyboard does not drop when a player touches the room picture or the gap
   between two buttons. */
function wantsFocus(el) {
  return Boolean(el?.closest?.("input, textarea, select, option, [contenteditable=true]"));
}

function EyeIcon({ open }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      {!open && <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

function PinIcon({ pinned }) {
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
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

function useVisualViewport() {
  const [box, setBox] = useState(null);
  /* The tallest the viewport has ever been is the no-keyboard baseline.
     Comparing against window.innerHeight does not work: the viewport meta
     asks for interactive-widget=resizes-content, which shrinks both
     together and leaves nothing to measure. */
  const tallest = useRef(0);
  const lastWidth = useRef(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      // A rotation changes what "full height" means, so the baseline resets.
      if (vv.width !== lastWidth.current) {
        lastWidth.current = vv.width;
        tallest.current = 0;
      }
      if (vv.height > tallest.current) tallest.current = vv.height;

      setBox({
        height: vv.height,
        top: vv.offsetTop,
        // Something is covering part of the screen: a keyboard, usually.
        shrunk: vv.height < tallest.current - 100,
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return box;
}

/* Narration read aloud, using the browser's own speech synthesis. No key,
   no cost, no network. Quality is whatever voices the operating system
   ships, which on desktop is decent and on mobile varies.

   Two details borrowed from any terminal that does this well: cancel before
   every utterance so a fast typist does not build a backlog three turns
   deep, and stop everything on unmount so leaving a game does not leave a
   voice talking over the catalog. */
/* What gets read aloud. Narration, character presence and ambient lines are
   prose. The ruled engine lines — "Taken: brass key", "−3 health" — are
   already visually separate precisely because they are not part of the
   story, and hearing them read out is grating. */
const SPOKEN = new Set(["narration", "room", "room-under-art", "presence", "ambient"]);

function readable(entries) {
  return entries
    .filter((e) => SPOKEN.has(e.kind) && e.text)
    .map((e) => (e.kind === "presence" && e.name ? `${e.name}. ${e.text}` : e.text))
    .join(" ");
}

function useNarrator(enabled, voiceURI, rate) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [voices, setVoices] = useState([]);
  const chosenRef = useRef(null);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  /* Our own busy flag rather than speechSynthesis.speaking. The native flag
     is false for a window between speak() being called and the utterance
     actually starting, and anything checking it in that gap concludes the
     narrator is idle and talks over the top. Setting this synchronously in
     speak() closes the gap. */
  const speakingRef = useRef(false);

  // Chrome populates the voice list asynchronously, so the first read is
  // often empty and the event is the only reliable signal.
  useEffect(() => {
    if (!supported) return;
    const read = () => {
      const all = speechSynthesis.getVoices();
      if (all.length) setVoices(all);
    };
    read();
    speechSynthesis.addEventListener("voiceschanged", read);
    return () => speechSynthesis.removeEventListener("voiceschanged", read);
  }, [supported]);

  /* An explicit choice wins. Without one we set nothing at all and let the
     browser use the system default for the language, which is what most
     people already recognise as "the computer voice" on their machine.
     Picking the first English voice in the list instead sounds arbitrary,
     because list order is not preference order. */
  useEffect(() => {
    chosenRef.current = voiceURI ? voices.find((v) => v.voiceURI === voiceURI) ?? null : null;
  }, [voices, voiceURI]);

  useEffect(() => {
    if (!supported) return;
    return () => { speakingRef.current = false; speechSynthesis.cancel(); };
  }, [supported]);

  useEffect(() => {
    if (supported && !enabled) { speakingRef.current = false; speechSynthesis.cancel(); }
  }, [enabled, supported]);

  const speak = useCallback((text) => {
    if (!supported || !enabled || !text) return;
    const clean = String(text)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")   // emoji are read as their names
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return;

    // Cancel first, or a fast typist builds a backlog three turns deep.
    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(clean);
    if (chosenRef.current) u.voice = chosenRef.current;
    u.lang = chosenRef.current?.lang ?? "en-US";
    u.rate = rateRef.current ?? 1;
    u.pitch = 1;
    u.volume = 1;

    speakingRef.current = true;                  // before speak(), not after
    u.onend = () => { speakingRef.current = false; };
    u.onerror = () => { speakingRef.current = false; };

    speechSynthesis.speak(u);
  }, [supported, enabled]);

  const stop = useCallback(() => {
    speakingRef.current = false;
    if (supported) speechSynthesis.cancel();
  }, [supported]);

  const isSpeaking = useCallback(
    () => supported && enabled &&
      (speakingRef.current || speechSynthesis.speaking || speechSynthesis.pending),
    [supported, enabled],
  );

  return { supported, speak, stop, isSpeaking, voices };
}

/** Fetches world_data, then hands it to Play. Keeps loading and error
    states out of the game itself. */
function PlayLoader({ worldId, char, save, onSave, onExit, onHome }) {
  const [world, setWorld] = useState(null);
  const [art, setArt] = useState({ room: {}, mob: {}, item: {} });
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadWorldData(worldId),
      // Art is optional — a world with no pictures still plays.
      loadArt(worldId).catch(() => []),
    ])
      .then(([{ data }, entries]) => {
        if (cancelled) return;
        const byKind = { room: {}, mob: {}, item: {} };
        for (const e of entries) {
          if (e.url && byKind[e.kind]) byKind[e.kind][e.key] = e.url;
        }
        setArt(byKind);
        setWorld(data);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [worldId]);

  if (error) return (
    <div style={{ background: P.paper, minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <p style={{ fontFamily: "Newsreader, serif", fontSize: 18, color: P.ink }}>{error}</p>
        <button onClick={onExit} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
          padding: "8px 16px", background: "transparent", border: "1px solid " + P.ink, color: P.ink, cursor: "pointer" }}>
          Back
        </button>
      </div>
    </div>
  );

  if (!world) return (
    <div style={{ background: P.paper, minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft }}>opening</span>
    </div>
  );

  return <Play world={world} art={art} char={char} save={save} onSave={onSave}
    onExit={onExit} onHome={onHome} />;
}

function Play({ world, art = {}, char, save, onSave, onExit, onHome }) {
  // One engine per world. Every rule below is the world's, not the app's.
  const E = useMemo(() => makeEngine(world), [world]);
  const { WORLD, freshState, reconcile, itemName, mobsInRoom, applyEffects, buildPrompt, directCommand } = E;

  /* Walking into a room is a sequence: the place, then who is in it, then
     what is lying about. Each part is skipped if there is nothing to show. */
  const arrival = (roomKey, st = state, withHeading = !pinned) => {
    const room = WORLD.rooms[roomKey];
    const entries = [];

    // When pinned, the panel above already carries the picture and the name,
    // so repeating them here would say everything twice.
    if (withHeading) {
      const roomArt = art.room?.[roomKey];
      if (roomArt) entries.push({ kind: "art", url: roomArt, text: room?.name ?? "" });
      entries.push({ kind: roomArt ? "room-under-art" : "room", text: room?.name ?? roomKey });
    }
    if (room?.desc) entries.push({ kind: "narration", text: room.desc });

    for (const id of mobsInRoom(st, roomKey)) {
      const mob = WORLD.mobs[id];
      entries.push({
        kind: "presence",
        url: art.mob?.[id] ?? null,
        name: mob.name,
        text: mob.card?.presence || `${mob.name} is here.`,
      });
    }

    const here = st.roomItems?.[roomKey] ?? [];
    if (here.length) {
      entries.push({
        kind: "items",
        label: "lying here",
        items: here.map((id) => ({
          key: id,
          name: itemName(id),
          url: art.item?.[id] ?? null,
        })),
      });
    }

    return entries;
  };

  /* A save from before the world was edited is brought into line rather
     than discarded; whatever changed is announced once, in the log. */
  const opened = useMemo(() => {
    if (!save?.state) return { state: freshState(), notes: [] };
    const { state: fixed, changes } = reconcile(save.state);
    return { state: fixed, notes: changes };
  }, []);

  const [state, setState] = useState(opened.state);
  const [log, setLog] = useState(() => {
    const base = save?.log ?? [];
    if (!base.length) return arrival(WORLD.startRoom, opened.state, !pinned);
    if (!opened.notes.length) return base;
    return [
      ...base,
      { kind: "system", text: "This world has been changed since you were last here." },
      ...opened.notes.map((text) => ({ kind: "system", text })),
      ...arrival(opened.state.player.room, opened.state, !pinned),
    ];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // On by default. Browsers will not speak until the page has been
  // interacted with, so nothing is heard until the first command anyway.
  const [voice, setVoice] = useState(true);
  const [voiceURI, setVoiceURI] = useState(null);
  const [rate, setRate] = useState(0.95);
  const [voicePanel, setVoicePanel] = useState(false);
  /* Pinned by default: the picture stays put and the text below it starts
     fresh in each room, which reads like being somewhere rather than like
     scrolling back through a transcript. */
  const [pinned, setPinned] = useState(true);
  const [overlay, setOverlay] = useState(true);
  /* Holding an item is a UI state, not a game state: it means "this is the
     one I will hand over if I tap somebody". */
  const [held, setHeld] = useState(null);
  /* The action bar is the alternative to typing: pick a verb, then tap what
     it applies to. `verb` is what is waiting for a target. */
  const [actions, setActions] = useState(false);
  const [verb, setVerb] = useState(null);
  /* What the last action was aimed at. Shown where the room name goes, so
     the bar answers "what am I dealing with" rather than repeating where
     you are, which the panel above already says. */
  const [subject, setSubject] = useState(null);
  const narrator = useNarrator(voice, voiceURI, rate);
  const vv = useVisualViewport();
  const narrow = useNarrow();
  const coarse = useCoarsePointer();
  const [inputFocused, setInputFocused] = useState(false);

  /* With a keyboard up on a phone there is barely three hundred pixels of
     visible height. Rather than shrink everything, the transcript steps out
     of the way: the picture and the input are what you need while typing,
     and the text comes back the moment the keyboard closes.

     Focus rather than viewport arithmetic. Comparing window.innerHeight
     against visualViewport.height used to work, but the viewport meta asks
     the browser for interactive-widget=resizes-content, which shrinks both
     together and leaves nothing to measure. Focus says the same thing more
     directly: on a phone the keyboard is up exactly when the field has it. */
  const onPhone = coarse || narrow;
  /* Focus alone is not enough: a keyboard can be swiped away without the
     field losing focus, and the transcript should come back when the room
     to show it does. Where the viewport cannot be measured, focus stands
     in on its own. */
  const typing = pinned && onPhone && inputFocused && (vv ? vv.shrunk : true);
  const logRef = useRef(null), inputRef = useRef(null), stateRef = useRef(state), busyRef = useRef(busy);
  const narratorRef = useRef(narrator);
  stateRef.current = state; busyRef.current = busy; narratorRef.current = narrator;

  /* Follow the newest line when the page is full, but leave a short page
     alone at the top. Scrolling a two-line description to the bottom of the
     panel is how a cleared room ends up looking empty. */
  useEffect(() => {
    const el = logRef.current;
    // Hidden elements measure zero, so scrolling one leaves it at the top
    // when it reappears. Wait until it is on screen again.
    if (!el || el.offsetParent === null) return;
    if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    else el.scrollTop = 0;
  }, [log, busy, typing]);
  useEffect(() => { onSave({ state, log }); }, [state, log]);

  // Once it is no longer in your hands there is nothing to hold ready.
  useEffect(() => {
    if (held && !state.player.inventory.includes(held)) setHeld(null);
  }, [state.player.inventory, held]);

  // A new room is a new subject.
  useEffect(() => { setSubject(null); }, [state.player.room]);

  /* The ambient timer fires often and then declines most of the time: it
     skips while a turn is resolving, while the narrator is speaking, and at
     random otherwise. Checking often and refusing is better than a long
     fixed interval, because a skipped slot would otherwise cost a full
     cycle of silence. */
  const lastAmbient = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (busyRef.current || stateRef.current.over) return;
      if (Date.now() - lastAmbient.current < 20000) return;
      const pool = WORLD.rooms[stateRef.current.player.room]?.ambient ?? [];
      if (!pool.length) return;

      /* Ambient lines are filler. If the narrator is mid-sentence they are
         not worth cutting in on, and printing one silently would leave text
         nobody heard. Skip the tick and try again next time. */
      if (narratorRef.current?.isSpeaking()) return;

      lastAmbient.current = Date.now();
      const line = pool[Math.floor(Math.random() * pool.length)];
      setLog((l) => [...l, { kind: "ambient", text: line }]);
      narratorRef.current?.speak(line);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const submit = useCallback(async (override) => {
    const command = String(typeof override === "string" ? override : input).trim();
    if (!command || busy || state.over) return;
    if (typeof override !== "string") setInput("");
    setLog((l) => [...l, { kind: "you", text: command }]);

    // Deterministic commands never reach the narrator.
    const direct = directCommand(state, command);
    if (direct.handled) {
      if (direct.inventory) {
        const inv = state.player.inventory;
        const entries = inv.length
          ? [{
              kind: "items",
              label: "carrying",
              items: inv.map((id) => ({ key: id, name: itemName(id), url: art.item?.[id] ?? null })),
            }]
          : [{ kind: "system", text: "You are carrying nothing." }];
        setLog((l) => [...l, ...entries]);
        return;
      }

      if (direct.look) {
        const entries = arrival(state.player.room);
        // Looking is asking to see the room again, so pinned it replaces the
        // page rather than adding a second copy below the first.
        setLog((l) => (pinned ? entries : [...l, ...entries]));
        narrator.speak(readable(entries));
        return;
      }
      if (direct.entries) {
        setLog((l) => [...l, ...direct.entries]);
        if (!onPhone) setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      const { state: next, log: engineLog } = applyEffects(state, direct.effects);
      const moved = next.player.room !== state.player.room;
      const entries = [...engineLog];

      // Picking something up changes what is on the floor; say what is left.
      if (direct.effects.some((x) => x.take || x.drop)) {
        const here = next.roomItems[next.player.room] ?? [];
        if (here.length) {
          entries.push({ kind: "system", text: `Still here: ${here.map(itemName).join(", ")}.` });
        }
      }
      if (moved) entries.push(...arrival(next.player.room, next));

      /* Pinned, a new room starts a clean page: the picture above changes
         and the text below begins at the top rather than continuing a
         transcript the player has already read. */
      setLog((l) => (pinned && moved ? entries : [...l, ...entries]));
      setState(next);
      narrator.speak(readable(entries));
      if (!onPhone) setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    setBusy(true);
    try {
      // The narrate edge function holds the model key and returns
      // { reply, effects } already parsed.
      const parsed = await narrate({
        prompt: buildPrompt(state, char?.name ?? "the traveller"),
        command,
      });

      const { state: next, log: engineLog } = applyEffects(state, parsed.effects ?? []);
      const moved = next.player.room !== state.player.room;
      const entries = [];
      // The sentence describing the move survives the clear: it is the last
      // thing that happened in the old room and the first in the new one.
      if (parsed.reply) entries.push({ kind: "narration", text: parsed.reply });
      entries.push(...engineLog);
      if (moved) entries.push(...arrival(next.player.room, next));

      setLog((l) => (pinned && moved ? entries : [...l, ...entries]));
      setState(next);
      narrator.speak(readable(entries));
    } catch (err) {
      setLog((l) => [...l, { kind: "system", text: err.message || "The connection dropped mid-sentence. Try the command again." }]);
    } finally {
      setBusy(false);
      // Refocusing on a phone would pop the keyboard straight back up and
      // hide the reply the player just waited for.
      if (!onPhone) setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [input, busy, state, char, onPhone]);

  const restart = () => {
    setState(freshState());
    setLog(arrival(WORLD.startRoom, undefined, !pinned));
  };

  /* Every target — a character or an item, in the overlay or the bottom bar
     — asks this what a tap should do. Keeping the decision in one place
     means the action bar and the plain taps cannot drift apart. */
  const tapTarget = (kind, id) => {
    // Buttons stay enabled while a turn is in flight, because disabling one
    // under a finger blurs the input and drops the keyboard. They simply do
    // nothing instead.
    if (busy || state.over) return;
    const isMob = kind === "mob";
    const label = isMob ? (WORLD.mobs[id]?.name ?? id) : itemName(id);

    // Giving takes two taps: what you are holding out, then who to.
    if (verb === "give") {
      if (!isMob) { setHeld(id); return; }
      if (held) { submit(`give the ${itemName(held)} to ${label}`); setHeld(null); setVerb(null); }
      return;
    }

    if (verb === "open" || verb === "close") {
      // Doors are directions. Tapping a character or an item cannot mean one.
      setVerb(null);
      return;
    }

    if (verb) {
      submit(`${verb} ${label}`);
      setSubject(label);
      setVerb(null);
      return;
    }

    // No verb chosen: the old behaviour.
    if (kind === "carried") { setHeld(held === id ? null : id); return; }
    if (isMob) {
      if (held) { submit(`give the ${itemName(held)} to ${label}`); setHeld(null); }
      else submit(`look at ${label}`);
      setSubject(label);
      return;
    }
    submit(`take ${label}`);
    setSubject(label);
  };

  const room = WORLD.rooms[state.player.room];
  const carrying = state.player.inventory.map(itemName);
  const hpFrac = state.player.hp / state.player.maxHp;

  return (
    <div
      /* A tap on the background — the room picture, a gap in a bar, the
         transcript — should not close the keyboard. Preventing the default
         at the surface keeps focus wherever it already is, and anything
         that genuinely wants focus (the input, the voice controls) stops
         the event before it reaches here. */
      onMouseDown={(e) => { if (!wantsFocus(e.target)) e.preventDefault(); }}
      onTouchStart={(e) => {
        /* Preventing the default on touchstart also cancels scrolling, so
           the two scrollable regions are left alone. Everything else in the
           surface is a button or a picture, and neither needs to scroll. */
        if (wantsFocus(e.target)) return;
        if (e.target?.closest?.(".hr-log, .hr-actions, .hr-scroll")) return;
        e.preventDefault();
      }}
      style={{
        background: P.paper, color: P.ink, overflow: "hidden",
        width: "100%", maxWidth: "100vw",
        // Fixed to the visible area, so the keyboard cannot push it out of view.
        position: "fixed", left: 0,
        top: vv ? vv.top : 0,
        height: vv ? vv.height : "100dvh",
      }}>
      <style>{`
        html, body { overflow: hidden; overscroll-behavior: none; }
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; } body { margin: 0 }
        .hr-log, .hr-actions { scrollbar-width: none; -ms-overflow-style: none; }
        .hr-log::-webkit-scrollbar,
        .hr-actions::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .hr-in::placeholder { color: ${P.inkSoft}88 }
        .hr-in:focus { outline: none }
        .hr-btn:focus-visible { outline: 2px solid ${P.ochre}; outline-offset: 2px }
        @keyframes hrIn { from { opacity: 0 } to { opacity: 1 } }
        .hr-fade { animation: hrIn .5s ease both }
        @media (prefers-reduced-motion: reduce) { .hr-fade { animation: none } }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", height: "100%", width: "100%",
        display: "flex", flexDirection: "column", overflowX: "hidden",
        borderLeft: `1px solid ${P.inkSoft}22`, borderRight: `1px solid ${P.inkSoft}22` }}>

        {/* name · title · controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          padding: "12px 16px 10px", borderBottom: `1px solid ${P.inkSoft}33`,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft }}>

          <button
            className="hr-btn"
            onClick={() => { narrator.stop(); onHome?.(); }}
            title="Back to your games"
            style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
              padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: P.inkSoft,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {char?.name}
          </button>

          <button
            className="hr-btn"
            onClick={() => { narrator.stop(); onExit(); }}
            title="Back to this world"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
              fontFamily: "Newsreader, serif", fontSize: 16, color: P.ink, whiteSpace: "nowrap" }}>
            {WORLD.title}
          </button>

          <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 12,
            alignItems: "center", justifyContent: "flex-end" }}>
            <button
              className="hr-btn"
              onClick={() => {
                const next = !pinned;
                setPinned(next);
                /* Unpinning removes the panel, so the room needs its picture
                   and name back in the log or the player loses track of
                   where they are. Pinning does the reverse: the panel takes
                   over, and the page starts clean. */
                setLog(next
                  ? arrival(state.player.room, state, false)
                  : (l) => [...l, ...arrival(state.player.room, state, true)]);
              }}
              title={pinned ? "Unpin the room" : "Pin the room to the top"}
              aria-pressed={pinned}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                display: "inline-flex", alignItems: "center",
                color: pinned ? P.ochre : P.inkSoft }}>
              <PinIcon pinned={pinned} />
            </button>
            {narrator.supported && (
              <button
                className="hr-btn"
                onClick={() => {
                  if (voice) narrator.stop();
                  setVoice((v) => !v);
                }}
                title={voice ? "Stop reading aloud" : "Read the story aloud"}
                aria-pressed={voice}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 11, color: voice ? P.ochre : P.inkSoft }}>
                {voice ? "voice" : "muted"}
              </button>
            )}
            <button className="hr-btn" onClick={() => setVoicePanel((v) => !v)} title="Settings"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                fontFamily: "inherit", fontSize: 12, color: voicePanel ? P.ochre : P.inkSoft }}>
              ⚙
            </button>
          </span>
        </div>

        {pinned && (
          <div style={{
            borderBottom: `1px solid ${P.inkSoft}33`, background: P.paperDeep,
            display: "flex", flexDirection: "column", minHeight: 0,
            // While typing this is the only thing above the input, so it
            // takes whatever room the hidden transcript left behind.
            flex: typing ? "1 1 auto" : "0 0 auto",
          }}>
            {art.room?.[state.player.room] && (
              <div style={{ position: "relative", minHeight: 0, display: "flex" }}>
                <img
                  src={art.room[state.player.room]}
                  alt=""
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{
                    display: "block", width: "100%", objectFit: "cover",
                    imageRendering: "pixelated",
                    ...(typing
                      ? { flex: 1, minHeight: 0 }
                      : { aspectRatio: "16 / 9", maxHeight: "34vh" }),
                  }} />

                {/* Who and what is here, laid over the room itself. People
                    to the left, things to the right, both stacking upward
                    from the floor of the picture. */}
                {overlay && (
                  <>
                    <div style={{ position: "absolute", left: 8, bottom: 8, display: "flex",
                      flexDirection: "column-reverse", gap: 6 }}>
                      {mobsInRoom(state, state.player.room).map((id) => {
                        const url = art.mob?.[id];
                        if (!url) return null;
                        const who = WORLD.mobs[id]?.name ?? id;
                        return (
                          <button key={id} className="hr-btn"
                            title={verb ? `${verb} ${who}` : held ? `Give the ${itemName(held)} to ${who}` : `Look at ${who}`}
                            onClick={() => tapTarget("mob", id)}
                            {...keepFocus}
                            style={{ padding: 0, background: "none", cursor: busy ? "default" : "pointer",
                              border: `1px solid ${held ? P.ochre : P.paper}`, lineHeight: 0,
                              boxShadow: "0 1px 3px rgba(0,0,0,.4)" }}>
                            <img src={url} alt={who}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                              style={{ width: 46, height: 46, objectFit: "cover", objectPosition: "50% 25%",
                                imageRendering: "pixelated", display: "block" }} />
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ position: "absolute", right: 8, bottom: 8, display: "flex",
                      flexDirection: "column-reverse", gap: 6 }}>
                      {(state.roomItems[state.player.room] ?? []).map((id) => {
                        const url = art.item?.[id];
                        if (!url) return null;
                        return (
                          <button key={id} className="hr-btn"
                            title={verb ? `${verb} ${itemName(id)}` : `Take the ${itemName(id)}`}
                            onClick={() => tapTarget("item", id)}
                            {...keepFocus}
                            style={{ padding: 0, background: "none", cursor: busy ? "default" : "pointer",
                              border: `1px solid ${P.paper}`, lineHeight: 0,
                              boxShadow: "0 1px 3px rgba(0,0,0,.4)" }}>
                            <img src={url} alt={itemName(id)}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                              style={{ width: 46, height: 46, objectFit: "cover",
                                imageRendering: "pixelated", display: "block" }} />
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px" }}>
              <button
                className="hr-btn"
                onClick={() => { if (!busy && !state.over) submit("look"); }}
                {...keepFocus}
                title="Look around"
                style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
                  padding: 0, cursor: busy ? "default" : "pointer",
                  fontFamily: "Newsreader, serif", fontSize: 19, color: P.ink,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {titleCase(room.name)}
              </button>

              <button
                className="hr-btn"
                onClick={() => setOverlay((v) => !v)}
                {...keepFocus}
                title={overlay ? "Hide who and what is here" : "Show who and what is here"}
                aria-pressed={overlay}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  display: "inline-flex", alignItems: "center",
                  color: overlay ? P.ochre : P.inkSoft }}>
                <EyeIcon open={overlay} />
              </button>
            </div>
          </div>
        )}

        <div ref={logRef} className="hr-log"
          style={{
            flex: 1, overflowY: "auto", overflowX: "hidden", padding: "22px 20px 8px",
            minHeight: 0, overscrollBehavior: "contain", overflowWrap: "anywhere",
            display: typing ? "none" : "block",
          }}>
          {log.map((e, i) => <LogLine key={i} entry={e} />)}
          {busy && <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft, margin: "18px 0" }}>…</p>}
        </div>

        {voicePanel && (
          <div className="hr-scroll" style={{ borderTop: `1px solid ${P.inkSoft}33`, padding: "12px 20px", background: P.paperDeep,
            flexShrink: 0, maxHeight: "60%", overflowY: "auto", overscrollBehavior: "contain",
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft }}>
            <div style={{ marginBottom: 12, borderBottom: `1px solid ${P.inkSoft}22`, paddingBottom: 10,
              fontSize: 10.5, color: P.inkSoft, lineHeight: 1.9 }}>
              <div>
                touch {String(coarse)} · narrow {String(narrow)} · pinned {String(pinned)} ·
                {" "}focus {String(inputFocused)} · hiding {String(typing)}
              </div>
              <div>
                width {typeof window !== "undefined" ? window.innerWidth : 0} ·
                {" "}visible {vv ? Math.round(vv.height) : "?"} of
                {" "}{typeof window !== "undefined" ? window.innerHeight : 0}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ flex: 1 }}>reading voice</span>
              <button className="hr-btn" onClick={() => setVoicePanel(false)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 11, color: P.inkSoft }}>
                done
              </button>
            </div>

            <select
              value={voiceURI ?? ""}
              onChange={(e) => {
                setVoiceURI(e.target.value || null);
                narrator.stop();
              }}
              style={{ width: "100%", background: P.paper, color: P.ink, borderRadius: 2,
                border: `1px solid ${P.inkSoft}44`, fontFamily: "inherit", fontSize: 12,
                padding: "6px 8px", marginBottom: 10 }}>
              <option value="">System default</option>
              {narrator.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang}{v.localService ? "" : " (online)"}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34 }}>speed</span>
              <input
                type="range" min="0.6" max="1.4" step="0.05" value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                style={{ flex: 1, accentColor: P.ochre }} />
              <span style={{ width: 30, textAlign: "right" }}>{rate.toFixed(2)}</span>
              <button className="hr-btn"
                onClick={() => narrator.speak("The wind comes up the switchback and dies against the rock.")}
                style={{ background: "transparent", border: `1px solid ${P.inkSoft}55`, color: P.inkSoft,
                  fontFamily: "inherit", fontSize: 11, padding: "4px 9px", cursor: "pointer" }}>
                test
              </button>
            </div>

            <details style={{ marginTop: 12, borderTop: `1px solid ${P.inkSoft}22`, paddingTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: P.inkSoft, letterSpacing: ".04em" }}>
                what gets prepended to your next command
              </summary>
              <pre style={{ margin: "10px 0 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
                lineHeight: 1.65, color: P.inkSoft, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                maxHeight: 260, overflowY: "auto" }}>
                {buildPrompt(state, char?.name ?? "the traveller")}
              </pre>
            </details>
          </div>
        )}

        {/* where you are, and the ways out */}
        <div style={{ borderTop: `1px solid ${P.inkSoft}33`, padding: "9px 20px",
          background: P.paperDeep, flexShrink: 0, display: "flex", alignItems: "baseline", gap: 12,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: P.inkSoft }}>

          {/* Whatever you are dealing with: the action you are part-way
              through, then what you are holding, then what you last acted
              on, and only failing all of that, where you are. The picture
              above already says where you are. */}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: verb || held ? P.ochre : P.ink }}>
            {verb
              ? (verb === "give"
                  ? (held
                      ? `give the ${titleCase(itemName(held))} — now tap who to`
                      : "give — tap what you are carrying")
                  : (verb === "open" || verb === "close")
                    ? `${verb} — tap an exit`
                    : `${verb} — tap something`)
              : held
                ? `Holding: ${titleCase(itemName(held))}`
                : subject
                  ? titleCase(subject)
                  : titleCase(room.name)}
          </span>

          <span style={{ whiteSpace: "nowrap", letterSpacing: ".08em", display: "inline-flex",
            alignItems: "baseline", gap: 6 }}>
            <span>EXITS:</span>
            {Object.keys(room.exits ?? {}).length
              ? Object.keys(room.exits).map((d) => {
                  const ex = room.exits[d];
                  const locked = typeof ex === "object" && ex?.locked;
                  return (
                    <button key={d} className="hr-btn"
                      onClick={() => {
                        if (verb === "open" || verb === "close") {
                          submit(`${verb} ${d}`);
                          setVerb(null);
                        } else submit(d);
                      }}
                      {...keepFocus}
                      title={verb === "open" || verb === "close"
                        ? `${verb} the way ${d}`
                        : locked ? `${d} — locked` : `Go ${d}`}
                      style={{ background: "none", border: "none", padding: "0 1px",
                        cursor: busy ? "default" : "pointer", fontFamily: "inherit",
                        fontSize: 11.5, letterSpacing: ".08em",
                        color: locked ? P.rust : P.ink }}>
                      {DIR_LETTER[d] ?? d[0].toUpperCase()}
                    </button>
                  );
                })
              : <span style={{ color: P.inkSoft }}>NONE</span>}
          </span>
        </div>

        {state.over ? (
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${P.inkSoft}33`, flexShrink: 0, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <p style={{ fontFamily: "Newsreader, serif", fontSize: 16, margin: 0, flex: 1, minWidth: 180 }}>You do not get up.</p>
            <button className="hr-btn" onClick={restart}
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 16px", background: "transparent", border: `1px solid ${P.ink}`, color: P.ink, cursor: "pointer" }}>
              Start again
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px 14px", flexShrink: 0,
            borderTop: `1px solid ${P.inkSoft}33`, paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>

            {/* Typing and tapping are two ways to do the same things, and
                only one of them fits on a phone at a time. */}
            <button className="hr-btn"
              onClick={() => { setActions((v) => !v); setVerb(null); }}
              {...keepFocus}
              title={actions ? "Type a command instead" : "Choose an action instead"}
              aria-pressed={actions}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                display: "inline-flex", alignItems: "center", flexShrink: 0,
                color: actions ? P.ochre : P.inkSoft }}>
              <Glyph name={actions ? "keys" : "grid"} />
            </button>

            {/* The action bar and the input share this row, but the input is
                never unmounted: a removed element cannot hold focus, and a
                phone retracts its keyboard the moment focus is lost. It is
                shrunk out of sight instead, so switching to the buttons and
                back does not close the keyboard under the player. */}
            <div style={{ flex: actions ? "0 0 0px" : "1 1 auto", minWidth: 0,
              display: "flex", alignItems: "center", gap: 10,
              opacity: actions ? 0 : 1,
              width: actions ? 0 : undefined,
              overflow: actions ? "hidden" : "visible",
              pointerEvents: actions ? "none" : "auto" }}>
              <span aria-hidden style={{ fontFamily: "'IBM Plex Mono', monospace", color: P.ochre, fontSize: 13 }}>›</span>
              <input ref={inputRef} className="hr-in" value={input}
                /* readOnly rather than disabled: disabling a focused field
                   blurs it, and on a phone that closes the keyboard every
                   time a turn is sent. submit() already refuses while busy,
                   so nothing gets through anyway. */
                readOnly={busy}
                autoFocus={!onPhone}
                tabIndex={actions ? -1 : 0}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
                style={{
                  flex: 1, minWidth: 0, background: "transparent", border: "none",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 16,              // anything smaller and iOS zooms on focus
                  color: busy ? P.inkSoft : P.ink, padding: "4px 0",
                  touchAction: "manipulation",
                }} />
              <button className="hr-btn" onClick={() => { if (!busy) submit(); }} {...keepFocus}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, background: "transparent",
                  border: `1px solid ${P.inkSoft}55`, color: P.inkSoft, padding: "5px 10px", cursor: busy ? "default" : "pointer" }}>
                send
              </button>
            </div>

            {actions && (
              /* One row that slides sideways rather than wrapping onto a
                 second line: the bar sits directly above the keyboard on a
                 phone, and a second row would push the input off screen. */
              <div className="hr-actions" style={{ flex: 1, minWidth: 0, display: "flex",
                alignItems: "center", gap: 6, flexWrap: "nowrap",
                overflowX: "auto", overflowY: "hidden",
                overscrollBehaviorX: "contain", WebkitOverflowScrolling: "touch",
                scrollSnapType: "x proximity", padding: "1px 0" }}>
                {VERBS.map((v) => {
                  const on = verb === v.key;
                  return (
                    <button key={v.key} className="hr-btn"
                      onClick={() => {
                        if (busy || state.over) return;
                        if (on) { setVerb(null); return; }
                        /* drop and use can only mean the thing in your hand.
                           Asking for a tap you have already made is busywork. */
                        if (held && (v.key === "drop" || v.key === "use")) {
                          submit(`${v.key} ${itemName(held)}`);
                          setSubject(itemName(held));
                          setHeld(null);
                          setVerb(null);
                          return;
                        }
                        setVerb(v.key);
                      }}
                      title={`${v.label}, then tap something`}
                      {...keepFocus}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                        gap: 5, padding: "6px 4px", borderRadius: 2,
                        flex: "0 0 auto", width: 76, scrollSnapAlign: "start",
                        cursor: busy ? "default" : "pointer", background: "transparent",
                        fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                        color: on ? P.ochre : P.inkSoft,
                        border: `1px solid ${on ? P.ochre : P.inkSoft}44` }}>
                      <Glyph name={v.key} />
                      {v.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}


        {/* What you are carrying, and how you are doing. Tapping an item
            picks it up in the sense of holding it ready — tap a character
            above to hand it over, or tap it again to put it down. */}
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${P.inkSoft}22`,
          background: "transparent", padding: "10px 20px",
          display: "flex", alignItems: "center", gap: 12,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: P.inkSoft,
        }}>
          <button
            className="hr-btn"
            onClick={() => { if (!busy && !state.over) submit("i"); }}
            {...keepFocus}
            title="Check your inventory"
            style={{ background: "none", border: "none", padding: 0, flexShrink: 0,
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit", fontSize: 11, color: P.inkSoft }}>
            Carrying:
          </button>

          {/* Only the items slide. The label stays put, or it scrolls away
              and the row reads as a list of nothing in particular. */}
          <div className="hr-actions" style={{ flex: 1, minWidth: 0, display: "flex",
            alignItems: "center", gap: 6, flexWrap: "nowrap",
            overflowX: "auto", overflowY: "hidden",
            overscrollBehaviorX: "contain", WebkitOverflowScrolling: "touch" }}>
            {carrying.length === 0 && <span style={{ flexShrink: 0 }}>Nothing</span>}

            {state.player.inventory.map((id, i) => {
              const on = held === id;
              return (
                <button
                  key={id}
                  className="hr-btn"
                  onClick={() => tapTarget("carried", id)}
                  {...keepFocus}
                  title={verb ? `${verb} ${itemName(id)}` : on ? "Put it down" : "Hold it ready to give"}
                  style={{
                    background: "none", border: "none", padding: 0,
                    flexShrink: 0, whiteSpace: "nowrap",
                    cursor: busy ? "default" : "pointer",
                    fontFamily: "inherit", fontSize: 11,
                    color: on ? P.ochre : P.ink,
                    textDecoration: on ? "underline" : "none",
                  }}>
                  {titleCase(itemName(id))}{i < state.player.inventory.length - 1 ? "," : ""}
                </button>
              );
            })}
          </div>

          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
            <span aria-hidden style={{ width: 34, height: 3, background: `${P.inkSoft}33`,
              display: "inline-block", position: "relative" }}>
              <span style={{ position: "absolute", inset: 0, width: `${hpFrac * 100}%`,
                background: hpFrac > 0.4 ? P.moss : P.rust }} />
            </span>
            {state.player.hp}/{state.player.maxHp}
          </span>
        </div>


      </div>
    </div>
  );
}

function LogLine({ entry }) {
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
              imageRendering: "pixelated",
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
          {entry.label ?? "lying here"}
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
                    imageRendering: "pixelated",
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
