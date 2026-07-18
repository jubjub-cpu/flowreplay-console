export const FAILURE_MODES = Object.freeze({
  healthy: "Healthy 200",
  "rate-limit": "HTTP 429",
  "server-error": "HTTP 503",
  timeout: "Timeout",
  unauthorized: "HTTP 401"
});

const TRANSIENT_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function contractKey(event) {
  return `${event.eventType}@${event.version}`;
}

export function valueAtPath(value, path) {
  return path.split(".").reduce((current, part) => current?.[part], value);
}

export function validateEvent(event, contracts) {
  const key = contractKey(event);
  const contract = contracts[key];
  if (!contract) {
    return { valid: false, key, contract: null, errors: [{ path: "eventType/version", expected: "registered contract", actual: "unknown", message: `No contract registered for ${key}.` }] };
  }

  const errors = contract.fields.flatMap((field) => {
    const actualValue = valueAtPath(event.payload, field.path);
    const actual = actualValue === undefined ? "missing" : Array.isArray(actualValue) ? "array" : typeof actualValue;
    if (actualValue === undefined) return [{ ...field, actual, message: `${field.path} is required.` }];
    if (actual !== field.type) return [{ ...field, actual, message: `${field.path} must be ${field.type}, received ${actual}.` }];
    return [];
  });
  return { valid: errors.length === 0, key, contract, errors };
}

export function classifyResponse(statusCode) {
  if (statusCode === 208) return "idempotent";
  if (statusCode >= 200 && statusCode < 300) return "success";
  if (statusCode === null || TRANSIENT_CODES.has(statusCode)) return "transient";
  return "permanent";
}

export function backoffSeconds(strategy, attemptNumber, baseDelay = 15) {
  if (attemptNumber <= 1) return 0;
  if (strategy === "fixed") return baseDelay;
  if (strategy === "linear") return baseDelay * (attemptNumber - 1);
  return baseDelay * (2 ** (attemptNumber - 2));
}

function responseForMode(mode, attemptNumber) {
  if (mode === "healthy") return { statusCode: 200, latencyMs: 142 };
  if (mode === "rate-limit") return attemptNumber < 3 ? { statusCode: 429, latencyMs: 91 } : { statusCode: 200, latencyMs: 176 };
  if (mode === "timeout") return attemptNumber === 1 ? { statusCode: null, latencyMs: 3000 } : { statusCode: 200, latencyMs: 219 };
  if (mode === "unauthorized") return { statusCode: 401, latencyMs: 74 };
  return { statusCode: 503, latencyMs: 438 };
}

export function deliveredIdempotencyKeys(events) {
  return new Set(events.filter((event) => event.status === "delivered").map((event) => event.idempotencyKey));
}

export function simulateReplay(event, options, contracts, deliveredKeys = new Set()) {
  const settings = {
    failureMode: "healthy",
    maxAttempts: 3,
    backoff: "exponential",
    protectIdempotency: true,
    now: new Date().toISOString(),
    ...options
  };
  const validation = validateEvent(event, contracts);
  const base = {
    id: `plan_${event.id}_${String(settings.failureMode).replace(/[^a-z0-9]/gi, "_")}`,
    sourceEventId: event.id,
    eventType: event.eventType,
    contractKey: validation.key,
    endpoint: event.endpoint,
    idempotencyKey: event.idempotencyKey,
    createdAt: settings.now,
    settings,
    validation,
    attempts: [],
    sideEffects: 0
  };

  if (!validation.valid) {
    return { ...base, allowed: false, outcome: "contract-failed", reason: "Contract preflight failed; delivery simulation was not started." };
  }

  if (settings.protectIdempotency && deliveredKeys.has(event.idempotencyKey)) {
    return {
      ...base,
      allowed: true,
      outcome: "duplicate",
      reason: "Idempotency store matched a completed delivery; the replay is a no-op.",
      attempts: [{ number: 1, statusCode: 208, classification: "idempotent", latencyMs: 9, scheduledAfterSeconds: 0 }]
    };
  }

  const attempts = [];
  let outcome = "dead-letter";
  for (let number = 1; number <= settings.maxAttempts; number += 1) {
    const response = responseForMode(settings.failureMode, number);
    const classification = classifyResponse(response.statusCode);
    attempts.push({ number, ...response, classification, scheduledAfterSeconds: backoffSeconds(settings.backoff, number) });
    if (classification === "success") { outcome = "delivered"; break; }
    if (classification === "permanent") { outcome = "dead-letter"; break; }
  }

  return {
    ...base,
    allowed: true,
    outcome,
    reason: outcome === "delivered" ? "Delivery reached a successful terminal response." : "Retry policy reached a terminal failure.",
    attempts,
    sideEffects: outcome === "delivered" ? 1 : 0
  };
}

export function approveReplay(event, plan, reason, sequence = 1) {
  const evidence = String(reason || "").trim();
  if (!plan?.allowed) throw new Error("A replay with passing contract preflight is required.");
  if (plan.sourceEventId !== event.id) throw new Error("Replay plan does not match the selected event.");
  if (evidence.length < 12) throw new Error("A recovery reason of at least 12 characters is required.");
  return {
    ...event,
    id: `${event.id}_replay_${sequence}`,
    createdAt: plan.createdAt,
    status: plan.outcome,
    attempts: plan.attempts,
    replayOf: event.id,
    replayReason: evidence,
    sideEffects: plan.sideEffects
  };
}

export function summarizeEvents(events) {
  const summary = { total: events.length, delivered: 0, retrying: 0, "dead-letter": 0, duplicate: 0, "contract-failed": 0 };
  for (const event of events) {
    if (Object.hasOwn(summary, event.status)) summary[event.status] += 1;
  }
  summary.deliveryRate = summary.total ? summary.delivered / summary.total : 0;
  return summary;
}

export function parseImportedEvent(text, contracts) {
  let event;
  try { event = JSON.parse(text); } catch { throw new Error("Import must be valid JSON."); }
  for (const field of ["id", "eventType", "version", "endpoint", "idempotencyKey", "payload"]) {
    if (event[field] === undefined || event[field] === "") throw new Error(`Imported event requires ${field}.`);
  }
  const normalized = { ...event, createdAt: event.createdAt || new Date().toISOString(), status: "pending", attempts: [] };
  const validation = validateEvent(normalized, contracts);
  if (!validation.valid) throw new Error(`Contract preflight failed: ${validation.errors.map((item) => item.message).join(" ")}`);
  return normalized;
}

export function buildReplayReport(workspace, events, plans, audit) {
  return {
    product: "FlowReplay Console",
    mode: "deterministic local simulation",
    workspace,
    generatedAt: new Date().toISOString(),
    summary: summarizeEvents(events),
    events,
    replayPlans: plans,
    audit,
    disclaimer: "Synthetic sandbox evidence only; no production webhook was sent."
  };
}
