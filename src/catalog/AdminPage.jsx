import React, { useState, useEffect } from "react";
import {
  PROVIDERS,
  deletePreset,
  loadDefaultBriefPreset,
  loadPresets,
  loadReports,
  loadSetting,
  resolveReport,
  saveDefaultBriefPreset,
  savePreset,
  saveSetting,
  unpublishWorld,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn, Empty, Field, H1 } from "../ui/primitives";

export function AdminPage({ me, go }) {
  const [tab, setTab] = useState("settings");
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

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid " + T.edge, marginBottom: 24 }}>
        {[["settings", "Settings"], ["world_building", "World building"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pf-btn"
            style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 14px",
              fontFamily: T.mono, fontSize: 12, color: tab === k ? T.bone : T.boneDim,
              boxShadow: tab === k ? "inset 0 -2px 0 " + T.ochre : "none" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "world_building" && <WorldBuildingTab />}

      {tab === "settings" && (!setting ? (
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
      ))}

      {tab === "settings" && error && (
        <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7,
          border: "1px solid " + T.clay + "44", padding: 12, borderRadius: 2, marginTop: 18 }}>
          {error}
        </p>
      )}

      {tab === "settings" && <ReportQueue me={me} />}
    </div>
  );
}

function WorldBuildingTab() {
  const [presetTab, setPresetTab] = useState("game_brief");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {[["game_brief", "Game brief presets"], ["game_details", "Game details presets"]].map(([k, label]) => (
          <button key={k} onClick={() => setPresetTab(k)} className="pf-btn"
            style={{ background: "none", border: "1px solid " + (presetTab === k ? T.ochre : T.edge),
              borderRadius: 2, cursor: "pointer", padding: "7px 12px", fontFamily: T.mono, fontSize: 11.5,
              color: presetTab === k ? T.bone : T.boneDim }}>
            {label}
          </button>
        ))}
      </div>
      <PresetList type={presetTab} />
    </div>
  );
}

function PresetList({ type }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [defaultId, setDefaultId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = () => {
    loadPresets(type).then(setRows).catch((e) => setError(e.message));
    if (type === "game_brief") loadDefaultBriefPreset().then(setDefaultId).catch(() => {});
  };
  useEffect(() => { refresh(); edit(null); }, [type]);

  const edit = (row) => {
    setEditing(row);
    setLabel(row?.label ?? "");
    setPrompt(row?.prompt ?? "");
    setError(null);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await savePreset({ id: editing?.id, type, label, prompt, sortOrder: editing?.sort_order ?? (rows?.length ?? 0) });
      refresh();
      edit(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    setBusy(true); setError(null);
    try {
      await deletePreset(row.id);
      refresh();
      if (editing?.id === row.id) edit(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (row) => {
    setBusy(true);
    try {
      await saveDefaultBriefPreset(row.id);
      setDefaultId(row.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const purpose = type === "game_brief"
    ? "Sent to the AI to write a fresh game brief every time this preset is used. The picker in " +
      "Create step 1 is admin-only; a creator who is not an admin gets the platform default, marked " +
      "below, or a random one if no default is set."
    : "Stored for the story-fleshing stage. Not consumed by anything yet \u2014 the current pipeline " +
      "goes straight from a brief to a built world with no separate detailing step.";

  return (
    <div>
      <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "0 0 20px" }}>
        {purpose}
      </p>

      {rows === null ? (
        <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ border: "1px solid " + (defaultId === r.id ? T.ochre : T.edge),
              borderRadius: 2, padding: "10px 14px", marginBottom: 8,
              display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.serif, fontSize: 15, display: "flex", alignItems: "baseline", gap: 8 }}>
                  {r.label}
                  {defaultId === r.id && (
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.ochre }}>default</span>
                  )}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.prompt}
                </div>
              </div>
              {type === "game_brief" && defaultId !== r.id && (
                <Btn kind="ghost" disabled={busy} onClick={() => makeDefault(r)}>make default</Btn>
              )}
              <Btn kind="ghost" onClick={() => edit(r)}>edit</Btn>
              <Btn kind="danger" disabled={busy} onClick={() => remove(r)}>delete</Btn>
            </div>
          ))}
          {!rows.length && (
            <p style={{ fontFamily: T.mono, fontSize: 12, color: T.boneDim }}>No presets yet.</p>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid " + T.edge, paddingTop: 18 }}>
        <div style={{ fontFamily: T.serif, fontSize: 16, marginBottom: 12 }}>
          {editing ? `Editing "${editing.label}"` : "New preset"}
        </div>

        <Field label="Preset label" hint="Shown in the admin list and, for brief presets, in Create step 1.">
          <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Lighthouse keeper" maxLength={100} />
        </Field>

        <Field label="Preset prompt"
          hint={type === "game_brief"
            ? "Instructions for the AI, not a finished brief. It writes a new one from this every time."
            : "Instructions for the detailing stage, once one exists."}>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={8} maxLength={2000}
            style={{ ...inputStyle, lineHeight: 1.6, resize: "vertical" }} />
        </Field>

        {error && (
          <p style={{ fontFamily: T.mono, fontSize: 11.5, color: T.clay, marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Btn kind="solid" disabled={busy || !label.trim() || prompt.trim().length < 20} onClick={save}>
            {editing ? "Save" : "Add"}
          </Btn>
          {editing && <Btn kind="ghost" onClick={() => edit(null)}>Cancel</Btn>}
        </div>
      </div>
    </div>
  );
}

/* ---------- becoming a creator ---------- */

export function ReportQueue({ me }) {
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
