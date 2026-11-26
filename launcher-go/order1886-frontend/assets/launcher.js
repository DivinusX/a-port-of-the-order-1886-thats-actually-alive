// SPDX-License-Identifier: GPL-2.0-or-later
// The Order: 1886 launcher window. Plain ES module, no build step: the packaging script copies
// launcher-go/order1886-frontend into the Wails dist as it is (packaging/windows/order1886-go-build.ps1).
//
// The worker (launcher/order1886_worker.py) owns every setting. This file only shows them:
// pages and their sections come from snapshot.pages, fields from snapshot.fields, each with a
// page, section, one-line summary, description ("More information"), advanced flag (inside the
// page's collapsed Advanced section) and depends_on (shown while that boolean setting is on).
//
// Backend bridge (window.go.main.App, Wails): Call(method, params) for worker requests
// (state.get, settings.set, settings.reset, session.start/stop, saves.*, cache.clear, verify,
// prepare, shortcut.create, steam.add); UpdateState/Check/Download/Cancel/Install/Restore; Browse;
// OpenLink; OpenLocation; StartupError; ConfirmClose. Events: update, worker, close-requested.

// ---- State ------------------------------------------------------------------------------------
let snapshot = null;        // the worker's state.get answer
let page = "home";
let query = "";             // search text
let selectedBackup = "";
let feedback = "";          // status line text
let feedbackError = false;
let starting = false;       // a session is being started
let disconnected = false;   // the worker connection was lost
let pendingSaves = 0;       // settings.set requests in flight
let update = null;          // normalised updater state
let confirmResolve = null;  // the open confirmation dialog's resolver
let advancedOpen = false;   // System > Advanced expanded
const openDetails = new Set(); // "More information" panels the player opened

const root = document.querySelector("#app");

const ICONS = {
    achievements: "M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v7m-4 0h8",
    search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
};

// ---- Helpers ----------------------------------------------------------------------------------
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const t = (text) => snapshot?.translations?.[text] ?? text;
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] ?? ""}"/></svg>`;

function bridge() {
    if (!window.go?.main.App) {
        throw new Error("The desktop worker bridge is unavailable. Open the installed launcher.");
    }
    return window.go.main.App;
}

async function call(method, params = {}) {
    return JSON.parse(await bridge().Call(method, params));
}

const locked = () => Boolean(snapshot?.busy || starting || disconnected || pendingSaves);

function setFeedback(text, error = false) {
    feedback = text;
    feedbackError = error;
    const node = document.querySelector("#feedback");
    if (node) {
        node.textContent = text;
        node.classList.toggle("error", error);
    }
}

function statusWord() {
    return t(disconnected ? "Connection lost" : snapshot.busy ? "Running" : starting ? "Starting…" : "Idle");
}

function statusText() {
    if (feedbackError) return feedback;
    if (pendingSaves) return t("Saving settings…");
    return feedback || t(snapshot.busy ? "Session running. Settings are locked." : "Changes are saved automatically.");
}

/// The worker's exit report -> a message (exit 130 and a requested stop are a normal stop).
function sessionResult(done, logfile) {
    if (!Array.isArray(done) || typeof done[0] !== "number" || !Number.isInteger(done[0])) {
        return { message: "The backend ended without a valid exit status.", failed: true };
    }
    const [code, mode, stopped] = done;
    if (code === 130 || stopped === true) return { message: "Session stopped.", failed: false };
    if (code !== 0) {
        return { message: `Session failed (exit ${code}). Log: ${logfile || "Open player data to inspect the session logs."}`, failed: true };
    }
    return {
        message: mode === "verify" ? "Verification completed." : mode === "prepare" ? "Preparation completed." : "Session ended.",
        failed: false,
    };
}

function reportSession(done) {
    const result = sessionResult(done, snapshot.logfile);
    setFeedback(t(result.message), result.failed);
}

/// Replaces the window's HTML while keeping focus and the content's scroll position.
function replaceView(html) {
    const content = root.querySelector("#content");
    const top = content?.scrollTop ?? 0;
    const active = document.activeElement;
    const focusId = active && root.contains(active) ? active.id : "";
    root.innerHTML = html;
    const focus = focusId ? document.getElementById(focusId) : null;
    if (focus && root.contains(focus)) focus.focus({ preventScroll: true });
    const next = root.querySelector("#content");
    if (next) next.scrollTop = top;
}

// ---- Confirmation dialog ----------------------------------------------------------------------
function confirmAction(title, detail, action = "Confirm") {
    const dialog = document.querySelector("#confirm");
    dialog.querySelector("#confirm-title").textContent = title;
    dialog.querySelector("#confirm-detail").textContent = detail;
    dialog.querySelector("#confirm-yes").textContent = action;
    dialog.showModal();
    return new Promise((resolve) => { confirmResolve = resolve; });
}

function finishConfirmation(value) {
    document.querySelector("#confirm")?.close();
    confirmResolve?.(value);
    confirmResolve = null;
}

function bindConfirmation() {
    document.querySelector("#confirm-no").addEventListener("click", () => finishConfirmation(false));
    document.querySelector("#confirm-yes").addEventListener("click", () => finishConfirmation(true));
    document.querySelector("#confirm").addEventListener("cancel", (event) => {
        event.preventDefault();
        finishConfirmation(false);
    });
}

// ---- Updates ----------------------------------------------------------------------------------
function normaliseUpdate(raw) {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw ?? {};
    return {
        state: s.state ?? "idle", version: s.version ?? "", downloaded: s.downloaded ?? 0,
        total: s.total ?? 0, channel: s.channel ?? "preview", automatic: s.automatic ?? false,
        error: s.error ?? "", recovery_pending: s.recovery_pending ?? false,
        recovery_blocked: s.recovery_blocked ?? false, rollback_available: s.rollback_available ?? false,
        install_available: s.install_available ?? false, install_reason: s.install_reason ?? "",
        supported: s.supported ?? true,
    };
}

