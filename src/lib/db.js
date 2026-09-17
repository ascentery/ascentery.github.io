import { supabase } from './supabase'

/* Every database read and write lives here, so components never
   build queries inline. If a table shape changes, this is the only
   file that has to know. */

/* ---------- profile, balance ---------- */

/** Whole cents to "$0.05". Balances are integers everywhere; this is the
    only place they become something to read. */
export const money = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`

/** What a draw costs, in cents. Mirrors PRICE_CENTS in the art function,
    which carries the workings. Roughly twice generation plus storage plus
    expected egress. */
export const PRICE_CENTS = { flux: 11, pixel: 5 }

export async function loadMe(userId) {
  const [{ data: profile, error: pe }, { data: credits }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, gamer_tag, username, is_creator, is_admin, bio, avatar_path, avatar_mode, avatar_bg_color, avatar_bg_color2, avatar_letter_color, avatar_prompt, avatar_engine, prev_avatar_path').eq('id', userId).single(),
    supabase.from('credits').select('balance_cents, cap_cents').eq('user_id', userId).single(),
  ])

  // A missing profile means the handle_new_user trigger didn't fire.
  if (pe) throw new Error('No profile found for this account. Check the on_auth_user_created trigger.')

  return {
    id: profile.id,
    name: profile.display_name,
    tag: profile.gamer_tag,
    username: profile.username ?? null,
    isCreator: Boolean(profile.is_creator),
    isAdmin: Boolean(profile.is_admin),
    bio: profile.bio ?? '',
    avatarUrl: artUrl(profile.avatar_path),
    avatarPrevUrl: artUrl(profile.prev_avatar_path),
    avatarMode: profile.avatar_mode ?? 'default',
    avatarBgColor: profile.avatar_bg_color,
    avatarBgColor2: profile.avatar_bg_color2,
    avatarLetterColor: profile.avatar_letter_color,
    avatarPrompt: profile.avatar_prompt ?? '',
    avatarEngine: profile.avatar_engine ?? 'pixel',
    balance: credits?.balance_cents ?? 0,
    balanceCap: credits?.cap_cents ?? 500,
  }
}

export async function saveBio(userId, bio) {
  const { error } = await supabase.from('profiles').update({ bio }).eq('id', userId)
  if (error) throw error
}

/** Just the mode switch — "which avatar is currently active" — without
    touching colours or the generated image at all. This is what a
    creator flipping between "Use Default" and "User Generated Image"
    should trigger immediately: showing whatever already exists for that
    mode right away, everywhere the avatar appears, not waiting for a
    Save or Generate action that may never come if they just wanted to
    switch back to a picture they already had. */
export async function setAvatarMode(userId, mode) {
  const { error } = await supabase.from('profiles').update({ avatar_mode: mode }).eq('id', userId)
  if (error) throw error
}

/** The letter/circle avatar mode: no generation, just two colours picked
    directly. Switching to this mode also flips avatar_mode back to
    'default' — it is what actually decides which avatar shows, separate
    from whatever image may still be sitting in avatar_path from an
    earlier generated picture. */
export async function saveDefaultAvatar(userId, { bgColor, bgColor2, letterColor }) {
  const { error } = await supabase.from('profiles')
    .update({ avatar_mode: 'default', avatar_bg_color: bgColor, avatar_bg_color2: bgColor2, avatar_letter_color: letterColor })
    .eq('id', userId)
  if (error) throw error
}

/** Saves the prompt and engine choice for a generated avatar, without
    drawing anything yet — a separate step from generateAvatar() itself,
    the same split Create's game-building steps already use. */
export async function saveAvatarPrompt(userId, { prompt, engine }) {
  const { error } = await supabase.from('profiles')
    .update({ avatar_prompt: prompt, avatar_engine: engine })
    .eq('id', userId)
  if (error) throw error
}

/** Creator-only, enforced server-side regardless of what this lets you
    attempt client-side. Draws from whatever was just saved via
    saveAvatarPrompt — save that first, or this draws from whatever was
    saved last time. Returns { url, prev_url, cost_cents, balance_cents }. */
export async function generateAvatar() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Could not generate a picture (${res.status})`)
    err.needsFunds = Boolean(body.needs_funds)
    throw err
  }
  return body
}

/** Undo/redo for the generated avatar — same real, persisted swap as
    swapArtVersions for world pictures, not just a local display toggle.
    Throws if there is no previous version yet. */
