import {
  FAILURE_MODES,
  approveReplay,
  buildReplayReport,
  deliveredIdempotencyKeys,
  parseImportedEvent,
  simulateReplay,
  summarizeEvents,
  validateEvent
} from "./replay-engine.mjs";

const workspace = document.querySelector("#workspace");
const state = {
  workspace: "",
  notice: "",
  contracts: {},
  events: [],
  selectedId: null,
  filters: { status: "all", search: "" },
  tab: "payload",
  settings: { failureMode: "healthy", maxAttempts: 3, backoff: "exponential", protectIdempotency: true },
  recoveryReason: "",
  plan: null,
  plans: [],
  audit: []
};

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const statusLabel = (status) => ({
  delivered: "Delivered",
  retrying: "Retrying",
  "dead-letter": "Dead letter",
  duplicate: "Duplicate blocked",
  "contract-failed": "Contract failed",
  pending: "Ready"
}[status] || status);

const statusCode = (attempt) => attempt.statusCode === null ? "TIMEOUT" : String(attempt.statusCode);
const selectedEvent = () => state.events.find((event) => event.id === state.selectedId) || state.events[0];
const selectedValidation = () => validateEvent(selectedEvent(), state.contracts);

function addAudit(action, detail) {
  state.audit.unshift({ at: new Date().toISOString(), action, detail });
  renderAudit();
}

function shell() {
  workspace.innerHTML = `<div class="console-shell">
    <aside class="event-rail" aria-labelledby="events-heading">
      <div class="rail-title"><p class="eyebrow">${esc(state.workspace)}</p><h1 id="events-heading">Event stream</h1><span class="environment">Sandbox / US-West</span></div>
      <div class="rail-filters">
        <label for="event-search">Find event<input id="event-search" type="search" placeholder="ID or event type" autocomplete="off"></label>
        <label for="status-filter">Delivery state<select id="status-filter"><option value="all">All states</option><option value="delivered">Delivered</option><option value="retrying">Retrying</option><option value="dead-letter">Dead letter</option><option value="duplicate">Duplicate blocked</option><option value="contract-failed">Contract failed</option></select></label>
      </div>
      <div id="event-list" class="event-list"></div>
      <label class="import-button" for="event-import"><span>Import event JSON</span><small>Validated locally against the registry</small></label>
      <input id="event-import" type="file" accept=".json,application/json">
      <p id="import-error" class="import-error" role="alert"></p>
      <p class="privacy-note">Payloads stay in browser memory. No endpoint is contacted and no authorization header is stored.</p>
    </aside>
    <section class="workbench" aria-labelledby="workbench-heading">
      <div class="workbench-heading">
        <div><p class="eyebrow">Delivery operations</p><h2 id="workbench-heading">Webhook control plane</h2><p>Inspect contract health, model retry behavior, and approve a synthetic replay.</p></div>
        <button id="export-report" class="secondary" type="button">Export evidence</button>
      </div>
      <div id="summary-strip" class="summary-strip" aria-label="Delivery summary"></div>
      <section class="timeline-section" aria-labelledby="timeline-heading">
        <div class="panel-heading"><div><p class="eyebrow">Last ten events</p><h3 id="timeline-heading">Delivery timeline</h3></div><span>Terminal state by arrival order</span></div>
        <canvas id="event-timeline" width="960" height="250" aria-label="Timeline of webhook event delivery states"></canvas>
        <div class="timeline-legend"><span><i class="delivered"></i>Delivered</span><span><i class="retrying"></i>Retrying</span><span><i class="dead-letter"></i>Dead letter</span><span><i class="duplicate"></i>Duplicate</span><span><i class="contract-failed"></i>Contract failed</span></div>
      </section>
      <div class="detail-grid">
        <section class="inspector" aria-labelledby="inspector-heading">
          <div class="panel-heading"><div><p class="eyebrow">Selected envelope</p><h3 id="inspector-heading"></h3></div><span id="selected-status" class="status"></span></div>
          <div class="tab-list" role="tablist" aria-label="Event evidence views">
            <button type="button" role="tab" data-tab="payload">Payload</button>
            <button type="button" role="tab" data-tab="contract">Contract</button>
            <button type="button" role="tab" data-tab="attempts">Attempts</button>
          </div>
          <div id="tab-content" class="tab-content"></div>
        </section>
        <aside class="replay-panel" aria-labelledby="replay-heading">
          <div class="replay-heading"><p class="eyebrow">Failure laboratory</p><h3 id="replay-heading">Replay builder</h3><span id="preflight-status" class="status"></span></div>
          <fieldset><legend>Injected response</legend><div id="failure-modes" class="segmented">${Object.entries(FAILURE_MODES).map(([value, label]) => `<button type="button" data-failure="${value}">${label}</button>`).join("")}</div></fieldset>
          <div class="replay-controls">
            <label for="max-attempts">Maximum attempts<input id="max-attempts" type="number" min="1" max="5" step="1" value="3"></label>
            <label for="backoff-policy">Backoff policy<select id="backoff-policy"><option value="exponential">Exponential</option><option value="linear">Linear</option><option value="fixed">Fixed</option></select></label>
          </div>
          <label class="toggle-row" for="idempotency-protection"><span><strong>Idempotency protection</strong><small>Block a repeated side effect after a successful key match.</small></span><input id="idempotency-protection" type="checkbox" checked></label>
          <label class="reason-field" for="recovery-reason">Replay reason<textarea id="recovery-reason" rows="3" maxlength="220" placeholder="Evidence for replaying this event"></textarea></label>
          <div class="replay-actions"><button id="build-plan" type="button">Build replay plan</button><button id="approve-replay" class="approve" type="button" disabled>Approve replay</button></div>
          <p id="replay-error" class="replay-error" role="alert"></p>
          <div id="plan-output" class="plan-output"></div>
        </aside>
      </div>
      <section class="registry-section" aria-labelledby="registry-heading"><div class="panel-heading"><div><p class="eyebrow">Versioned schemas</p><h3 id="registry-heading">Contract registry</h3></div><span>${Object.keys(state.contracts).length} active contracts</span></div><div id="contract-registry" class="table-wrap"></div></section>
      <section class="audit-section" aria-labelledby="audit-heading"><div class="panel-heading"><div><p class="eyebrow">Human and system evidence</p><h3 id="audit-heading">Replay audit</h3></div><span>Local session</span></div><ol id="audit-list"></ol></section>
    </section>
  </div>`;
}