async function refreshUpdate() {
    try {
        update = normaliseUpdate(await bridge().UpdateState());
    } catch {
        // keep the last known state: a failed poll must not collapse the panel (#60)
    }
    return update;
}

const megabytes = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + " MB";
const percent = (u) => (u.total ? Math.min(100, Math.round((u.downloaded / u.total) * 100)) : 0);

function updateHeadline(u) {
    if (!u) return t("Update state unavailable");
    if (u.recovery_blocked) return t("An interrupted update needs your decision");
    if (u.recovery_pending) return t("Restoring the previous version");
    switch (u.state) {
    case "checking": return t("Checking for updates…");
    case "available": return `${t("Update available")}: ${u.version}`;
    case "current": return `${t("Up to date")}: ${u.version}`;
    case "downloading": return `${t("Downloading")} ${percent(u)}%`;
    case "staged": return `${t("Ready to install")}: ${u.version}`;
    case "failed": return t("Update failed");
    default: return t("No update checked yet");
    }
}

function updatePanel(u, busy) {
    if (u && u.supported === false) return "";
    const active = u?.state === "checking" || u?.state === "downloading";
    const blocked = busy || u === null || active;
    const recovery = (u?.recovery_blocked ?? false) || (u?.recovery_pending ?? false);
    const buttons = [`<button data-action="update.check"${blocked ? " disabled" : ""}>${escape(t("Check for updates"))}</button>`];
    if (u?.state === "available") buttons.push(`<button data-action="update.download"${blocked ? " disabled" : ""}>${escape(t("Download update"))}</button>`);
    if (u?.state === "downloading") buttons.push(`<button data-action="update.cancel"${busy ? " disabled" : ""}>${escape(t("Cancel download"))}</button>`);
    if (u?.state === "staged" && u.install_available) buttons.push(`<button class="danger" data-action="update.install"${blocked ? " disabled" : ""}>${escape(t("Install and restart"))}</button>`);
    if (recovery) {
        buttons.push(`<button class="danger" data-action="update.restore"${busy ? " disabled" : ""}>${escape(t("Restore previous version"))}</button>`);
    } else if (u?.rollback_available) {
        buttons.push(`<button data-action="update.restore"${busy ? " disabled" : ""}>${escape(t("Roll back this update"))}</button>`);
    }
    buttons.push(`<button data-link="releases">${escape(t("View releases"))}</button>`);
    const progress = u?.state === "downloading"
        ? `<progress value="${u.downloaded}" max="${u.total || 1}"></progress><p class="quiet-copy">${escape(megabytes(u.downloaded))} / ${escape(megabytes(u.total))}</p>`
        : "";
    const reason = u?.state === "staged" && !u.install_available ? `<p class="availability">${escape(t(u.install_reason))}</p>` : "";
    const error = u?.error ? `<p role="alert" class="error">${escape(u.error)}</p>` : "";
    return `<h2>${escape(t("Updates"))}</h2>
  <p><strong>${escape(updateHeadline(u))}</strong></p>
  <p class="quiet-copy">${escape(t("Channel"))}: ${escape(t(u?.channel === "stable" ? "Stable — released builds only" : "Preview — every published Go preview"))}
  · ${escape(t(u?.automatic ? "Checked on start" : "Checked only when you ask"))}</p>
  <p class="quiet-copy">${escape(t("An update replaces only launcher files. Saves, settings, mods and patches are preserved, and an interrupted update is restored before the launcher starts."))}</p>
  ${progress}${reason}${error}
  <div class="actions">${buttons.join("")}</div>`;
}

// ---- Settings ---------------------------------------------------------------------------------
const valueOf = (field) => snapshot.settings[field.key] ?? field.default;

/// A field is shown when it is available, its kind has a control, and the setting it depends on
/// is on. Catalogued patches are listed by the patch catalogue instead of a control.
function shown(field) {
    if (!field.available || field.kind === "patches") return false;
    if (field.depends_on) {
        const parent = snapshot.fields.find((f) => f.key === field.depends_on);
        if (parent && !(snapshot.settings[parent.key] ?? parent.default)) return false;
    }
    return true;
}

function control(field) {
    const value = valueOf(field);
    const disabled = !field.available || snapshot.busy || starting || disconnected ? " disabled" : "";
    const attrs = `id="field-${field.key}" data-setting="${field.key}" aria-describedby="help-${field.key}"`;
    switch (field.kind) {
    case "boolean":
        return `<input type="checkbox" ${attrs}${disabled}${value ? " checked" : ""}>`;
    case "select":
        return `<select ${attrs}${disabled}>${field.choices.filter((c) => c.available || value === c.value).map((c) =>
            `<option value="${escape(String(c.value))}"${value === c.value ? " selected" : ""}${c.available ? "" : " disabled"}>${escape(t(c.label))}${c.available ? "" : " — " + escape(t("Unavailable"))}</option>`).join("")}</select>`;
    case "bindings":
        return bindingControl(field, value, disabled);
    case "order":
        return `<textarea ${attrs}${disabled} rows="3" spellcheck="false">${escape(value.join("\n"))}</textarea>`;
    case "number":
        return `<input type="number" ${attrs}${disabled} value="${escape(value)}" min="${field.minimum}" max="${field.maximum}" step="${field.multiple ?? 1}">`;
    case "secret":
        return `<input type="password" ${attrs}${disabled} value="${escape(value)}" autocomplete="off" spellcheck="false">`;
    default: {
        const browse = ["directory", "file"].includes(field.kind)
            ? `<button data-browse="${field.key}"${disabled} aria-label="${escape(t("Browse") + " " + t(field.label))}">${escape(t("Browse"))}</button>` : "";
        const clear = field.key === "runtime" && value
            ? `<button data-clear="runtime"${disabled}>${escape(t("Use installation runtime"))}</button>` : "";
        return `<div class="path-input"><input type="text" ${attrs}${disabled} value="${escape(value)}" autocomplete="off" spellcheck="false">${browse}${clear}</div>`;
    }
    }
}