export async function swapAvatarVersion() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/avatar-swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not switch pictures (${res.status})`)
  return body
}

export async function saveDisplayName(userId, name) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: name })
    .eq('id', userId)
  if (error) {
    // The database refuses names on the shared list; say so plainly rather
    // than showing a Postgres string.
    if (/different display name/i.test(error.message ?? '')) {
      throw new Error('Pick a different display name.')
    }
    throw error
  }
}

/* ---------- characters ---------- */

export async function loadCharacters(userId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, bio')
    .eq('user_id', userId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createCharacter(userId, name) {
  const { data, error } = await supabase
    .from('characters')
    .insert({ user_id: userId, name })
    .select('id, name, bio')
    .single()
  if (error) throw error
  return data
}

export async function updateCharacterBio(id, bio) {
  const { error } = await supabase.from('characters').update({ bio }).eq('id', id)
  if (error) throw error
}

export async function deleteCharacter(id) {
  const { error } = await supabase.from('characters').delete().eq('id', id)
  if (error) throw error
}

/* ---------- saves ----------
   Keyed on (world_id, character_id), matching the unique constraint,
   so one account can hold separate progress per character. */

export async function loadSaves(userId) {
  const { data, error } = await supabase
    .from('saves')
    .select('world_id, character_id, state, log, updated_at')
    .eq('user_id', userId)
  if (error) throw error

  // updatedAt is what the home feed sorts "recently played" by — added
  // here rather than fetched separately, since saves are already loaded
  // once at boot and this avoids a second round trip just for a
  // timestamp that was sitting right next to data already being read.
  const map = {}
  for (const row of data ?? []) {
    map[`${row.world_id}:${row.character_id}`] = { state: row.state, log: row.log, updatedAt: row.updated_at }
  }
  return map
}

/** Deletes a save outright — "start anew" from the preview page. Scoped by
    RLS to the caller's own row regardless of the worldId/characterId
    given, so this can never touch anyone else's save. */
export async function deleteSave(userId, worldId, characterId) {
  const { error } = await supabase
    .from('saves')
    .delete()
    .eq('user_id', userId)
    .eq('world_id', worldId)
    .eq('character_id', characterId)
  if (error) throw error
}

/** Checks whether the caller has just finished this world and, if so,
    awards the badge — verified server-side against the world's own quest
    structure and the caller's actual save, never trusted from the client.
    Safe to call after every save: idempotent, and a no-op once already
    earned. Returns true only the moment a badge is newly awarded. */
export async function checkBadge(worldId) {
  const { data, error } = await supabase.rpc('award_badge_if_earned', { p_world_id: worldId })
  if (error) { console.error('could not check badge', error); return false }
  return Boolean(data)
}

export async function writeSave({ userId, worldId, characterId, state, log }) {
  const { error } = await supabase.from('saves').upsert(
    {
      user_id: userId,
      world_id: worldId,
      character_id: characterId,
      state,
      log: log.slice(-120),        // keep the tail; full transcripts get large
      turn: state.turn ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'world_id,character_id' },
  )
  if (error) throw error
}

/* ---------- auth ---------- */

export async function signUp({ email, password, displayName, gamerTagBase }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || 'New player' } },
  })
  if (error) throw error

  // Assigning the gamer tag needs a session (RLS scopes the update to the
  // caller's own row) — with email confirmation on, there isn't one yet,
  // so this only runs when signup grants a session immediately. If it
  // doesn't, the profile is left without a gamer tag until whatever flow
  // handles that case runs; nothing here is silently lost, just deferred.
  if (data.session && gamerTagBase) {
    try {
      await supabase.rpc('assign_gamer_tag', { p_user_id: data.user.id, p_base: gamerTagBase })
    } catch (e) {
      console.error('could not assign a gamer tag at signup', e)
    }
  }

  return { needsConfirmation: !data.session }
}

/** Changes the caller's own gamer tag to "base-digits". Throws with a
    plain message if the exact combination is already taken, the base
    fails the same word filter used elsewhere, or the digits aren't
    exactly four numbers. */
export async function setGamerTag(base, digits) {
  const { data, error } = await supabase.rpc('set_gamer_tag', { p_base: base, p_digits: digits })
  if (error) throw new Error(error.message.replace(/^.*: /, ''))
  return data
}

export async function signIn({ email, password }) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getCurrentEmail() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.email ?? ''
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

/** Supabase sends its own confirmation email to the new address before the
    change actually takes effect — nothing here needs to build or send
    that itself. */
export async function updateEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail })
  if (error) throw error
}

/** Does not reveal whether the address exists — Supabase's own API is
    already written not to, which is the correct behaviour for this: a
    "forgot password" flow that confirms an email exists is itself a
    privacy leak. */
export async function requestPasswordReset(email, redirectTo) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw error
}

/* ---------- worlds ---------- */

/** Catalog rows only. Never pulls world_data — that would drag every
    blob across the wire just to render a grid of cards. */
export const SORTS = [
  { key: 'played', label: 'Most played' },
  { key: 'week', label: 'Most played this week' },
  { key: 'new', label: 'Newest' },
  { key: 'updated', label: 'Recently updated' },
]

export function sortWorlds(worlds, key) {
  const list = [...worlds]
  switch (key) {
    case 'week':
      return list.sort((a, b) => (b.weekPlays - a.weekPlays) || (b.plays - a.plays))
    case 'new':
      return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    case 'updated':
      return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    default:
      return list.sort((a, b) => b.plays - a.plays)
  }
}

export async function loadWorlds(userId) {
  const { data, error } = await supabase
    .from('worlds')
    .select('id, owner_id, title, brief, game_brief, story_details, blurb, status, published, plays, room_count, mob_count, cover_path, failure_note, created_at, updated_at')
    .or(`published.eq.true,owner_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  if (error) throw error

  const ownerIds = [...new Set((data ?? []).map((w) => w.owner_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    // gamer_tag is never fetched here — it stays private even at the
    // network-request level, not just hidden from render. It's for
    // adding friends off-platform, not for anyone browsing a game to see.
    .select('id, display_name, username')
    .in('id', ownerIds.length ? ownerIds : ['00000000-0000-0000-0000-000000000000'])

  const byId = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))

  // Aggregate play counts for the last week. A failure here is not worth
  // failing the whole catalog over; the sort just falls back to lifetime.
  let weekly = {}
  try {
    const { data: recent } = await supabase.rpc('plays_since', { p_days: 7 })
    weekly = Object.fromEntries((recent ?? []).map((r) => [r.world_id, Number(r.plays)]))
  } catch (e) {
    console.error('weekly plays unavailable', e)
  }

  return (data ?? []).map((w) => ({
    id: w.id,
    title: w.title,
    brief: w.brief ?? '',
    gameBrief: w.game_brief ?? '',
    storyDetails: w.story_details ?? '',
    blurb: w.blurb ?? '',
    status: w.status,
    published: w.published,
    plays: w.plays ?? 0,
    weekPlays: weekly[w.id] ?? 0,
    createdAt: w.created_at,
    updatedAt: w.updated_at ?? w.created_at,
    rooms: w.room_count ?? 0,
    mobs: w.mob_count ?? 0,
    failureNote: w.failure_note,
    coverUrl: artUrl(w.cover_path),
    authorId: w.owner_id,
    // Published worlds are credited to a username; a draft may not have one
    // yet, so the display name stands in until it does.
    author: byId[w.owner_id]?.username
      ? `@${byId[w.owner_id].username}`
      : (byId[w.owner_id]?.display_name ?? 'Someone'),
    playable: w.status === 'ready',
  }))
}

export async function loadWorldData(worldId) {
  const { data, error } = await supabase
    .from('world_data')
    .select('data, warnings, complete_walkthrough')
    .eq('world_id', worldId)
    .single()
  if (error) throw new Error('That world has no data yet.')
  return data
}

/** The narrative "Complete Walkthrough" — a real, paid AI generation,
    grounded in the world's actual rooms/items/dialogue/quest stages
    rather than invented from the premise alone. Stored once generated;
    call generateCompleteWalkthrough to create or replace it. */
