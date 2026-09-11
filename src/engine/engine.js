/* THE ENGINE.
   
   The model proposes, this disposes. Every effect the narrator emits is
   applied here against real state, or refused. Nothing in this file knows
   anything about React, and that is the point: the rules of a world do not
   depend on how it is drawn. */


/* A walkthrough, computed rather than written. It plays the world the same
   way a real playthrough would — one quest stage at a time, tracking
   inventory, raised flags and opened doors exactly as the engine does —
   and records the shortest path and the action taken at each step. Nothing
   here is asked of a model: it cannot hallucinate a step that does not
   match the world, because it IS the world's own rules run forward.

   Each returned step corresponds to one quest stage, in quest order:
     { quest, goal, room, roomName, path, action, note, already }
   `path` is a list of exit directions from wherever the previous step left
   off. `action` is a short mechanical description ("take golden_apple",
   "give golden_apple to imam_rashid", "pull the lever"). `already` marks a
   stage that was satisfied as a side effect of an earlier one — most often
   an item a trade already placed in the player's hands. */
export function buildWalkthrough(WORLD) {
  const rooms = WORLD.rooms ?? {};
  const mobs = WORLD.mobs ?? {};
  const items = WORLD.items ?? {};
  const props = WORLD.props ?? {};

  const itemLabel = (id) => items[id]?.short ?? items[id]?.name ?? id;
  const mobLabel = (id) => mobs[id]?.name ?? id;
  const roomLabel = (id) => rooms[id]?.name ?? id;

  const inv = new Set();
  const flags = new Set();
  const opened = new Set();                 // "room:dir", mirrors state.opened
  const roomItems = {};
  for (const [rk, list] of Object.entries(WORLD.roomItems ?? {})) roomItems[rk] = new Set(list ?? []);
  const mobInv = {};
  for (const [mk, m] of Object.entries(mobs)) mobInv[mk] = new Set(m.inventory ?? []);

  let here = WORLD.startRoom;
  const steps = [];

  /* Shortest path from `here` to `to`, honouring only what has actually
     been unlocked so far in this walkthrough — the same constraint a real
     player is under. */
  const pathTo = (to) => {
    if (here === to) return [];
    const seen = new Set([here]);
    const queue = [[here, []]];
    while (queue.length) {
      const [cur, path] = queue.shift();
      for (const [dir, ex] of Object.entries(rooms[cur]?.exits ?? {})) {
        const dest = typeof ex === "string" ? ex : ex?.to;
        if (!dest || !rooms[dest] || seen.has(dest)) continue;
        const lock = typeof ex === "object" ? ex.locked : null;
        const need = typeof ex === "object" ? ex.needs : null;
        if (lock && !(inv.has(lock) && opened.has(`${cur}:${dir}`))) continue;
        if (need && !flags.has(need)) continue;
        seen.add(dest);
        const nextPath = [...path, dir];
        if (dest === to) return nextPath;
        queue.push([dest, nextPath]);
      }
    }
    return null;   // unreachable given what has been unlocked so far
  };

  /* Rooms reachable right now, for finding where an item can currently be
     picked up or which mob can currently make a trade. */
  const reachableNow = () => {
    const seen = new Set([here]);
    const queue = [here];
    while (queue.length) {
      const cur = queue.shift();
      for (const [dir, ex] of Object.entries(rooms[cur]?.exits ?? {})) {
        const dest = typeof ex === "string" ? ex : ex?.to;
        if (!dest || !rooms[dest] || seen.has(dest)) continue;
        const lock = typeof ex === "object" ? ex.locked : null;
        const need = typeof ex === "object" ? ex.needs : null;
        if (lock && !(inv.has(lock) && opened.has(`${cur}:${dir}`))) continue;
        if (need && !flags.has(need)) continue;
        seen.add(dest);
        queue.push(dest);
      }
    }
    return seen;
  };

  // Move `here` to `to`, opening any locked door along the way, recording
  // one step of the walkthrough for the journey.
  // Returns the path taken (an empty array if already there), or null if
  // no path could be found given what has been unlocked so far.
  const travel = (to) => {
    if (here === to) return [];
    const path = pathTo(to);
    if (!path) return null;
    let cur = here;
    for (const dir of path) {
      const ex = rooms[cur].exits[dir];
      const lock = typeof ex === "object" ? ex.locked : null;
      if (lock && !opened.has(`${cur}:${dir}`)) opened.add(`${cur}:${dir}`);
      cur = typeof ex === "string" ? ex : ex.to;
    }
    here = to;
    return path;
  };

  for (const [qk, q] of Object.entries(WORLD.quests ?? {})) {
    for (const stage of q.stages ?? []) {
      const when = stage.when ?? {};
      let entry = { quest: q.name, goal: stage.goal, room: null, roomName: null,
        path: [], action: "", note: "", already: false };

      if (when.playerHas) {
        const item = when.playerHas;
        if (inv.has(item)) {
          entry.already = true;
          entry.action = `have the ${itemLabel(item)}`;
        } else {
          const open = reachableNow();
          // lying in a room already open to us
          let source = Object.entries(roomItems).find(([rk, set]) => open.has(rk) && set.has(item))?.[0];
          if (source) {
            const path = travel(source);
            if (path) {
              inv.add(item);
              roomItems[source]?.delete(item);
              entry = { ...entry, room: source, roomName: roomLabel(source), path,
                action: `take ${itemLabel(item)}` };
            }
          } else {
            // offered in a trade we can currently afford
            const seller = Object.entries(mobs).find(([mk, m]) =>
              open.has(m.room) && (m.trades ?? []).some((t) => t.gives === item && inv.has(t.wants)));
            if (seller) {
              const [mk, m] = seller;
              const trade = m.trades.find((t) => t.gives === item && inv.has(t.wants));
              const path = travel(m.room);
              if (path) {
                inv.delete(trade.wants);
                mobInv[mk]?.add(trade.wants);
                mobInv[mk]?.delete(item);
                inv.add(item);
                entry = { ...entry, room: m.room, roomName: roomLabel(m.room), path,
                  action: `trade ${itemLabel(trade.wants)} to ${mobLabel(mk)} for ${itemLabel(item)}` };
              }
            } else {
              entry.note = "could not be resolved automatically — check this stage by hand";
            }
          }
        }
      } else if (when.mobHas) {
        const { mob, item } = when.mobHas;
        const path = travel(mobs[mob]?.room);
        if (path === null) {
          entry.note = `${mobLabel(mob)} could not be reached — check this stage by hand`;
        } else {
          /* Handing something over is not always just a loss. If the mob
             has a trade wanting exactly this item AND is actually holding
             what it offers in return, a real "give" action triggers that
             trade — the item moves to them, and whatever they offer in
             exchange moves to the player, in the same breath. That second
             condition matters and is not just belt-and-braces: the real
             give handler (below) checks the mob's live inventory before
             firing a trade, not just that one is theoretically offered, so
             a world that describes a trade whose "gives" item was never
             actually stocked would not fire it either. Checking only the
             first condition here would let the simulator hand over
             something the real game never would.

             Earlier this only modelled the first half of a real give —
             the item leaving the player — which quietly discarded it
             without ever crediting what came back: a stage two rooms
             later that expected the player to be holding the returned
             item found the simulated inventory empty, even though the
             real game would already have it. */
          const trade = (mobs[mob]?.trades ?? [])
            .find((t) => t.wants === item && mobInv[mob]?.has(t.gives));
          inv.delete(item);
          mobInv[mob]?.add(item);
          if (trade) {
            mobInv[mob]?.delete(trade.gives);
            inv.add(trade.gives);
          }
          entry = { ...entry, room: mobs[mob]?.room, roomName: roomLabel(mobs[mob]?.room), path,
            action: trade
              ? `trade ${itemLabel(item)} to ${mobLabel(mob)} for ${itemLabel(trade.gives)}`
              : `give ${itemLabel(item)} to ${mobLabel(mob)}` };
        }
      } else if (when.inRoom) {
        const path = travel(when.inRoom);
        if (path === null) {
          entry.note = "that room could not be reached — check this stage by hand";
        } else {
          entry = { ...entry, room: when.inRoom, roomName: roomLabel(when.inRoom), path,
            action: "go there" };
        }
      } else if (when.flag) {
        const prop = Object.entries(props).find(([, pr]) => pr?.sets === when.flag);
        if (!prop) {
          entry.note = "no prop sets this flag — check this stage by hand";
        } else {
          const [pk, pr] = prop;
          const path = travel(pr.room);
          if (path === null) {
            entry.note = `${pr.name} could not be reached — check this stage by hand`;
          } else {
            flags.add(when.flag);
            entry = { ...entry, room: pr.room, roomName: roomLabel(pr.room), path,
              action: `${pr.verb ?? "use"} the ${pr.name}` };
          }
        }
      }

      steps.push(entry);
    }
  }

  return steps;
}

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