function bindingControl(field, value, disabled) {
    const mapping = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const rows = field.buttons.map((button) => {
        const id = `field-${field.key}-${button.id}`;
        const selected = typeof mapping[button.id] === "string" ? mapping[button.id] : "";
        const known = field.choices.some((c) => c.value === selected);
        const fallback = button.default.length ? button.default.join(" / ")
            : field.reason ? ""
                : field.input_kind === "controller" && ["l2", "r2"].includes(button.id) ? t("Physical trigger remains active")
                    : t("No digital source");
        return `<label for="${id}">${escape(t(button.label))}</label><select id="${id}" data-setting="${field.key}" data-binding="${button.id}" aria-describedby="help-${field.key}"${disabled}>
     <option value=""${selected ? "" : " selected"}>${escape(t("Default"))}${fallback ? " (" + escape(fallback) + ")" : ""}</option>
     ${selected && !known ? `<option value="${escape(selected)}" selected disabled>${escape(selected)} — ${escape(t("Unavailable"))}</option>` : ""}
     ${field.choices.map((c) => `<option value="${escape(c.value)}"${selected === c.value ? " selected" : ""}${c.available ? "" : " disabled"}>${escape(t(c.label))}${c.available ? "" : " — " + escape(t("Unavailable"))}</option>`).join("")}</select>`;
    }).join("");
    return `<fieldset id="field-${field.key}" class="binding-grid" aria-describedby="help-${field.key}"><legend class="sr-only">${escape(t(field.label))}</legend>${rows}</fieldset>`;
}

/// One setting: label, the one-line summary, the full description behind "More information".
function fieldRow(field) {
    const summary = field.summary || field.description;
    const more = field.summary && field.description && field.description !== field.summary
        ? `<details class="more" data-more="${field.key}"${openDetails.has(field.key) ? " open" : ""}><summary>${escape(t("More information"))}</summary><p>${escape(t(field.description))}</p></details>`
        : "";
    const heading = field.kind === "bindings"
        ? `<h2>${escape(t(field.label))}</h2>`
        : `<label for="field-${field.key}">${escape(t(field.label))}</label>`;
    return `<div class="setting-row${field.kind === "bindings" ? " binding-row" : ""}${field.depends_on ? " dependent" : ""}" data-field-row="${field.key}">
  <div class="setting-copy">${heading}
  <p id="help-${field.key}">${escape(t(summary))}</p>${more}
  ${field.reason ? `<p class="availability">${escape(t(field.reason))}</p>` : ""}</div>
  <div class="setting-control">${control(field)}</div></div>`;
}

function sectionBlock(title, fields, extra = "") {
    if (!fields.length && !extra) return "";
    return `<section class="settings-section"><h2 class="section-title">${escape(t(title))}</h2>
 ${fields.length ? `<div class="rows">${fields.map(fieldRow).join("")}</div>` : ""}${extra}</section>`;
}

function actionButton(action, title, destructive = false) {
    return `<button data-action="${action}" class="${destructive ? "danger" : ""}"${locked() ? " disabled" : ""}>${escape(t(title))}</button>`;
}

// ---- Page parts -------------------------------------------------------------------------------
function timingPanel(timing) {
    if (!timing) return "";
    if (timing.error) return `<div class="utility-section"><h2>${escape(t("Timing"))}</h2><p role="alert" class="error">${escape(timing.error)}</p></div>`;
    const limit = timing.fps_limit === null ? t("uncapped") : `${timing.fps_limit} FPS`;
    const vblank = timing.vblank_hz ? `${timing.vblank_hz} Hz` : t("uncapped");
    return `<div class="utility-section"><h2>${escape(t("Resolved timing"))}</h2><dl class="locations">
 <dt>${escape(t("Game frame rate"))}</dt><dd>${timing.engine_fps} FPS</dd>
 <dt>${escape(t("Presentation cap"))}</dt><dd>${timing.fps_cap} FPS</dd>
 <dt>${escape(t("Effective limit"))}</dt><dd>${escape(limit)}</dd>
 <dt>${escape(t("VBlank"))}</dt><dd>${escape(vblank)}</dd>
 <dt>${escape(t("VSync"))}</dt><dd>${escape(timing.vsync ? t("On") : t("Off"))}</dd></dl>
 <p class="quiet-copy">${escape(t("These are the values the next launch will ask for, not measured performance."))}</p></div>`;
}

function patchCatalogue(patches) {
    if (!patches || patches.length === 0) return "";
    return `<div class="utility-section"><h2>${escape(t("Catalogued patches"))}</h2>
  <p class="quiet-copy">${escape(t("Recipes that edit the prepared image. A recipe applies only to the exact build it was verified against, and the game folder is never modified."))}</p>
  <ol class="trophy-list">${patches.map((p) => `<li>
   <strong>${escape(p.title)}</strong>${p.builtin ? " · " + escape(t("configured elsewhere")) : ""}
   <p>${escape(p.description)}</p>
   ${p.reason ? `<p class="availability">${escape(p.reason)}</p>` : ""}
   ${p.warning ? `<p class="availability">${escape(p.warning)}</p>` : ""}</li>`).join("")}</ol></div>`;
}