export async function generateCompleteWalkthrough(worldId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-walkthrough`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ world_id: worldId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = body.detail ? `${body.error} (${body.detail})` : (body.error || `Could not write a walkthrough (${res.status})`)
    const err = new Error(message)
    err.needsFunds = Boolean(body.needs_funds)
    throw err
  }
  return body
}

/** What building a world costs. Mirrors the generate function; a flat fee
    for the map and plot passes, plus the prose pass which grows with rooms. */
// Mirrors FLAT_GEN_CENTS in the generate function by hand — this is
// display-only, shown before a build starts, and has to be kept in sync
// manually if that server-side value ever changes.
export const GEN_FLAT_CENTS = 3

export const ROOM_CHOICES = [
  { key: 'auto', label: 'Let the brief decide', min: null, max: null,
    note: 'A lighthouse gets five or six rooms; a city gets more. Costs whatever it turns out to need.' },
  { key: 'small', label: 'Small', min: 4, max: 6, note: 'One building, or a handful of places.' },
  { key: 'medium', label: 'Medium', min: 7, max: 10, note: 'A neighbourhood, a large house, a stretch of road.' },
  { key: 'large', label: 'Large', min: 11, max: 16, note: 'Districts, a wilderness, somewhere you travel through.' },
]

export async function saveWorldDetails(worldId, { title, brief }) {
  const patch = {}
  if (title !== undefined) patch.title = title.trim() || 'Untitled world'
  if (brief !== undefined) patch.brief = brief.trim()
  if (!Object.keys(patch).length) return
  const { error } = await supabase.from('worlds').update(patch).eq('id', worldId)
  if (error) throw error
}

/** Whether every drawable thing in a world has a picture. Publishing is
    gated on this: a world half full of placeholder art is not ready to
    show strangers. */
export async function isFullyIllustrated(worldId) {
  const { data, error } = await supabase.rpc('world_is_fully_illustrated', { p_world_id: worldId })
  if (error) throw error
  return Boolean(data)
}

/** Polls gen_stage while a world is being built, so progress can be shown
    honestly instead of guessed at with a timer. Stops itself once the
    world leaves "generating", however that happens. */
/** Retrying an existing (already-failed) world skips createWorld entirely,
    since the world row already exists — which means the DB still shows
    the previous failure's status the instant watchGeneration starts
    polling again. watchGeneration only keeps polling while status is
    "generating", so on a retry its very first check can see the stale
    "failed" status and stop forever before the server ever gets a chance
    to flip it back — silent generation with no visible progress, even
    though it is genuinely still running. Call this immediately before
    watchGeneration on a retry so the first poll is guaranteed correct. */
export async function resetWorldForRetry(worldId) {
  const { error } = await supabase
    .from('worlds')
    .update({ status: 'generating', gen_stage: null, failure_note: null })
    .eq('id', worldId)
  if (error) throw error
}

export function watchGeneration(worldId, onStage) {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    const { data } = await supabase
      .from('worlds').select('status, gen_stage').eq('id', worldId).single()
    if (stopped) return
    if (data) onStage(data.status, data.gen_stage)
    if (data?.status === 'generating') setTimeout(tick, 1500)
  }
  tick()
  return () => { stopped = true }
}

export async function createWorld({ userId, title, brief, gameBrief = null, storyDetails = null, roomMin = null, roomMax = null }) {
  const { data, error } = await supabase
    .from('worlds')
    .insert({
      owner_id: userId, title, brief, status: 'generating',
      game_brief: gameBrief, story_details: storyDetails,
      room_min: roomMin, room_max: roomMax,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export const REPORT_REASONS = [
  'Sexual content involving minors',
  'Hate speech or harassment',
  'Sexual content',
  'Graphic violence',
  'Spam or nonsense',
  'Something else',
]

/** Files a report. One per person per world; filing twice updates the first,
    which stops a single objector from inflating the count. */
export async function reportWorld(worldId, reason, detail = '') {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const { error } = await supabase.from('reports').upsert(
    { world_id: worldId, reporter_id: session.user.id, reason, detail: detail.slice(0, 1000) },
    { onConflict: 'world_id,reporter_id' },
  )
  if (error) throw error
}

/** The moderation queue. Admins only; the function refuses anyone else. */
export async function loadReports() {
  const { data, error } = await supabase.rpc('open_reports')
  if (error) throw error
  return data ?? []
}

export async function resolveReport(id) {
  const { error } = await supabase.from('reports').update({ handled: true }).eq('id', id)
  if (error) throw error
}

/** Unpublishing is the useful lever: the world stops being visible without
    destroying the creator's work or anyone's playthrough. */
export async function unpublishWorld(worldId) {
  const { error } = await supabase.from('worlds').update({ published: false }).eq('id', worldId)
  if (error) throw error
}

/** Rename a character, item or room in place. No model, no charge: a name
    is a string, and paying to change one would be absurd. Also updates the
    art row so the studio shows the new name against the old picture. */
export async function renameEntity(worldId, kind, key, name) {
  const clean = String(name ?? '').trim()
  if (!clean) throw new Error('A name is needed.')

  const { data, error } = await supabase
    .from('world_data').select('data').eq('world_id', worldId).single()
  if (error) throw error

  const world = data.data
  const bucket = kind === 'room' ? world.rooms : kind === 'mob' ? world.mobs : world.items
  if (!bucket?.[key]) throw new Error('That is no longer in this world.')

  if (kind === 'item') bucket[key].short = clean
  bucket[key].name = kind === 'item' ? bucket[key].name : clean

  if (clean.length > 60) throw new Error('That name is too long.')
  if (/https?:|www\./i.test(clean)) throw new Error('Names cannot contain links.')
  if (/(.)\1{5,}/.test(clean)) throw new Error('That name is mostly one repeated character.')

  const { data: banned } = await supabase.rpc('contains_banned', { p_text: clean })
  if (banned) throw new Error('Pick a different name.')

  const { error: we } = await supabase
    .from('world_data').update({ data: world }).eq('world_id', worldId)
  if (we) throw we

  await supabase.from('world_art')
    .update({ name: clean })
    .eq('world_id', worldId).eq('kind', kind).eq('entity_key', key)

  return clean
}

/** Everything in a world that can be renamed, flattened for a form. */
export async function loadNameables(worldId) {
  const { data, error } = await supabase
    .from('world_data').select('data').eq('world_id', worldId).single()
  if (error) throw error
  const w = data.data ?? {}
  return [
    ...Object.entries(w.rooms ?? {}).map(([key, r]) => ({ kind: 'room', key, name: r.name })),
    ...Object.entries(w.mobs ?? {}).map(([key, m]) => ({ kind: 'mob', key, name: m.name })),
    ...Object.entries(w.items ?? {}).map(([key, i]) => ({ kind: 'item', key, name: i.short ?? i.name })),
  ]
}

/* ---------- undo ---------- */

/** Versions kept before each amendment, newest first. */
export async function loadHistory(worldId) {
  const { data, error } = await supabase
    .from('world_history')
    .select('id, note, created_at')
    .eq('world_id', worldId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) throw error
  return data ?? []
}

/** Puts a kept version back. Art rows are matched on entity_key, so
    anything that comes back reattaches its own picture. */
export async function undoTo(worldId, historyId) {
  const { data: kept, error } = await supabase
    .from('world_history').select('data').eq('id', historyId).single()
  if (error) throw error

  const world = kept.data
  const { error: we } = await supabase
    .from('world_data').update({ data: world }).eq('world_id', worldId)
  if (we) throw we

  // Anything the restored world knows about again is no longer orphaned.
  const live = [
    ...Object.keys(world.rooms ?? {}).map((k) => `room:${k}`),
    ...Object.keys(world.mobs ?? {}).map((k) => `mob:${k}`),
    ...Object.keys(world.items ?? {}).map((k) => `item:${k}`),
    ...Object.keys(world.props ?? {}).map((k) => `prop:${k}`),
    'cover:cover',
  ]

  const { data: rows } = await supabase
    .from('world_art').select('id, kind, entity_key, orphaned_at').eq('world_id', worldId)

  for (const r of rows ?? []) {
    const here = live.includes(`${r.kind}:${r.entity_key}`)
    if (here && r.orphaned_at) {
      await supabase.from('world_art').update({ orphaned_at: null }).eq('id', r.id)
    } else if (!here && !r.orphaned_at) {
      await supabase.from('world_art')
        .update({ orphaned_at: new Date().toISOString() }).eq('id', r.id)
    }
  }

  // The version just undone is spent; keeping it would let undo bounce.
  await supabase.from('world_history').delete().eq('id', historyId)

  // A restored world describes a different arrangement than any save holds.
  await supabase.from('saves').delete().eq('world_id', worldId)
}

/** Delete a picture for good. Only offered for orphaned ones. */
export async function deleteArt(artId) {
  const { error } = await supabase.from('world_art').delete().eq('id', artId)
  if (error) throw error
}

/** Rebuild part of an existing world from a written instruction.
    'plot' keeps the map and rewrites characters, items and quests.
    'prose' keeps everything and rewrites the words. */
export async function amendWorld(worldId, mode, note) {
  return generateWorld(worldId, { mode, note })
}

/** Fire the generate function. Takes 30–90 seconds. */
export async function generateWorld(worldId, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ worldId, ...opts }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Generation failed (${res.status})`)
    err.needsFunds = Boolean(body.needs_funds)
    err.failedAt = body.failed_at
    err.raw = body.raw ?? null           // the model's own output, for admin troubleshooting
    err.rawLength = body.raw_length ?? null
    throw err
  }
  return body    // { status, stats, warnings, title, blurb, cost_cents, balance_cents }
}

