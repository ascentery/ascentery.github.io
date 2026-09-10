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
    supabase.from('profiles').select('id, display_name, gamer_tag, username, is_creator, is_admin').eq('id', userId).single(),
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
    balance: credits?.balance_cents ?? 0,
    balanceCap: credits?.cap_cents ?? 500,
  }
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
    .select('world_id, character_id, state, log')
    .eq('user_id', userId)
  if (error) throw error

  const map = {}
  for (const row of data ?? []) {
    map[`${row.world_id}:${row.character_id}`] = { state: row.state, log: row.log }
  }
  return map
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

export async function signUp({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || 'New player' } },
  })
  if (error) throw error
  // With email confirmation on, session is null until they click the link.
  return { needsConfirmation: !data.session }
}

export async function signIn({ email, password }) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut()
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
    .select('id, owner_id, title, brief, blurb, status, published, plays, room_count, mob_count, cover_path, failure_note, created_at, updated_at')
    .or(`published.eq.true,owner_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  if (error) throw error

  const ownerIds = [...new Set((data ?? []).map((w) => w.owner_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, gamer_tag, username')
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
    tag: byId[w.owner_id]?.gamer_tag ?? '',
    playable: w.status === 'ready',
  }))
}

export async function loadWorldData(worldId) {
  const { data, error } = await supabase
    .from('world_data')
    .select('data, warnings')
    .eq('world_id', worldId)
    .single()
  if (error) throw new Error('That world has no data yet.')
  return data
}

/** What building a world costs. Mirrors the generate function; a flat fee
    for the map and plot passes, plus the prose pass which grows with rooms. */
export const GEN_BASE_CENTS = 10
export const GEN_PER_ROOM_CENTS = 2
export const genCost = (rooms) => GEN_BASE_CENTS + GEN_PER_ROOM_CENTS * rooms

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
  const { count, error } = await supabase
    .from('world_art')
    .select('id', { count: 'exact', head: true })
    .eq('world_id', worldId)
    .is('image_path', null)
  if (error) throw error
  return (count ?? 0) === 0
}

/** Polls gen_stage while a world is being built, so progress can be shown
    honestly instead of guessed at with a timer. Stops itself once the
    world leaves "generating", however that happens. */
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

export async function createWorld({ userId, title, brief, roomMin = null, roomMax = null }) {
  const { data, error } = await supabase
    .from('worlds')
    .insert({
      owner_id: userId, title, brief, status: 'generating',
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
export async function generateBriefFromPreset(presetId = null) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(presetId ? { presetId } : {}),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not generate a brief (${res.status})`)
  return body   // { title, brief, preset_label }
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

/* ---------- usernames ---------- */

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
    .select('id, kind, entity_key, name, image_prompt, image_path, bucket, locked, sort, orphaned_at')
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
    url: artUrl(r.image_path, r.bucket ?? 'art'),
    art: Boolean(r.image_path),
    locked: r.locked,
    orphaned: Boolean(r.orphaned_at),
  }))
}

/** Draws one entry. 20-60 seconds, and costs real money.
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

export async function setArtLock(artId, locked) {
  const { error } = await supabase.from('world_art').update({ locked }).eq('id', artId)
  if (error) throw error
}

/* Art direction lives on the world so each creator can set their own.
   These mirror the defaults inside the art edge function; they are shown in
   the editor so the creator can see what they are changing rather than
   editing an empty box. */
export const ENGINES = [
  { key: 'pixel', label: 'Pixel LoRA', note: 'SDXL with the pixel-art-xl LoRA, then a downscale pass. The look comes mostly from that last step.' },
  { key: 'flux', label: 'Flux 2 flex', note: 'No LoRA and no post-processing. Follows a written art direction closely and renders legible text.' },
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
  cover: '',
  prop: 'a single fixed mechanism in place, close view, mounted or set into its surroundings, no hands, no people,',

  // what to avoid
  neg: '3d render, realistic, photo, blurry, sketch, text, watermark, signature, lettering',
  neg_room: 'people, faces, figures, portrait, character',
  neg_mob: 'landscape, wide shot, crowd, multiple people, full body',
  neg_cover: '',
  neg_prop: 'hands, people, floating object, product shot on white, spritesheet, grid, multiple objects',
  neg_item: 'spritesheet, sprite sheet, tileset, grid, multiple objects, collection, set of items, ' +
            'inventory screen, user interface, HUD, menu, panel, frame, border, shelf, rack, ' +
            'chest of drawers, room, scenery, background detail, duplicate',
}

/* ---------- art-direction presets (readable by anyone, writable by admins) ---------- */

export async function loadArtPresets(engine) {
  const { data, error } = await supabase
    .from('art_presets')
    .select('id, label, config, sort_order')
    .eq('engine', engine)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
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
  return { ...DEFAULT_ART, ...saved }
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