function renderSummary() {
  const summary = summarizeEvents(state.events);
  const attention = summary.duplicate + summary["contract-failed"];
  document.querySelector("#summary-strip").innerHTML = `
    <div><span>Events</span><strong>${summary.total}</strong><small>current local session</small></div>
    <div><span>Delivered</span><strong>${summary.delivered}</strong><small>${Math.round(summary.deliveryRate * 100)}% of events</small></div>
    <div><span>Retrying</span><strong>${summary.retrying}</strong><small>transient response</small></div>
    <div><span>Dead letter</span><strong>${summary["dead-letter"]}</strong><small>recovery candidate</small></div>
    <div><span>Preflight stops</span><strong>${attention}</strong><small>duplicate or contract</small></div>`;
}

function filteredEvents() {
  const query = state.filters.search.trim().toLowerCase();
  return state.events.filter((event) => {
    const statusMatch = state.filters.status === "all" || event.status === state.filters.status;
    const queryMatch = !query || `${event.id} ${event.eventType} ${event.version}`.toLowerCase().includes(query);
    return statusMatch && queryMatch;
  });
}

function renderEvents() {
  const events = filteredEvents();
  document.querySelector("#event-list").innerHTML = events.length ? events.map((event) => `
    <button class="event-button" type="button" data-event="${esc(event.id)}" aria-pressed="${event.id === state.selectedId}">
      <span class="event-meta"><b>${esc(event.id)}</b><time>${new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
      <strong>${esc(event.eventType)}</strong>
      <span class="event-state ${esc(event.status)}"><i></i>${esc(statusLabel(event.status))}</span>
      <small>${event.attempts.length} attempt${event.attempts.length === 1 ? "" : "s"} / ${esc(event.version)}</small>
    </button>`).join("") : '<p class="empty-state">No events match the current filters.</p>';
}