export async function setPublished(worldId, published) {
  const { error } = await supabase.from('worlds').update({ published }).eq('id', worldId)
  if (error) {
    // The database refuses to publish a world whose owner has no username.
    // Surface that as something the caller can route on rather than a
    // Postgres string.
    if (/username/i.test(error.message ?? '')) {
      const e = new Error('You need a username before publishing.')
      e.needsUsername = true
      throw e
    }
    throw error
  }
}

/* ---------- world building presets (admin only) ---------- */

/** Full CRUD, for the admin page. Ordinary creators never call these —
    RLS on world_building_presets would refuse them anyway. */
export async function loadPresets(type) {
  const { data, error } = await supabase
    .from('world_building_presets')
    .select('id, label, prompt, sort_order')
    .eq('type', type)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function savePreset({ id, type, label, prompt, sortOrder }) {
  const row = { type, label: label.trim(), prompt: prompt.trim(), sort_order: sortOrder ?? 0 }
  if (!row.label) throw new Error('A preset needs a label.')
  if (row.prompt.length < 20) throw new Error('The prompt needs at least twenty characters.')
  // No upper bound: a preset is an instruction the admin writes once and
  // should be able to make as thorough as they want.

  if (id) {
    const { error } = await supabase.from('world_building_presets').update(row).eq('id', id)
    if (error) throw error
    return id
  }
  const { data: existing } = await supabase
    .from('world_building_presets').select('id').eq('type', type).ilike('label', row.label).limit(1)
  if (existing?.length) throw new Error('A preset with that label already exists.')

  const { data, error } = await supabase.from('world_building_presets').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

export async function deletePreset(id) {
  const { error } = await supabase.from('world_building_presets').delete().eq('id', id)
  if (error) throw error
}

/* ---------- themes ---------- */

export async function loadThemes() {
  const { data, error } = await supabase
    .from('theme_presets')
    .select('id, label, t_overrides, p_overrides, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function saveTheme({ id, label, tOverrides, pOverrides, sortOrder }) {
  const row = { label: label.trim(), t_overrides: tOverrides ?? {}, p_overrides: pOverrides ?? {}, sort_order: sortOrder ?? 0 }
  if (!row.label) throw new Error('A theme needs a label.')

  if (id) {
    const { error } = await supabase.from('theme_presets').update(row).eq('id', id)
    if (error) throw error
    return id
  }
  const { data: existing } = await supabase.from('theme_presets').select('id').ilike('label', row.label).limit(1)
  if (existing?.length) throw new Error('A theme with that label already exists.')

  const { data, error } = await supabase.from('theme_presets').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

export async function deleteTheme(id) {
  const { error } = await supabase.from('theme_presets').delete().eq('id', id)
  if (error) throw error
}

export async function loadDefaultTheme() {
  const v = await loadSetting('theme_default')
  return v?.id ?? null
}
export async function saveDefaultTheme(id) {
  await saveSetting('theme_default', { id })
}

/** Fetches whichever theme is currently marked default and applies its
    colours onto the live T/P objects in place. T and P are plain exported
    objects, not React state — every component reads T.bone/P.ink etc. as a
    property access at render time, so mutating the objects and forcing one
    re-render at the root is enough for the whole app to pick up the
    change; nothing needs to re-import them. Returns true if anything was
    actually applied, so the caller knows whether a re-render is needed. */
export async function applyDefaultTheme(T, P) {
  let themeId = null
  try {
    themeId = await loadDefaultTheme()
  } catch {
    return false
  }
  if (!themeId) return false

  const { data, error } = await supabase
    .from('theme_presets').select('t_overrides, p_overrides').eq('id', themeId).single()
  if (error || !data) return false

  Object.assign(T, data.t_overrides ?? {})
  Object.assign(P, data.p_overrides ?? {})
  return true
}

/** Which preset to use by default for a given preset type, when nobody
    names one explicitly. Stored in app_settings, same pattern as the model
    picker. One key per type, so brief and details defaults are independent
    even though only the brief one is consumed by anything yet. */
const DEFAULT_KEY = {
  game_brief: 'brief_preset_default',
  story_details: 'story_preset_default',
  game_details: 'details_preset_default',
}

export async function loadDefaultPreset(type) {
  const v = await loadSetting(DEFAULT_KEY[type])
  return v?.id ?? null
}
export async function saveDefaultPreset(type, id) {
  await saveSetting(DEFAULT_KEY[type], { id })
}

/** Calls the edge function that writes a fresh brief from a preset.
    presetId is honoured only if the caller is an admin; anyone else gets
    the platform default, or a random preset if none is set. Free. */
export async function generateBriefFromPreset(presetId = null, hint = null) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...(presetId ? { presetId } : {}), ...(hint ? { hint } : {}) }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not generate a brief (${res.status})`)
  return body   // { title, brief, preset_label, breakdown? }
}

/** Step 2 of Create: flesh the brief out into a story arc. Two modes:
      full       -> { storyDetails }   the initial call after step 1
      regenerate -> { storyDetails }   admin only, free
    presetId is honoured only for admins. */
export async function generateStoryDetails({ mode, title, brief, storyDetails, presetId }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-story`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ mode, title, brief, storyDetails, ...(presetId ? { presetId } : {}) }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not generate (${res.status})`)
  return body
}

/** Step 3 of Create. Three modes:
      full    -> { gameDetails, titles }   the initial call after step 2
      details -> { gameDetails }           admin only, free
      titles  -> { titles }                1 cent, anyone
    presetId is honoured only for admins, same as generateBriefFromPreset.
    storyDetails, once step 2 exists, is the richer context this reads from
    instead of the short step-1 brief. */
export async function generateGameDetails({ mode, title, brief, storyDetails, gameDetails, presetId }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ mode, title, brief, storyDetails, gameDetails, ...(presetId ? { presetId } : {}) }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Could not generate (${res.status})`)
    err.needsFunds = Boolean(body.needs_funds)
    throw err
  }
  return body
}

