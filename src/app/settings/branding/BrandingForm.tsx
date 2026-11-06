"use client";

import { useActionState, useState } from "react";
import { saveBrandingAction, uploadLogoAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

function Message({ state }: { state: FormState }) {
  if (state.status === "idle") return null;
  return (
    <p className={`note ${state.status === "ok" ? "ok" : "error"}`} role={state.status === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}

export function BrandingForm(props: {
  displayName: string;
  accentColour: string;
  poweredByVisible: boolean;
  canHidePoweredBy: boolean;
  hasLogo: boolean;
  hostname: string;
}) {
  const [brandState, saveBrand, savingBrand] = useActionState(saveBrandingAction, initial);
  const [logoState, uploadLogo, uploadingLogo] = useActionState(uploadLogoAction, initial);
  const [name, setName] = useState(props.displayName);
  const [accent, setAccent] = useState(props.accentColour);
  const [powered, setPowered] = useState(props.poweredByVisible);
  const validHex = /^#[0-9a-fA-F]{6}$/.test(accent);

  return (
    <div className="split">
      <div className="main stack">
        <form action={saveBrand} className="stack panel">
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Name and colour</h2>
          <label>
            Display name
            <input type="text" name="displayName" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            <span className="hint">Shown to your clients on every screen, email and document.</span>
          </label>
          <label htmlFor="accentText">
            Brand colour
            <span className="swatch-row">
              <input
                type="color"
                aria-label="Pick brand colour"
                value={validHex ? accent : "#1b68ea"}
                onChange={(e) => setAccent(e.target.value)}
              />
              <input
                id="accentText"
                type="text"
                name="accentColour"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                pattern="#[0-9a-fA-F]{6}"
                maxLength={7}
                required
                style={{ maxWidth: 140, fontFamily: "var(--mono)" }}
              />
            </span>
            <span className="hint">Used for buttons and highlights. It must be dark enough for white text to read clearly.</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="poweredByVisible"
              checked={props.canHidePoweredBy ? powered : true}
              disabled={!props.canHidePoweredBy}
              onChange={(e) => setPowered(e.target.checked)}
            />
            <span>
              Show "Powered by ScopeFlow" to clients
              {!props.canHidePoweredBy ? <span className="hint"> (can be removed on the white-label plan)</span> : null}
            </span>
          </label>
          {/* A disabled checkbox isn't submitted; keep the credit on for plans that can't hide it. */}
          {!props.canHidePoweredBy ? <input type="hidden" name="poweredByVisible" value="on" /> : null}
          <Message state={brandState} />
          <div>
            <button type="submit" className="btn solid" disabled={savingBrand}>
              {savingBrand ? "Saving…" : "Save branding"}
            </button>
          </div>
        </form>

        <form action={uploadLogo} className="stack panel">
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Logo</h2>
          <label>
            Logo file
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required />
            <span className="hint">PNG, JPEG or WebP, up to 512 KB. A wide logo on a transparent background works best.</span>
          </label>
          <Message state={logoState} />
          <div>
            <button type="submit" className="btn solid" disabled={uploadingLogo}>
              {uploadingLogo ? "Uploading…" : "Upload logo"}
            </button>
          </div>
        </form>
      </div>

      <aside className="side">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          What your clients see
        </div>
        <div className="preview" style={{ ["--accent" as string]: validHex ? accent : undefined }}>
          <div className="preview-head">
            {props.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/logo" alt="" style={{ height: 28, width: "auto", maxWidth: 120 }} />
            ) : (
              <span className="brand-mark" aria-hidden="true" style={{ width: 28, height: 28 }}>
                {name.trim().charAt(0).toUpperCase() || "S"}
              </span>
            )}
            <span className="brand-name" style={{ fontSize: 18 }}>
              {name || "Your company"}
            </span>
          </div>
          <div className="preview-body">
            <div className="eyebrow">Decision needed · CR-012</div>
            <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 22, lineHeight: 1.1 }}>
              Split-tender payment at checkout
            </div>
            <span className="btn accent" aria-hidden="true">
              Approve assessment R2
            </span>
            <span className="btn" aria-hidden="true">
              Ask a question first
            </span>
          </div>
          <div className="preview-foot" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontFamily: "var(--mono)" }}>{props.hostname}</span>
            {(props.canHidePoweredBy ? powered : true) ? <span>Powered by ScopeFlow</span> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