function renderInspector() {
  const event = selectedEvent();
  const validation = selectedValidation();
  document.querySelector("#inspector-heading").textContent = `${event.eventType} / ${event.id}`;
  const status = document.querySelector("#selected-status");
  status.className = `status ${event.status}`;
  status.textContent = statusLabel(event.status);
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === state.tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });

  if (state.tab === "payload") {
    document.querySelector("#tab-content").innerHTML = `<dl class="envelope-meta"><div><dt>Contract</dt><dd>${esc(validation.key)}</dd></div><div><dt>Endpoint</dt><dd>${esc(event.endpoint)}</dd></div><div><dt>Idempotency key</dt><dd>${esc(event.idempotencyKey)}</dd></div><div><dt>Created</dt><dd>${new Date(event.createdAt).toLocaleString()}</dd></div></dl><pre class="json-view"><code>${esc(JSON.stringify(event.payload, null, 2))}</code></pre>`;
    return;
  }

  if (state.tab === "contract") {
    const contractRows = validation.contract ? validation.contract.fields.map((field) => {
      const error = validation.errors.find((item) => item.path === field.path);
      return `<tr><th>${esc(field.path)}</th><td>${esc(field.type)}</td><td class="${error ? "bad" : "good"}">${error ? esc(error.actual) : "valid"}</td><td>${error ? esc(error.message) : "Type and presence check passed."}</td></tr>`;
    }).join("") : `<tr><td colspan="4">${esc(validation.errors[0]?.message || "Contract unavailable.")}</td></tr>`;
    document.querySelector("#tab-content").innerHTML = `<div class="contract-summary ${validation.valid ? "valid" : "invalid"}"><strong>${validation.valid ? "Preflight passed" : `${validation.errors.length} contract issue${validation.errors.length === 1 ? "" : "s"}`}</strong><span>${esc(validation.contract?.description || "No registered schema matches this envelope.")}</span></div><div class="table-wrap"><table><thead><tr><th>Path</th><th>Expected</th><th>Observed</th><th>Evidence</th></tr></thead><tbody>${contractRows}</tbody></table></div>`;
    return;
  }

  document.querySelector("#tab-content").innerHTML = event.attempts.length ? `<ol class="attempt-list">${event.attempts.map((attempt) => `<li class="${esc(attempt.classification)}"><span class="attempt-number">${attempt.number}</span><div><strong>${statusCode(attempt)}</strong><p>${esc(attempt.classification)} response / ${attempt.latencyMs} ms</p></div><time>+${attempt.scheduledAfterSeconds}s</time></li>`).join("")}</ol>` : '<p class="empty-state padded">No delivery attempt started because contract preflight stopped this event.</p>';
}