/* ---------- platform settings (admin) ---------- */

export const PROVIDERS = [
  { key: 'deepseek', label: 'DeepSeek', note: 'Cheap and fast. The default. Writes atmospheric worlds, and needs the validator to keep it honest about gating.' },
  { key: 'claude', label: 'Claude', note: 'Stronger at holding a whole graph in mind, which is what gated chains need. Costs more per world.' },
  { key: 'openai', label: 'ChatGPT', note: 'A third opinion. Worth comparing on the same brief before committing.' },
]

export async function loadSetting(key) {
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', key).single()
  if (error) throw error
  return data?.value ?? {}
}

export async function saveSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

/* ---------- follows ---------- */

export async function followCreator(creatorId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const { error } = await supabase.from('follows').insert({ follower_id: session.user.id, followed_id: creatorId })
  if (error) throw error
}

export async function unfollowCreator(creatorId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const { error } = await supabase.from('follows')
    .delete().eq('follower_id', session.user.id).eq('followed_id', creatorId)
  if (error) throw error
}

/** Whether the caller follows this creator, and how many followers that
    creator has in total — the two things a profile page needs together. */
export async function loadFollowStatus(creatorId) {
  const { data: { session } } = await supabase.auth.getSession()
  const [{ data: mine }, { count }] = await Promise.all([
    session
      ? supabase.from('follows').select('follower_id').eq('follower_id', session.user.id).eq('followed_id', creatorId)
      : Promise.resolve({ data: [] }),
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', creatorId),
  ])
  return { isFollowing: Boolean(mine?.length), followerCount: count ?? 0 }
}

/** Everyone a given user follows — their own "Following" list, which
    shows the same regardless of whose profile page it's opened from. */
const FOLLOW_PROFILE_COLUMNS =
  'id, username, display_name, avatar_path, avatar_mode, avatar_bg_color, avatar_bg_color2, avatar_letter_color'

const mapFollowProfile = (p) => ({
  id: p.id,
  username: p.username,
  name: p.display_name,
  avatarMode: p.avatar_mode ?? 'default',
  avatarUrl: artUrl(p.avatar_path),
  avatarBgColor: p.avatar_bg_color,
  avatarBgColor2: p.avatar_bg_color2,
  avatarLetterColor: p.avatar_letter_color,
})

/** Two-step rather than an embedded select on purpose: follows has two
    foreign keys aimed at the same table (profiles), which is a known
    PostgREST ambiguity trap even with an explicit relationship hint.
    Fetching ids, then profiles, then joining by hand in JS sidesteps
    that fragility entirely instead of trying to get the embedding syntax
    exactly right. */