function savesPanel() {
    return `<section class="settings-section"><h2 class="section-title">${escape(t("Saves"))}</h2>
 <div class="utility-section">
 <p>${escape(t("Saves folder"))}: <code>${escape(snapshot.saves_dir)}</code></p>
 <p>${escape(t("Import copies saves from another installation, a save backup or a decrypted save folder. Current saves are backed up first; saves with the same name are replaced."))}</p>
 <div class="actions"><button data-location="saves">${escape(t("Open saves folder"))}</button>${actionButton("saves.import", "Import saves…")}</div>
 <h2>${escape(t("Save backups"))}</h2>
 <p>${escape(t("Use current saves, or choose a complete backup to restore before Play. Current saves are backed up before replacement."))}</p>
 <label for="backup">${escape(t("Selected backup"))}</label><select id="backup"${snapshot.busy ? " disabled" : ""}>
 <option value="">${escape(t("Use current saves"))}</option>${snapshot.backups.map((name) => `<option${selectedBackup === name ? " selected" : ""}>${escape(name)}</option>`).join("")}</select>
 <p id="backup-detail">${escape(t(selectedBackup ? "Play will ask to restore the selected backup first." : "Play uses the current save data."))}</p>
 <div class="actions">${actionButton("saves.backup", "Back up saves now")}${actionButton("saves.restore", "Restore selected backup", true)}</div>
 </div></section>`;
}

function trophyDate(seconds, language) {
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8.64e12) return null;
    const locales = { en: "en", ru: "ru", ar: "ar", es: "es", pt: "pt-BR", fr: "fr", de: "de", it: "it", pl: "pl", tr: "tr", zh: "zh-Hans", ja: "ja", ko: "ko" };
    const date = new Date(seconds * 1000);
    return { iso: date.toISOString(), text: new Intl.DateTimeFormat(locales[language] ?? "en", { dateStyle: "medium", timeStyle: "short" }).format(date) };
}

/// Earned trophies merged into the installed catalogue (an earned id missing from it still shows).
function trophyRows(earned, catalog = []) {
    const rows = new Map(catalog.map((item) => [item.id, { ...item, unlocked_at: undefined }]));
    for (const item of earned) {
        rows.set(item.id, { ...rows.get(item.id), id: item.id, icon: rows.get(item.id)?.icon ?? "", unlocked_at: item.unlocked_at });
    }
    return [...rows.values()].sort((a, b) => a.id - b.id);
}

function achievementsPanel(fields) {
    const catalog = snapshot.trophy_catalog ?? [];
    const rows = trophyRows(snapshot.trophies, catalog);
    const earned = new Set(snapshot.trophies.map((item) => item.id));
    const count = catalog.filter((item) => earned.has(item.id)).length;
    const progress = snapshot.trophy_error
        ? `<p role="alert" class="error">${escape(snapshot.trophy_error)}</p>`
        : catalog.length ? `<p id="achievement-progress">${count} / ${catalog.length} ${escape(t("installed achievements earned"))}</p><progress value="${count}" max="${catalog.length}" aria-labelledby="achievement-progress"></progress>` : "";
    const list = rows.length ? `<ol class="trophy-list">${rows.map((item) => {
        const date = item.unlocked_at === undefined ? null : trophyDate(item.unlocked_at, snapshot.settings.ui_language);
        const status = snapshot.trophy_error ? "Unlock status unavailable" : item.unlocked_at === undefined ? "Locked" : "Unlocked";
        const name = item.name ? escape(item.name) : item.hidden && item.unlocked_at === undefined ? escape(t("Hidden trophy")) : `${escape(t("Trophy"))} ${item.id}`;
        const grade = item.grade ? escape(t(item.grade[0].toUpperCase() + item.grade.slice(1))) + " · " : "";
        const art = item.icon ? `<img src="${escape(item.icon)}" alt="" width="64" height="64" loading="lazy" decoding="async">` : `<span class="trophy-placeholder" aria-hidden="true">${icon("achievements")}</span>`;
        const when = date ? `<time datetime="${date.iso}">${escape(date.text)}</time>` : item.unlocked_at !== undefined ? `<span class="quiet-copy">${escape(t("Unlock time unavailable"))}</span>` : "";
        return `<li>${art}<div class="trophy-copy"><strong>${name}</strong>${item.detail ? `<span>${escape(item.detail)}</span>` : ""}<span>${grade}${escape(t(status))}</span></div>${when}</li>`;
    }).join("")}</ol>` : `<p class="empty-state">${escape(t("No earned trophies recorded yet. Unlocks appear here when the game writes them."))}</p>`;
    return `<section class="settings-section"><h2 class="section-title">${escape(t("Achievements"))}</h2>
 <p class="quiet-copy">${escape(t("Local unlock history and artwork from your installed game. Names and descriptions are decrypted from your game with your own trophy key. Locked artwork stays hidden."))}</p>
 ${progress}${snapshot.trophy_catalog_error ? `<p class="quiet-copy">${escape(t(snapshot.trophy_catalog_error))}</p>` : ""}
 ${fields.length ? `<div class="rows">${fields.map(fieldRow).join("")}</div>` : ""}
 ${list}</section>`;
}