/* Everything in the room, found or not. `propsInRoom` is the one to use
   almost everywhere: a hidden prop is not in the room at all until whatever
   conceals it has been dealt with — not shown, not mentioned to the
   narrator, not workable. */
const allPropsInRoom = (room) =>
  Object.entries(WORLD.props ?? {}).filter(([, p]) => p?.room === room).map(([id]) => id);

const propVisible = (s, id) => {
  const pr = WORLD.props?.[id];
  if (!pr) return false;
  return !pr.hiddenUntil || Boolean(s?.flags?.[pr.hiddenUntil]);
};

const propsInRoom = (s, room) => allPropsInRoom(room).filter((id) => propVisible(s, id));

/* Items conceal the same way props do. Everything that reads the floor of a
   room goes through this, so a letter behind a portrait is not listed, not
   takeable and not mentioned until the portrait has been searched. */
const itemVisible = (s, id) => {
  const until = WORLD.items?.[id]?.hiddenUntil;
  return !until || Boolean(s?.flags?.[until]);
};

const itemsInRoom = (s, room) => (s.roomItems?.[room] ?? []).filter((id) => itemVisible(s, id));

const propName = (id) => WORLD.props?.[id]?.name ?? id;

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
  const here = itemsInRoom(s, s.player.room);
  if (here.length) L.push("- take " + here.map(itemName).join(", "));
  if (s.player.inventory.length) L.push("- drop " + s.player.inventory.map(itemName).join(", "));
  for (const id of propsInRoom(s, s.player.room)) {
    const pr = WORLD.props[id];
    if (s.flags?.[pr.sets]) { L.push(`- the ${pr.name} has already been worked and will not do it twice`); continue; }
    L.push(pr.requires && !s.player.inventory.includes(pr.requires)
      ? `- the ${pr.name} is here but will not move without the ${itemName(pr.requires)}`
      : `- ${pr.verb ?? "use"} the ${pr.name} (this works, and changes something)`);
    // Never hint at what is hidden. Finding it is the point.
  }

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