async function loadFollowSide(column, userId) {
  const { data: rows, error } = await supabase
    .from('follows').select(column).eq(column === 'followed_id' ? 'follower_id' : 'followed_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const ids = (rows ?? []).map((r) => r[column])
  if (!ids.length) return []

  const { data: profs, error: pErr } = await supabase
    .from('profiles').select(FOLLOW_PROFILE_COLUMNS).in('id', ids)
  if (pErr) throw pErr
  const byId = Object.fromEntries((profs ?? []).map((p) => [p.id, p]))

  // Preserves the follow list's own order (most recent first) rather
  // than whatever order the profiles query happened to return.
  return ids.map((id) => byId[id]).filter(Boolean).map(mapFollowProfile)
}

export async function loadFollowing(userId) {
  return loadFollowSide('followed_id', userId)
}

/** The reverse of loadFollowing — everyone who follows this user, not
    everyone this user follows. Same shape, same privacy rule about never
    including gamer_tag. */
export async function loadFollowers(userId) {
  return loadFollowSide('follower_id', userId)
}

/** Published games from everyone the given user follows — a personalised
    "new from people you follow" feed, effectively. Only ever shown on a
    person's own profile page, never someone else's. */
export async function loadGamesByFollowedCreators(userId) {
  const { data: followed, error: fErr } = await supabase
    .from('follows').select('followed_id').eq('follower_id', userId)
  if (fErr) throw fErr
  const ids = (followed ?? []).map((r) => r.followed_id)
  if (!ids.length) return []

  // Two-step rather than an embedded select, matching loadWorlds — worlds
  // does not have a foreign key aimed directly at profiles the way
  // PostgREST embedding needs, only at auth.users.
  const { data: worlds, error } = await supabase
    .from('worlds')
    .select('id, title, cover_path, plays, owner_id')
    .in('owner_id', ids)
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw error

  const { data: profs } = await supabase
    .from('profiles').select('id, username, display_name').in('id', ids)
  const byId = Object.fromEntries((profs ?? []).map((p) => [p.id, p]))

  return (worlds ?? []).map((w) => ({
    id: w.id, title: w.title, coverUrl: artUrl(w.cover_path), plays: w.plays ?? 0,
    authorUsername: byId[w.owner_id]?.username ?? null,
    authorName: byId[w.owner_id]?.display_name ?? 'Someone',
  }))
}

/* ---------- admin: user management ---------- */

export async function adminSearchUsers(query) {
  const { data, error } = await supabase.rpc('admin_search_users', { p_query: query })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
  return (data ?? []).map((r) => ({
    id: r.id, username: r.username, name: r.display_name, email: r.email,
    isCreator: Boolean(r.is_creator), isAdmin: Boolean(r.is_admin), balance: Number(r.balance_cents),
  }))
}

export async function adminSetCreator(userId, isCreator) {
  const { error } = await supabase.rpc('admin_set_creator', { p_user_id: userId, p_is_creator: isCreator })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
}

/** cents can be negative to deduct. Returns the new balance. */
export async function adminAddCredits(userId, cents) {
  const { data, error } = await supabase.rpc('admin_add_credits', { p_user_id: userId, p_cents: cents })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
  return Number(data)
}

/* ---------- public creator profiles ---------- */

/** A creator's public profile — never includes gamer_tag, which stays
    private regardless of what else is visible about someone. */
const CREATOR_PROFILE_COLUMNS =
  'id, username, display_name, is_creator, avatar_path, avatar_mode, avatar_bg_color, avatar_bg_color2, avatar_letter_color, bio'

const mapCreatorProfile = (data) => ({
  id: data.id,
  username: data.username,
  name: data.display_name,
  isCreator: Boolean(data.is_creator),
  avatarMode: data.avatar_mode ?? 'default',
  avatarUrl: artUrl(data.avatar_path),
  avatarBgColor: data.avatar_bg_color,
  avatarBgColor2: data.avatar_bg_color2,
  avatarLetterColor: data.avatar_letter_color,
  bio: data.bio ?? '',
})

export async function loadCreatorProfile(username) {
  const { data, error } = await supabase
    .from('profiles').select(CREATOR_PROFILE_COLUMNS).eq('username', username).single()
  if (error) throw new Error('That creator could not be found.')
  return mapCreatorProfile(data)
}

/** Viewing your own public profile page works even without a username
    set — the dropdown's "Profile Page" link goes by id for exactly this
    reason, since looking up by username would have nowhere to go for
    someone who has never claimed one. */
export async function loadCreatorProfileById(id) {
  const { data, error } = await supabase
    .from('profiles').select(CREATOR_PROFILE_COLUMNS).eq('id', id).single()
  if (error) throw new Error('Profile could not be found.')
  return mapCreatorProfile(data)
}

export async function loadCreatorGames(userId) {
  const { data, error } = await supabase
    .from('worlds')
    .select('id, title, cover_path, plays')
    .eq('owner_id', userId)
    .eq('published', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((w) => ({ id: w.id, title: w.title, coverUrl: artUrl(w.cover_path), plays: w.plays ?? 0 }))
}

/** Games this user has actually finished, verified server-side at the
    time each badge was awarded — never just "worlds they have a save
    in". Includes the badge image for each, drawn separately per world. */
export async function loadCompletedGames(userId) {
  const { data, error } = await supabase
    .from('player_badges')
    .select('world_id, earned_at, worlds(id, title, cover_path)')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []).filter((r) => r.worlds)
  const worldIds = rows.map((r) => r.world_id)

  let badgeByWorld = {}
  if (worldIds.length) {
    const { data: badges } = await supabase
      .from('world_art')
      .select('world_id, image_path')
      .eq('kind', 'badge')
      .in('world_id', worldIds)
    badgeByWorld = Object.fromEntries((badges ?? []).map((b) => [b.world_id, artUrl(b.image_path)]))
  }

  return rows.map((r) => ({
    worldId: r.world_id,
    earnedAt: r.earned_at,
    title: r.worlds.title,
    coverUrl: artUrl(r.worlds.cover_path),
    badgeUrl: badgeByWorld[r.world_id] ?? null,
  }))
}

/* ---------- usernames ---------- */

export async function loadReservedWords() {
  const { data, error } = await supabase.from('reserved_usernames').select('name').order('name')
  if (error) throw error
  return (data ?? []).map((r) => r.name)
}

export async function addReservedWord(name) {
  const { error } = await supabase.from('reserved_usernames').insert({ name: name.trim().toLowerCase() })
  if (error) throw error
}

export async function removeReservedWord(name) {
  const { error } = await supabase.from('reserved_usernames').delete().eq('name', name)
  if (error) throw error
}

/** The AI's own moderation instructions for usernames, editable from the
    admin panel rather than only ever living in the edge function's
    source. Falls back to null when nothing has been saved yet — the
    function itself keeps a hardcoded default for that case. */
export async function loadUsernamePrompt() {
  const v = await loadSetting('username_ai_prompt')
  return v?.text ?? null
}
export async function saveUsernamePrompt(text) {
  await saveSetting('username_ai_prompt', { text })
}

export async function checkUsername(name) {
  const { data, error } = await supabase.rpc('username_available', { p_username: name })
  if (error) throw error
  return Boolean(data)
}

export async function claimUsername(name) {
  const { data, error } = await supabase.rpc('claim_username', { p_username: name })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
  return data
}

/** Moderation gate in front of claimUsername: fast structural checks are
    free, an AI judgment call on anything more subjective (impersonation,
    vulgarity dressed up to dodge a filter) costs 2 cents whether it
    approves or rejects. Only ever tells you whether a name is allowed —
    call claimUsername() afterward to actually take it, same as before.
    Returns { allowed, reason, cost_cents, balance_cents }. */
export async function checkUsernameAllowed(name) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ username: name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Could not check that name (${res.status})`)
    err.needsFunds = Boolean(body.needs_funds)
    throw err
  }
  return body
}

/* ---------- money in ---------- */

export const TOPUPS = ['5', '10', '15', '20']

/** Opens Stripe Checkout. Returns the URL to send the browser to; the
    balance is only ever changed by the webhook, never by the redirect. */
export async function startCheckout(amount) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ amount }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Checkout failed (${res.status})`)
  return body.url
}