function systemTools() {
    return `<section class="settings-section"><h2 class="section-title">${escape(t("Installation tools"))}</h2>
 <div class="utility-section">
 <div class="actions">${actionButton("verify", "Verify files")}${actionButton("prepare", "Prepare game")}${actionButton("cache.clear", "Clear shader cache", true)}
 ${actionButton("shortcut.create", "Create desktop shortcut")}${actionButton("steam.add", "Add to Steam")}</div>
 </div></section>
 <section class="settings-section"><h2 class="section-title">${escape(t("Updates and support"))}</h2>
 <div class="utility-section">${updatePanel(update, locked())}
 <h2>${escape(t("Report an issue"))}</h2>
 <div class="actions"><button data-link="issues">${escape(t("Report an issue"))}</button><button data-location="installation">${escape(t("Open installation"))}</button><button data-location="state">${escape(t("Open player data"))}</button><button data-location="logs">${escape(t("Open logs"))}</button></div>
 <dl class="locations"><dt>${escape(t("Player data"))}</dt><dd>${escape(snapshot.state_dir)}</dd><dt>${escape(t("Session log"))}</dt><dd>${escape(snapshot.logfile || t("No session yet"))}</dd></dl>
 <details><summary>${escape(t("Session output"))}</summary><pre id="session-output" tabindex="0">${escape(snapshot.logs.join("") || t("No session output yet."))}</pre></details>
 </div></section>`;
}

// ---- Pages ------------------------------------------------------------------------------------
function chip(target, label, value, extraClass = "") {
    return `<button class="chip${extraClass}" data-page="${target}"><span>${escape(t(label))}</span><strong>${escape(value)}</strong></button>`;
}

function choiceLabel(key) {
    const field = snapshot.fields.find((f) => f.key === key);
    const value = snapshot.settings[key] ?? field?.default;
    return field?.choices?.find((c) => c.value === value)?.label ?? String(value ?? "");
}

