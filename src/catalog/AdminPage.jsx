import React, { useState, useEffect } from "react";
import {
  PROVIDERS,
  loadReports,
  loadSetting,
  resolveReport,
  saveSetting,
  unpublishWorld,
} from "../lib/db";
import { T, inputStyle } from "../theme";
import { Btn, Empty, Field, H1 } from "../ui/primitives";

export function AdminPage({ me, go }) {
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