export async function deleteWorld(worldId) {
  const { error } = await supabase.from('worlds').delete().eq('id', worldId)
  if (error) throw error
}

export async function bumpPlays(worldId) {
  // supabase.rpc() returns a query builder, not a Promise — it is thenable
  // but has no .catch, so the failure has to be caught around the await.
  try {
    await supabase.rpc('bump_plays', { p_world: worldId })
  } catch (e) {
    console.error('play count not recorded', e)
  }
}

/* ---------- room art rows ---------- */

const SB = import.meta.env.VITE_SUPABASE_URL

/** Art drawn before the buckets were unified still lives in `rooms`, so the
    bucket is stored per row rather than assumed. */
export const artUrl = (path, bucket = 'art') =>
  path ? `${SB}/storage/v1/object/public/${bucket}/${path}` : null

/** Every drawable thing in a world: rooms, characters, items. */
export async function loadArt(worldId) {
  const { data, error } = await supabase
    .from('world_art')
    .select('id, kind, entity_key, name, image_prompt, prev_image_prompt, image_path, prev_image_path, bucket, locked, sort, orphaned_at')
    .eq('world_id', worldId)
    .order('kind')
    .order('sort')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    key: r.entity_key,
    name: r.name,
    prompt: r.image_prompt ?? '',
    prevPrompt: r.prev_image_prompt ?? null,
    url: artUrl(r.image_path, r.bucket ?? 'art'),
    prevUrl: artUrl(r.prev_image_path, r.bucket ?? 'art'),
    art: Boolean(r.image_path),
    locked: r.locked,
    orphaned: Boolean(r.orphaned_at),
  }))
}

/** Draws one entry. 20-60 seconds, and costs real money.
    Always pushes whatever is currently showing down into "previous" —
    undo/redo (swapArtVersions) is a real, persisted swap now, so by the
    time a redraw happens image_path already is whatever is genuinely on
    screen, and there is nothing left for this call to decide.
    Returns { url, balance_cents, cost_cents, engine }. */
export async function drawArt(artId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/art`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ artId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Drawing failed (${res.status})`)
    err.balanceCents = body.balance_cents
    throw err
  }
  return body   // { url, balance_cents, cost_cents, engine }
}

/** Admin only — computes and returns the exact final prompt (and, for the
    pixel engine, the negative prompt and the LoRA settings) without
    drawing or charging anything. Reuses the art function's own real
    prompt-assembly logic rather than a second, client-side copy that
    could quietly drift out of sync with it. */
export async function previewArtPrompt(artId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/art`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ artId, dryRun: true }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not preview the prompt (${res.status})`)
  return body   // { engine, prompt, negative, settings? }
}

/** Admin only — retroactively generates endingScene or badgeEssence
    (whichever target is given) for a world built before those fields
    existed, and writes it straight into that one world_art row. Only
    changes the stored prompt text; a creator still needs to redraw from
    the Pictures tab to see it reflected in an actual image. */
export async function generateEndingArt(worldId, target) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-ending-art`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ worldId, target }),
  })
  const body2 = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body2.error || `Could not generate the prompt (${res.status})`)
  return body2   // { target, prompt }
}

/** Swaps image_prompt and prev_image_prompt for one art entry — the same
    undo/redo idea the image swap already uses, applied to prompt text
    instead of the picture itself. Calling it twice in a row is a no-op
    round trip, exactly like the image version. */
export async function undoArtPrompt(artId) {
  const { data: row, error: readError } = await supabase
    .from('world_art').select('image_prompt, prev_image_prompt').eq('id', artId).single()
  if (readError) throw readError
  const { error } = await supabase
    .from('world_art')
    .update({ image_prompt: row.prev_image_prompt ?? '', prev_image_prompt: row.image_prompt })
    .eq('id', artId)
  if (error) throw error
  return row.prev_image_prompt ?? ''
}

/** Admin only, enforced server-side regardless of what this function lets
    you attempt. Reads the file as a data URL client-side and posts it as
    JSON, matching every other call in this file — no multipart handling
    needed for something this small. Free, and participates in the same
    undo history as a normal draw. Returns { url, prev_url }. */
export async function uploadArt(artId, file) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/art-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ artId, image }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not upload (${res.status})`)
  return body   // { url, prev_url }
}

/** Undo and Redo are the same call: swaps current and previous for real,
    including the world's cover_path if this is the splash — so what
    swaps is what actually shows everywhere, not just this tab's preview.
    Free, instant. Throws if there is no previous version yet. */