const resolveProp = (input, pool) => {
  const q = norm(input);
  if (!q) return null;
  const names = (id) => [norm(id), norm(WORLD.props?.[id]?.name)].filter(Boolean);
  return (
    pool.find((id) => names(id).includes(q)) ??
    pool.find((id) => names(id).some((n) => n.includes(q) || q.includes(n))) ??
    pool.find((id) => {
      const words = new Set(q.split(" ").filter((w) => w.length > 2));
      return names(id).some((n) => n.split(" ").some((w) => words.has(w)));
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
  s.flags ??= {};

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
      if (ex.needs && !s.flags?.[ex.needs]) {
        note(`The way ${dir} will not open. Something has to change first.`);
        continue;
      }
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
      const id = resolveItem(e.take, itemsInRoom(s, s.player.room));
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

    if (e.work) {
      const id = resolveProp(e.work, propsInRoom(s, s.player.room));
      if (!id) { note(`There is nothing here called ${e.work}.`); continue; }
      const pr = WORLD.props[id];

      if (s.flags?.[pr.sets]) { note(`The ${pr.name} has already been worked.`); continue; }
      if (pr.requires && !s.player.inventory.includes(pr.requires)) {
        note(`The ${pr.name} will not move. It needs the ${itemName(pr.requires)}.`);
        continue;
      }

      (s.flags ??= {})[pr.sets] = true;
      note(pr.result, "gain");

      /* One search can uncover several things. Everything waiting on this
         flag comes into view at once, props and items alike. */
      const found = [
        ...allPropsInRoom(s.player.room)
          .filter((o) => o !== id && WORLD.props[o]?.hiddenUntil === pr.sets)
          .map((o) => WORLD.props[o].name),
        ...(s.roomItems?.[s.player.room] ?? [])
          .filter((o) => WORLD.items?.[o]?.hiddenUntil === pr.sets)
          .map((o) => itemName(o)),
      ];
      if (found.length) {
        note(`You can see ${found.join(" and ")} now.`, "gain");
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
  const here = itemsInRoom(state, state.player.room);

  return `You are the narrator and the character voices for a text adventure called ${WORLD.title}.

WORLD
${WORLD.premise}

THE PLAYER
They are called ${charName}. Characters may address them by name.

CURRENT ROOM
${room.name} (${room.exposure ?? "indoors"}) — ${room.desc}
Exits: ${exitsOf(room).map(({ dir, to, locked }) => `${dir} to ${WORLD.rooms[to]?.name ?? to}${locked ? " (locked)" : ""}`).join("; ")}
Lying here: ${here.length ? here.map(itemName).join(", ") : "nothing"}
Fixed here: ${propsInRoom(state, state.player.room).map((id) => WORLD.props[id].name).join(", ") || "nothing"}
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
- Opening a chest, a drawer, a book or anything else that is not a way out is yours to describe.
  Say what is inside in prose, but do not put anything into the player's hands: if they should
  come away with something, it has to be a thing this world already has, and they take it with a
  {"take":...} effect of their own. Never invent an object.
- If the player just talks, that is a complete turn. Nothing has to change.

REPLY FORMAT
Reply with JSON only. No markdown fences, no preamble.
{"reply": "your prose", "effects": []}

Effects — use only these, at most two per turn, only for what the list above permits:
{"move":"north"} {"take":"apple"} {"drop":"apple"} {"give":{"item":"apple","to":"borin"}}
{"open":"north"} {"close":"north"}   — only for exits that are locked
{"work":"lever_key"}                — a prop in this room: a lever, a valve, a winch
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
    const here = itemsInRoom(state, state.player.room);
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
    const here = itemsInRoom(state, state.player.room);
    return { handled: true, entries: [{ kind: "system",
      text: here.length ? `Take what? ${here.map(itemName).join(", ")}.` : "There is nothing here to pick up." }] };
  }

  /* Opening is two different things wearing one word. A door is a direction
     and the engine settles it; a chest, a book or a drawer is a thing, and
     only the narrator knows what is inside. Work out which was meant before
     deciding who answers. */
  /* A prop answers to its own verb — pull, turn, wind — and to the general
     ones. Direct, because working a lever is as settled as taking a key. */
  const workMatch = raw.match(
    /^(pull|push|turn|twist|wind|crank|flip|lift|lower|press|use|operate|work|search|examine|inspect|look behind|look under|look inside|look at|look)\s+(?:at\s+|the\s+|behind\s+|under\s+|inside\s+)*(.+)$/);
  if (workMatch) {
    const looking = /^(search|examine|inspect|look)/.test(workMatch[1]);
    const here = propsInRoom(state, state.player.room);
    const found = here.length ? resolveProp(workMatch[2], here) : null;

    /* A prop that has already given up what it was hiding is just scenery,
       so looking at it again should get a description rather than "already
       worked". Working verbs still report that plainly. */
    if (found) {
      const done = Boolean(state.flags?.[WORLD.props[found].sets]);
      if (looking && done) return { handled: false };
      return { handled: true, effects: [{ work: found }] };
    }
    // Not a prop: let the narrator make sense of it.
    return { handled: false };
  }

  const doorMatch = raw.match(/^(open|unlock|close|lock|shut)\s*(.*)$/);
  if (doorMatch) {
    const closing = ["close", "lock", "shut"].includes(doorMatch[1]);
    const rest = doorMatch[2].replace(/^(the|a|an|my)\s+/, "").trim();
    const asDoor = rest.replace(/\b(door|gate|hatch|way|exit|passage)\b/g, "").trim();

    const locked = exitsOf(room).filter((e) => e.locked);
    let dir = SHORT[asDoor] ?? null;

    // A prop by that name is worked, not narrated.
    if (!dir && rest) {
      const prop = resolveProp(rest, propsInRoom(state, state.player.room));
      if (prop) return { handled: true, effects: [{ work: prop }] };
    }

    // Something here or in hand by that name: a thing, not a way out.
    const reachable = [...itemsInRoom(state, state.player.room), ...state.player.inventory];
    if (!dir && rest && matchItems(rest, reachable).length) {
      return { handled: false };          // the narrator takes it
    }

    // "open the door" is unambiguous when only one way out is locked.
    if (!dir && asDoor === "" && locked.length === 1) dir = locked[0].dir;

    if (!dir) {
      if (!rest) {
        return { handled: true, entries: [{ kind: "system", text: locked.length
          ? `Which way? ${locked.map((e) => e.dir).join(", ")}.`
          : "Open what?" }] };
      }
      return { handled: false };          // not a door and not a thing we know: let it be narrated
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

return { WORLD, freshState, reconcile, itemName, propName, mobsInRoom, propsInRoom, itemsInRoom, propVisible, exitOf, exposureOf, applyEffects, buildPrompt, directCommand };
}