function homePage() {
    const settings = snapshot.settings;
    const ready = snapshot.game.ready;
    const meta = snapshot.game.metadata ?? {};
    const pill = snapshot.busy || starting
        ? `<span class="status-pill running">${escape(statusWord())}</span>`
        : `<span class="status-pill ${ready ? "ready" : ""}">${escape(t(ready ? "Game files found" : "Setup required"))}</span>`;
    const language = snapshot.fields.find((f) => f.key === "game_language" && f.available);
    const languageValue = settings.game_language ?? "follow";
    const languageLabel = language
        ? languageValue === "follow" ? snapshot.languages?.[settings.ui_language] ?? "" : language.choices?.find((c) => c.value === languageValue)?.label ?? ""
        : "";
    const updateNotice = update && (["available", "staged", "downloading", "failed"].includes(update.state) || update.recovery_blocked)
        ? `<div class="home-update" aria-live="polite"><strong>${escape(updateHeadline(update))}</strong>
  ${update.error ? `<span role="alert" class="error">${escape(update.error)}</span>` : ""}
  <button data-page="system">${escape(t("Open updates"))}</button></div>` : "";
    const hdrField = snapshot.fields.find((f) => f.key === "hdr" && f.available);
    return `<section class="home" aria-labelledby="home-title">
 <div class="home-main">${pill}
  <h1 id="home-title">${escape(t("Return to Whitechapel"))}</h1>
  <p>${escape(t("Your game. Your settings. Ready when you are."))}</p>
  <div class="play-row"><button class="hero-play${snapshot.busy ? " stop" : ""}" data-action="play"${pendingSaves || starting || disconnected ? " disabled" : ""}>${snapshot.busy ? escape(t("Stop")) : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>${escape(t("Play"))}`}</button>
  ${ready ? `<button class="quiet" data-page="graphics">${escape(t("Configure graphics"))}</button>` : `<button class="quiet" data-page="game">${escape(t("Choose your extracted game folder"))}</button>`}</div>
  <p id="feedback" class="home-feedback${feedbackError ? " error" : ""}" role="status" aria-live="polite">${escape(selectedBackup && !feedback ? t("Selected backup will be restored after confirmation.") : statusText())}</p>
 </div>
 ${updateNotice}
 <div class="home-strip" role="group" aria-label="${escape(t("Launch configuration"))}">
  ${chip("graphics", "Display", t(choiceLabel("display_mode")))}
  ${chip("graphics", "Render resolution", t(choiceLabel("render_width")))}
  ${chip("graphics", "Upscaling", t(choiceLabel("presentation_filter")))}
  ${chip("game", "Game frame rate", `${settings.frame_rate} FPS`)}
  ${hdrField ? chip("graphics", "HDR", t(settings.hdr ? "On" : "Off")) : ""}
  ${languageLabel ? chip("game", "Game language", languageLabel) : ""}
  <button class="chip install" data-page="game" title="${escape(settings.game_dir)}"><span>${escape(t("Game installation"))}${ready && meta.TITLE_ID ? ` · ${escape(meta.TITLE_ID)} · v${escape(meta.APP_VER)}` : ""}</span>
   <strong class="${ready ? "" : "readiness"}">${escape(ready ? settings.game_dir : settings.game_dir ? snapshot.game.message : t("Choose your extracted game folder"))}</strong></button>
 </div>
 ${snapshot.game.experimental ? `<p class="home-note">${escape(t("Experimental edition: only CUSA00076 has been tested with a real dump. If something fails, report it with the session log."))}</p>` : ""}
 </section>`;
}

function pageHeading(title, detail, reset) {
    return `<div class="section-heading"><div><h1 tabindex="-1">${escape(title)}</h1><p>${escape(detail)}</p></div>
 ${reset ? `<button class="quiet" data-action="reset"${snapshot.busy || pendingSaves ? " disabled" : ""}>${escape(t("Reset section"))}</button>` : ""}</div>`;
}

function searchPage() {
    const needle = query.toLowerCase();
    const matching = snapshot.fields.filter((f) => f.available && f.kind !== "patches" &&
        `${t(f.label)} ${f.label} ${t(f.summary ?? "")} ${f.description} ${f.reason} ${f.choices?.map((c) => c.label).join(" ") ?? ""}`.toLowerCase().includes(needle));
    const pageTitle = (id) => t(snapshot.pages.find((p) => p.id === id)?.title ?? id);
    return `<section class="settings-page">${pageHeading(t("Search settings"), `${matching.length} ${t("matching options")}`, false)}
 ${matching.length ? `<div class="rows">${matching.map((f) => fieldRow(f).replace('<div class="setting-copy">', `<div class="setting-copy"><p class="breadcrumb">${escape(pageTitle(f.page))} › ${escape(t(f.section))}</p>`)).join("")}</div>`
        : `<p class="empty-state">${escape(t("No matching settings. Try a different search."))}</p>`}</section>`;
}

function settingsPage() {
    const info = snapshot.pages.find((p) => p.id === page);
    const pageFields = snapshot.fields.filter((f) => f.page === page);
    const visible = pageFields.filter(shown);
    const sections = info.sections?.length ? info.sections : [...new Set(pageFields.map((f) => f.section))];
    const blocks = [];
    for (const section of sections) {
        const fields = visible.filter((f) => f.section === section);
        if (section === "Advanced") continue; // drawn last, collapsed
        if (page === "achievements" && section === "Achievements") continue; // drawn with the trophy list
        let extra = "";
        if (page === "game" && section === "Patches and cheats") extra = patchCatalogue(snapshot.patches);
        blocks.push(sectionBlock(section, fields, extra));
    }
    if (page === "achievements") {
        blocks.unshift(savesPanel());
        blocks.push(achievementsPanel(visible.filter((f) => f.section === "Achievements")));
    }
    if (page === "system") blocks.push(systemTools());
    const advanced = visible.filter((f) => f.section === "Advanced");
    if (advanced.length || (page === "system" && snapshot.timing)) {
        blocks.push(`<details class="advanced" id="advanced"${advancedOpen ? " open" : ""}><summary><span>${escape(t("Advanced"))}</span><span class="quiet-copy">${escape(t("Diagnostics and experimental options. Leave them at their defaults unless you are helping to test a report."))}</span></summary>
 ${advanced.length ? `<div class="rows">${advanced.map(fieldRow).join("")}</div>` : ""}${page === "system" ? timingPanel(snapshot.timing) : ""}</details>`);
    }
    const detail = page === "achievements"
        ? t("Your saves, backups and the trophies you have earned.")
        : t("Changes save automatically and apply the next time you press Play.");
    return `<section class="settings-page">${pageHeading(t(info.title), detail, pageFields.some((f) => f.available && f.kind !== "patches"))}
 ${blocks.join("")}</section>`;
}

// ---- Rendering --------------------------------------------------------------------------------
function render() {
    if (!snapshot) return;
    const active = document.activeElement;
    const activeSetting = active?.dataset?.setting;
    const selection = active && ["text", "search"].includes(active.type) ? [active.selectionStart, active.selectionEnd] : null;
    const language = snapshot.settings.ui_language ?? "en";
    document.documentElement.lang = language === "pt" ? "pt-BR" : language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    const home = page === "home" && !query;
    const dot = disconnected ? "lost" : snapshot.busy || starting ? "running" : "";
    const tabs = snapshot.pages.map((p) => {
        const selected = page === p.id && !query;
        return `<button id="nav-${p.id}" data-page="${p.id}" class="tab ${selected ? "selected" : ""}"${selected ? ' aria-current="page"' : ""}>${escape(t(p.title))}</button>`;
    }).join("");
    const footer = home ? "" : `<footer class="launchbar"><div><p class="status-line"><span class="dot ${dot}" aria-hidden="true"></span><span id="feedback" class="${feedbackError ? "error" : ""}" role="status" aria-live="polite">${escape(statusText())}</span></p>
 <p class="launch-context">${escape(t(selectedBackup ? "Selected backup will be restored after confirmation." : "Original game files and player data are protected."))}</p></div>
 <div class="build-info"><span>${escape(statusWord())}</span><span>${escape(snapshot.game.metadata?.TITLE_ID ?? "")}</span><button class="quiet" data-link="releases">${escape(t("View releases"))}</button></div>
 <button id="launch" class="primary" data-action="play"${pendingSaves || starting || disconnected ? " disabled" : ""}>${escape(t(snapshot.busy ? "Stop" : "Play"))}</button></footer>`;
    replaceView(`<div class="shell${home ? " is-home" : ""}">
 <header class="topbar"><a href="#" class="brand" data-page="home" aria-label="The Order: 1886 — ${escape(t("Home"))}"><img src="/assets/logo-brand.png" alt="The Order: 1886"></a>
 <nav class="tabs" aria-label="${escape(t("Main navigation"))}">${tabs}</nav>
 <label class="search">${icon("search")}<span class="sr-only">${escape(t("Search all settings"))}</span><input id="search" type="search" placeholder="${escape(t("Search all settings"))}" value="${escape(query)}" autocomplete="off"></label></header>
 <div id="content" class="content">${home ? homePage() : query ? searchPage() : settingsPage()}</div>
 ${footer}</div>
 <dialog id="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-detail"><h2 id="confirm-title"></h2><p id="confirm-detail"></p><div class="actions"><button id="confirm-no">${escape(t("Cancel"))}</button><button id="confirm-yes" class="primary"></button></div></dialog>`);
    bind();
    if (activeSetting) {
        const target = active?.id ? document.getElementById(active.id) : document.querySelector(`[data-setting="${activeSetting}"]`);
        target?.focus({ preventScroll: true });
        if (selection && target?.type === "text") target.setSelectionRange(selection[0], selection[1]);
    }
}

function navigate(next) {
    page = next;
    query = "";
    render();
    document.querySelector("#content")?.scrollTo(0, 0);
    document.querySelector("#content h1")?.focus();
}

async function refresh() {
    snapshot = await call("state.get");
    render();
}

// Settings are saved one at a time, in order; a function value is applied to the current value
// when its turn comes (binding edits change one key of a mapping).
let saveChain = Promise.resolve();
function queueSave(key, value) {
    const next = saveChain.then(() => saveSetting(key, typeof value === "function" ? value(snapshot.settings[key]) : value));
    saveChain = next.catch(() => {});
    return next;
}

async function saveSetting(key, value) {
    try {
        snapshot = await call("settings.set", { values: { [key]: value } });
        feedback = t("Saved — applies on next launch.");
        feedbackError = false;
    } catch (error) {
        feedback = String(error);
        feedbackError = true;
    }
}

async function changeSetting(key, value) {
    pendingSaves++;
    setFeedback(t("Saving settings…"));
    document.querySelectorAll("[data-action]").forEach((button) => { button.disabled = true; });
    try {
        await queueSave(key, value);
    } finally {
        pendingSaves--;
        render();
    }
}

function withBinding(mapping, button, source) {
    const next = mapping && typeof mapping === "object" && !Array.isArray(mapping) ? { ...mapping } : {};
    if (source) next[button] = source;
    else delete next[button];
    return next;
}

function bind() {
    document.querySelectorAll("[data-page]").forEach((node) => {
        node.onclick = (event) => { event.preventDefault(); navigate(node.dataset.page); };
    });
    const search = document.querySelector("#search");
    search.oninput = () => {
        const caret = search.selectionStart;
        query = search.value;
        render();
        const again = document.querySelector("#search");
        again.focus();
        again.setSelectionRange(caret, caret);
    };
    document.querySelectorAll("[data-setting]").forEach((node) => {
        node.onchange = () => {
            const field = snapshot.fields.find((f) => f.key === node.dataset.setting);
            let value = node.value;
            if (field.kind === "boolean") value = node.checked;
            if (field.kind === "number") value = Number(node.value);
            if (field.kind === "select") value = field.choices.find((c) => String(c.value) === node.value).value;
            if (field.kind === "order") value = node.value.split("\n").map((line) => line.trim()).filter(Boolean);
            if (field.kind === "bindings") {
                const button = node.dataset.binding;
                const source = node.value;
                value = (mapping) => withBinding(mapping, button, source);
            }
            changeSetting(field.key, value);
        };
    });
    document.querySelectorAll("[data-browse]").forEach((node) => {
        node.onclick = async () => {
            try {
                const field = snapshot.fields.find((f) => f.key === node.dataset.browse);
                const path = await bridge().Browse(field.kind);
                if (path) await changeSetting(field.key, path);
            } catch (error) {
                setFeedback(String(error), true);
            }
        };
    });
    document.querySelectorAll("[data-clear]").forEach((node) => { node.onclick = () => { changeSetting(node.dataset.clear, ""); }; });
    document.querySelectorAll("[data-link]").forEach((node) => {
        node.onclick = () => { bridge().OpenLink(node.dataset.link).catch((error) => setFeedback(String(error), true)); };
    });
    document.querySelectorAll("[data-location]").forEach((node) => {
        node.onclick = () => { bridge().OpenLocation(node.dataset.location).catch((error) => setFeedback(String(error), true)); };
    });
    document.querySelectorAll("[data-action]").forEach((node) => { node.onclick = () => { runAction(node.dataset.action); }; });
    document.querySelectorAll("details[data-more]").forEach((node) => {
        node.ontoggle = () => { if (node.open) openDetails.add(node.dataset.more); else openDetails.delete(node.dataset.more); };
    });
    const advanced = document.querySelector("#advanced");
    if (advanced) advanced.ontoggle = () => { advancedOpen = advanced.open; };
    const backup = document.querySelector("#backup");
    if (backup) backup.onchange = () => { selectedBackup = backup.value; render(); };
    bindConfirmation();
}

// ---- Actions ----------------------------------------------------------------------------------
async function startSession(action) {
    if (starting || disconnected || pendingSaves) return;
    starting = true;
    render();
    try {
        const params = { mode: action === "play" ? "play" : action };
        if (action === "play" && selectedBackup) {
            const ok = await confirmAction(t("Restore save backup?"),
                `${selectedBackup}. ${t("Current saves will be backed up before restoring. The game will then start; choose Continue or Load.")} `,
                t("Restore and play"));
            if (!ok) return;
            params.backup = selectedBackup;
            params.confirmed = true;
        }
        const started = await call("session.start", params);
        snapshot.logfile = started.logfile;
        selectedBackup = "";
        await refresh();
        if (snapshot.busy) setFeedback(t("Starting session…"));
        else if (snapshot.last_exit !== null) reportSession([snapshot.last_exit, params.mode, false]);
    } finally {
        starting = false;
        render();
    }
}

async function runAction(action) {
    try {
        if (pendingSaves) {
            setFeedback(t("Wait for settings to finish saving."));
            return;
        }
        if (action === "play" && snapshot.busy) {
            await call("session.stop");
            setFeedback(t("Stopping session…"));
            return;
        }
        if (["play", "verify", "prepare"].includes(action)) {
            await startSession(action);
            return;
        }
        switch (action) {
        case "update.check":
            feedback = t("Checking for updates…"); feedbackError = false;
            if (update) update = { ...update, state: "checking", error: "" };
            render();
            bridge().UpdateCheck().then(refreshUpdate).then(() => { feedback = ""; render(); }).catch((error) => setFeedback(String(error), true));
            return;
        case "update.download":
            feedback = t("Downloading the update…"); feedbackError = false;
            if (update) update = { ...update, state: "downloading", downloaded: 0, error: "" };
            render();
            bridge().UpdateDownload().then(refreshUpdate).then(() => { feedback = ""; render(); }).catch((error) => setFeedback(String(error), true));
            return;
        case "update.cancel":
            await bridge().UpdateCancel();
            await refreshUpdate();
            feedback = t("Download cancelled."); feedbackError = false;
            render();
            return;
        case "update.install":
            if (!await confirmAction(t("Install and restart?"), t("The launcher closes so the update can replace its own files. Saves, settings, mods and patches are preserved, and the launcher reopens when it is done."), t("Install and restart"))) return;
            await bridge().UpdateInstall();
            return;
        case "update.restore":
            if (!await confirmAction(t("Restore the previous version?"), t("The interrupted update is rolled back from its verified backup. Choose this only after reading the recorded failure."), t("Restore previous version"))) return;
            await bridge().UpdateRestore();
            return;
        case "reset":
            if (!await confirmAction(t("Reset section?"), t("Reset this section to validated defaults?"), t("Reset"))) return;
            snapshot = await call("settings.reset", { page });
            feedback = t("Section reset.");
            break;
        case "saves.restore":
            if (!selectedBackup) {
                setFeedback(t("Choose a save backup first."), true);
                return;
            }
            if (!await confirmAction(t("Restore save backup?"), `${selectedBackup}. ${t("Current saves will be backed up first. Stop the game before restoring.")} `, t("Restore"))) return;
            snapshot = await call(action, { name: selectedBackup, confirmed: true });
            selectedBackup = "";
            feedback = t("Save restored. Start the game and choose Continue or Load.");
            break;
        case "saves.import": {
            const path = await bridge().Browse("directory");
            if (!path || !await confirmAction(t("Import saves?"), `${path}. ${t("Current saves will be backed up first. Stop the game before importing.")} `, t("Import"))) return;
            snapshot = await call(action, { path, confirmed: true });
            feedback = t("Saves imported. Start the game and choose Continue or Load.");
            break;
        }
        case "cache.clear":
            if (!await confirmAction(t("Clear shader cache?"), t("Only this title’s regenerable shader cache will be removed. Saves and settings are preserved."), t("Clear shader cache"))) return;
            snapshot = await call(action, { confirmed: true });
            feedback = t("Shader cache cleared.");
            break;
        default: {
            const result = await call(action);
            if (result.settings) snapshot = result;
            feedback = result.path ? `${t("Completed")}: ${result.path}` : t("Completed");
        }
        }
        feedbackError = false;
        render();
    } catch (error) {
        setFeedback(String(error), true);
    }
}

// ---- Start ------------------------------------------------------------------------------------
function recoveryView(message) {
    root.innerHTML = `<main class="settings-page"><h1 id="recovery-title" tabindex="-1">${escape(t("Update needs your attention"))}</h1>
 <p role="alert" class="error">${escape(message)}</p>
 <section class="utility-section">${updatePanel(update, false)}</section></main>`;
    document.querySelectorAll("[data-action]").forEach((node) => { node.onclick = () => { runAction(node.dataset.action); }; });
    document.querySelectorAll("[data-link]").forEach((node) => {
        node.onclick = () => { bridge().OpenLink(node.dataset.link).catch((error) => setFeedback(String(error), true)); };
    });
    bindConfirmation();
    document.querySelector("#recovery-title")?.focus();
}

async function start() {
    root.innerHTML = '<main class="boot"><h1>The Order: 1886</h1><p role="status">Connecting to your local launcher…</p></main>';
    try {
        for (let i = 0; i < 100 && !window.go; i++) await new Promise((resolve) => setTimeout(resolve, 100));
        const startupError = await bridge().StartupError();
        await refreshUpdate();
        try {
            await refresh();
        } catch (error) {
            if (update?.recovery_blocked || update?.recovery_pending || update?.rollback_available) {
                recoveryView(startupError || String(error));
                if (startupError) setFeedback(startupError, true);
                return;
            }
            throw error;
        }
        if (startupError) setFeedback(startupError, true);
        window.runtime?.EventsOn("update", (state) => {
            update = normaliseUpdate(JSON.stringify(state));
            if (update.state === "available") feedback = `${t("Update available")}: ${update.version}`;
            if (update.recovery_blocked) feedback = t("An interrupted update needs your decision");
            feedbackError = update.state === "failed";
            render();
        });
        window.runtime?.EventsOn("worker", (event) => {
            if (event.event === "line") {
                snapshot.logs.push(String(event.data));
                snapshot.logs = snapshot.logs.slice(-100);
                const output = document.querySelector("#session-output");
                if (output) output.textContent = snapshot.logs.join("");
            }
            if (event.event === "done") {
                snapshot.busy = false;
                reportSession(event.data);
                refresh().catch((error) => setFeedback(String(error), true));
            }
            if (event.event === "disconnected") {
                disconnected = true;
                snapshot.busy = false;
                setFeedback(t("Worker connection lost. A game may still be running; check its window and the session log before starting another session."), true);
                render();
            }
            if (event.event === "started") {
                snapshot.busy = true;
                render();
            }
        });
        window.runtime?.EventsOn("close-requested", async () => {
            if (await confirmAction(t("Stop and close?"), t("The current session will be stopped before the launcher closes."), t("Stop and close"))) {
                await bridge().ConfirmClose();
            }
        });
        // The achievements page follows unlocks while the game runs; downloads show progress.
        setInterval(() => {
            if (page === "achievements" && !pendingSaves && !confirmResolve && !disconnected && !document.hidden) {
                refresh().catch((error) => setFeedback(String(error), true));
            }
        }, 3000);
        setInterval(() => {
            if (!document.hidden && update?.state === "downloading") refreshUpdate().then(render).catch(() => {});
        }, 500);
    } catch (error) {
        root.innerHTML = `<main class="boot"><h1>Launcher setup required</h1><p role="alert">${escape(String(error))}</p><p>Repair the portable installation, or restore the previous version from the updates section of a working installation.</p></main>`;
    }
}

document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        document.querySelector("#search")?.focus();
    }
});
start();