export async function swapArtVersions(artId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/art-swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ artId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not switch pictures (${res.status})`)
  return body   // { url, prev_url }
}

export async function setArtLock(artId, locked) {
  const { error } = await supabase.from('world_art').update({ locked }).eq('id', artId)
  if (error) throw error
}

/* Art direction lives on the world so each creator can set their own.
   These mirror the defaults inside the art edge function; they are shown in
   the editor so the creator can see what they are changing rather than
   editing an empty box. */
export const ENGINES = [
  { key: 'pixel', label: 'Adventure v1', note: 'A sharper, more graphic look with a strong downscale pass. The look comes mostly from that last step.' },
  { key: 'flux', label: 'Adventure v2', note: 'Follows a written art direction closely and renders legible text.' },
]

export const DEFAULT_ART = {
  // which engine draws rooms and characters; items and splash screens are
  // always flux
  engine_room: 'pixel',
  engine_mob: 'pixel',

  // what to draw
  style_pixel: 'pixel art, detailed pixel art, muted earthy palette, atmospheric lighting,',
  style_flux:
    'Pixel art. Strictly limit to 4 colors. Strictly use patterns and dither to create shades. ' +
    'Strictly use 4 colors. No wide angle view and tiny objects. Closeup view.',
  room: 'wide establishing view of a place, no people, environmental scene,',
  mob: 'character portrait, single figure, head and shoulders, plain dark background,',
  item: 'one single isolated object, studio product shot, centred, filling the frame, ' +
        'flat plain dark background, nothing else in the picture,',
  cover: 'dramatic key art, cinematic composition, one striking image representing the game,',
  prop: 'a single fixed mechanism in place, close view, mounted or set into its surroundings, no hands, no people,',
  ending: 'a final, conclusive image, warm resolution, the story reaching its conclusion, cinematic composition,',
  badge: 'an achievement badge, emblem or medallion, centred, flat plain background, no scene, no figures,',

  // what to avoid
  neg: '3d render, realistic, photo, blurry, sketch, text, watermark, signature, lettering',
  neg_room: 'people, faces, figures, portrait, character',
  neg_ending: '',
  neg_badge: 'scenery, landscape, room, multiple objects, people, hands, spritesheet, grid, text, watermark',
  neg_mob: 'landscape, wide shot, crowd, multiple people, full body',
  neg_cover: '',
  neg_prop: 'hands, people, floating object, product shot on white, spritesheet, grid, multiple objects',
  neg_item: 'spritesheet, sprite sheet, tileset, grid, multiple objects, collection, set of items, ' +
            'inventory screen, user interface, HUD, menu, panel, frame, border, shelf, rack, ' +
            'chest of drawers, room, scenery, background detail, duplicate',
}

/* ---------- art-direction presets (readable by anyone, writable by admins) ---------- */

/** Full content. Only an admin's row can actually read this — RLS blocks
    everyone else outright. Used by the admin preset editor, and by the
    admin-only preview when an admin clicks a preset in their own Pictures
    tab. Never call this for a non-admin creator; it will simply fail. */
export async function loadArtPresets(engine) {
  const { data, error } = await supabase
    .from('art_presets')
    .select('id, label, config, sort_order, published')
    .eq('engine', engine)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function setArtPresetPublished(id, published) {
  const { error } = await supabase.from('art_presets').update({ published }).eq('id', id)
  if (error) throw error
}

/** Describe a problem in plain words; the model reads the world's own
    JSON, tries a fix, and it is only ever applied if it passes the same
    validator a freshly generated world has to pass. Costs a flat fee
    whether or not anything actually changed, since the model call happens
    either way. Returns { status: 'modified'|'unchanged', reply, world,
    cost_cents, balance_cents } — `world` is always the current data,
    whichever way it went, so the caller never needs a second fetch. */
export async function repairWorld(worldId, query) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/repair-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ worldId, query }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Could not repair (${res.status})`)
    err.needsFunds = Boolean(body.needs_funds)
    throw err
  }
  return body
}

/** id + label only, never config. Works for anyone signed in — this is
    what the Pictures tab's preset picker uses to build its button list,
    admin or not. The content itself is resolved server-side at draw time,
    with the service role, so a non-admin's browser never receives it. */
export async function loadArtPresetLabels(engine) {
  const { data, error } = await supabase.rpc('art_preset_labels', { p_engine: engine })
  if (error) throw error
  return data ?? []
}

/** One preset's full content, by id. Admin only — RLS refuses anyone
    else. Used for the read-only preview when an admin clicks a preset. */
export async function loadArtPresetContent(id) {
  const { data, error } = await supabase
    .from('art_presets').select('config').eq('id', id).single()
  if (error) throw error
  return data?.config ?? {}
}

export async function saveArtPreset({ id, engine, label, config, sortOrder }) {
  const row = { engine, label: label.trim(), config: config ?? {}, sort_order: sortOrder ?? 0 }
  if (!row.label) throw new Error('A preset needs a label.')

  if (id) {
    const { error } = await supabase.from('art_presets').update(row).eq('id', id)
    if (error) throw error
    return id
  }
  const { data: existing } = await supabase
    .from('art_presets').select('id').eq('engine', engine).ilike('label', row.label).limit(1)
  if (existing?.length) throw new Error('A preset with that label already exists for this engine.')

  const { data, error } = await supabase.from('art_presets').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

export async function deleteArtPreset(id) {
  const { error } = await supabase.from('art_presets').delete().eq('id', id)
  if (error) throw error
}

export async function loadDefaultArtPreset(engine) {
  const v = await loadSetting(`art_preset_default_${engine}`)
  return v?.id ?? null
}
export async function saveDefaultArtPreset(engine, id) {
  await saveSetting(`art_preset_default_${engine}`, { id })
}

export async function loadArtConfig(worldId) {
  const { data, error } = await supabase
    .from('worlds')
    .select('art_config')
    .eq('id', worldId)
    .single()
  if (error) throw error
  const saved = { ...(data?.art_config ?? {}) }
  // Worlds configured before the two-engine split stored one `style`.
  if (saved.style && !saved.style_pixel) saved.style_pixel = saved.style
  delete saved.style
  // DEFAULT_ART is deliberately NOT merged in here. This used to return
  // {...DEFAULT_ART, ...saved}, which meant every box the creator had
  // never touched silently showed the platform's own default wording —
  // even in Custom mode, whose entire point is that a blank box stays
  // blank and sends nothing. What actually gets sent when drawing
  // already resolves defaults correctly server-side; this was purely a
  // display bug, showing text that was never really what Custom would
  // have sent. DEFAULT_ART's only real job is in saveArtConfig below,
  // deciding what is redundant to persist — not deciding what a box
  // displays.
  return saved
}

export async function saveArtConfig(worldId, config) {
  // Store only what differs from the defaults, so a later change to the
  // defaults reaches worlds that never customised anything. An empty box is
  // only dropped when the default is empty too — otherwise clearing one
  // would silently restore the default rather than clearing it.
  const trimmed = {}
  for (const [k, v] of Object.entries(config)) {
    const value = (v ?? '').trim()
    const fallback = (DEFAULT_ART[k] ?? '').trim()
    if (value === fallback) continue
    trimmed[k] = value
  }
  const { error } = await supabase.from('worlds').update({ art_config: trimmed }).eq('id', worldId)
  if (error) throw error
}

export async function setArtPrompt(artId, image_prompt) {
  const { error } = await supabase.from('world_art').update({ image_prompt }).eq('id', artId)
  if (error) throw error
}