function renderReplay() {
  const validation = selectedValidation();
  const preflight = document.querySelector("#preflight-status");
  preflight.className = `status ${validation.valid ? "delivered" : "contract-failed"}`;
  preflight.textContent = validation.valid ? "Preflight pass" : "Preflight block";
  document.querySelectorAll("[data-failure]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.failure === state.settings.failureMode)));
  document.querySelector("#max-attempts").value = state.settings.maxAttempts;
  document.querySelector("#backoff-policy").value = state.settings.backoff;
  document.querySelector("#idempotency-protection").checked = state.settings.protectIdempotency;
  document.querySelector("#recovery-reason").value = state.recoveryReason;
  document.querySelector("#replay-error").textContent = "";

  const plan = state.plan?.sourceEventId === selectedEvent().id ? state.plan : null;
  const approve = document.querySelector("#approve-replay");
  approve.disabled = !plan?.allowed || state.recoveryReason.trim().length < 12;
  if (!plan) {
    document.querySelector("#plan-output").innerHTML = '<p class="plan-empty">No replay plan built for this event.</p>';
    return;
  }
  const attemptText = plan.attempts.length ? plan.attempts.map((attempt) => `<li><span>Attempt ${attempt.number} / +${attempt.scheduledAfterSeconds}s</span><strong>${statusCode(attempt)}</strong><small>${esc(attempt.classification)}</small></li>`).join("") : '<li><span>Preflight</span><strong>STOP</strong><small>no request</small></li>';
  document.querySelector("#plan-output").innerHTML = `<div class="plan-summary ${esc(plan.outcome)}"><span>Predicted outcome</span><strong>${esc(statusLabel(plan.outcome))}</strong><small>${esc(plan.reason)}</small></div><ol class="plan-attempts">${attemptText}</ol><pre class="http-preview"><code>POST ${esc(plan.endpoint)}\nX-Event-ID: ${esc(plan.sourceEventId)}\nIdempotency-Key: ${esc(plan.idempotencyKey)}\nContract: ${esc(plan.contractKey)}\n\n${plan.allowed ? `${plan.attempts.length} simulated attempt(s); ${plan.sideEffects} side effect(s)` : "request blocked before delivery"}</code></pre>`;
}

function drawTimeline() {
  const canvas = document.querySelector("#event-timeline");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const colors = { delivered: "#187a5b", retrying: "#d88417", "dead-letter": "#c44a3d", duplicate: "#6f57a5", "contract-failed": "#26394a", pending: "#258b9c" };
  const lanes = ["delivered", "retrying", "dead-letter", "duplicate", "contract-failed"];
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.font = "12px system-ui";
  context.textBaseline = "middle";
  lanes.forEach((lane, index) => {
    const y = 36 + index * 40;
    context.strokeStyle = "#dce2e4";
    context.beginPath();
    context.moveTo(128, y);
    context.lineTo(width - 28, y);
    context.stroke();
    context.fillStyle = "#69737a";
    context.fillText(statusLabel(lane), 18, y);
  });
  const events = state.events.slice(0, 10).reverse();
  events.forEach((event, index) => {
    const lane = Math.max(0, lanes.indexOf(event.status));
    const x = 158 + index * ((width - 205) / Math.max(events.length - 1, 1));
    const y = 36 + lane * 40;
    context.fillStyle = colors[event.status] || colors.pending;
    context.beginPath();
    context.arc(x, y, 8, 0, Math.PI * 2);
    context.fill();
    context.save();
    context.translate(x - 2, height - 17);
    context.rotate(-Math.PI / 5);
    context.fillStyle = "#2a3338";
    context.font = "10px ui-monospace, monospace";
    context.fillText(event.id.replace("evt_", ""), 0, 0);
    context.restore();
  });
}

function renderRegistry() {
  document.querySelector("#contract-registry").innerHTML = `<table><thead><tr><th>Event</th><th>Version</th><th>Required fields</th><th>Policy</th></tr></thead><tbody>${Object.values(state.contracts).map((contract) => `<tr><th>${esc(contract.eventType)}</th><td><span class="version-badge">${esc(contract.version)}</span></td><td>${contract.fields.length}</td><td>Reject before delivery on missing or mismatched fields</td></tr>`).join("")}</tbody></table>`;
}

function renderAudit() {
  const list = document.querySelector("#audit-list");
  if (!list) return;
  list.innerHTML = state.audit.length ? state.audit.map((item) => `<li><time>${new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><strong>${esc(item.action)}</strong><span>${esc(item.detail)}</span></li>`).join("") : '<li class="empty-state">No replay actions recorded.</li>';
}

function renderAll() {
  renderSummary();
  renderEvents();
  renderInspector();
  renderReplay();
  renderRegistry();
  renderAudit();
  drawTimeline();
}

function invalidatePlan() {
  state.plan = null;
  renderReplay();
}

function download(name, value) {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 10000);
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const eventButton = event.target.closest("[data-event]");
    if (eventButton) {
      state.selectedId = eventButton.dataset.event;
      state.tab = "payload";
      state.plan = null;
      state.recoveryReason = "";
      renderEvents(); renderInspector(); renderReplay();
      return;
    }
    const tab = event.target.closest("[data-tab]");
    if (tab) { state.tab = tab.dataset.tab; renderInspector(); return; }
    const failure = event.target.closest("[data-failure]");
    if (failure) { state.settings.failureMode = failure.dataset.failure; invalidatePlan(); return; }
    if (event.target.id === "build-plan") {
      state.plan = simulateReplay(selectedEvent(), state.settings, state.contracts, deliveredIdempotencyKeys(state.events));
      state.plans.push(state.plan);
      addAudit("Replay plan built", `${selectedEvent().id}: ${statusLabel(state.plan.outcome)} with ${state.plan.attempts.length} simulated attempt(s).`);
      renderReplay();
      return;
    }
    if (event.target.id === "approve-replay") {
      try {
        const replay = approveReplay(selectedEvent(), state.plan, state.recoveryReason, state.events.filter((item) => item.replayOf).length + 1);
        const sourceId = selectedEvent().id;
        state.events.unshift(replay);
        state.selectedId = replay.id;
        state.plan = null;
        state.recoveryReason = "";
        addAudit("Replay approved", `${sourceId} recorded as ${statusLabel(replay.status)}; ${replay.sideEffects} simulated side effect(s).`);
        renderAll();
      } catch (error) {
        document.querySelector("#replay-error").textContent = error.message;
      }
      return;
    }
    if (event.target.id === "export-report") {
      const report = buildReplayReport(state.workspace, state.events, state.plans, state.audit);
      window.setTimeout(() => download("flowreplay-evidence.json", JSON.stringify(report, null, 2)), 0);
      addAudit("Evidence exported", `${state.events.length} events and ${state.plans.length} replay plan(s) included.`);
    }
    if (event.target.id === "retry-load") initialize();
  });

  document.querySelector("#event-search").addEventListener("input", (event) => { state.filters.search = event.target.value; renderEvents(); });
  document.querySelector("#status-filter").addEventListener("change", (event) => { state.filters.status = event.target.value; renderEvents(); });
  document.querySelector("#max-attempts").addEventListener("change", (event) => { state.settings.maxAttempts = Math.max(1, Math.min(5, Number(event.target.value) || 3)); invalidatePlan(); });
  document.querySelector("#backoff-policy").addEventListener("change", (event) => { state.settings.backoff = event.target.value; invalidatePlan(); });
  document.querySelector("#idempotency-protection").addEventListener("change", (event) => { state.settings.protectIdempotency = event.target.checked; invalidatePlan(); });
  document.querySelector("#recovery-reason").addEventListener("input", (event) => {
    state.recoveryReason = event.target.value;
    const approve = document.querySelector("#approve-replay");
    approve.disabled = !state.plan?.allowed || state.recoveryReason.trim().length < 12;
  });
  document.querySelector("#event-import").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseImportedEvent(await file.text(), state.contracts);
      state.events.unshift(imported);
      state.selectedId = imported.id;
      state.plan = null;
      state.recoveryReason = "";
      document.querySelector("#import-error").textContent = "";
      addAudit("Event imported", `${imported.id} passed ${imported.eventType}@${imported.version} preflight.`);
      renderAll();
    } catch (error) {
      document.querySelector("#import-error").textContent = error.message;
    } finally {
      event.target.value = "";
    }
  });
  window.addEventListener("resize", drawTimeline);
}

async function initialize() {
  workspace.innerHTML = '<section class="startup" aria-labelledby="startup-title"><p class="eyebrow">Loading event fixtures</p><h1 id="startup-title">Preparing delivery evidence</h1><div class="loader" aria-hidden="true"><span></span></div></section>';
  try {
    const response = await fetch("data/events.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.workspace = data.workspace;
    state.notice = data.notice;
    state.contracts = data.contracts;
    state.events = data.events;
    state.selectedId = data.events.find((event) => event.status === "dead-letter")?.id || data.events[0].id;
    state.audit = [{ at: new Date().toISOString(), action: "Workspace loaded", detail: `${data.events.length} synthetic events and ${Object.keys(data.contracts).length} contracts ready.` }];
    shell();
    bindEvents();
    renderAll();
  } catch {
    workspace.innerHTML = '<section class="startup error"><p class="eyebrow">Fixture load failed</p><h1>The synthetic event workspace could not be loaded.</h1><p>Check the local static server, then retry.</p><button id="retry-load" type="button">Retry</button></section>';
    document.querySelector("#retry-load").addEventListener("click", initialize);
  }
}

initialize();
