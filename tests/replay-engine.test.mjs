import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  approveReplay,
  backoffSeconds,
  buildReplayReport,
  classifyResponse,
  deliveredIdempotencyKeys,
  parseImportedEvent,
  simulateReplay,
  summarizeEvents,
  validateEvent
} from "../assets/replay-engine.mjs";

const fixture = JSON.parse(await readFile(new URL("../data/events.json", import.meta.url), "utf8"));
const importedText = await readFile(new URL("../data/sample-import.json", import.meta.url), "utf8");
const byId = (id) => fixture.events.find((event) => event.id === id);

assert.equal(fixture.events.length, 10);
assert.equal(Object.keys(fixture.contracts).length, 6);

const valid = validateEvent(byId("evt_1046"), fixture.contracts);
assert.equal(valid.valid, true);
assert.equal(valid.key, "invoice.failed@v1");

const missingEmail = validateEvent(byId("evt_1049"), fixture.contracts);
assert.equal(missingEmail.valid, false);
assert.match(missingEmail.errors[0].message, /data\.email is required/);

const wrongTemperature = validateEvent(byId("evt_1050"), fixture.contracts);
assert.equal(wrongTemperature.valid, false);
assert.match(wrongTemperature.errors[0].message, /must be number/);

assert.equal(classifyResponse(200), "success");
assert.equal(classifyResponse(429), "transient");
assert.equal(classifyResponse(null), "transient");
assert.equal(classifyResponse(401), "permanent");
assert.equal(classifyResponse(208), "idempotent");
assert.equal(backoffSeconds("exponential", 1), 0);
assert.equal(backoffSeconds("exponential", 2), 15);
assert.equal(backoffSeconds("exponential", 4), 60);
assert.equal(backoffSeconds("linear", 4), 45);
assert.equal(backoffSeconds("fixed", 4), 15);

const keys = deliveredIdempotencyKeys(fixture.events);
assert.equal(keys.size, 4);
assert.equal(keys.has("invoice_demo_881:paid:v1"), true);

const recovered = simulateReplay(byId("evt_1046"), { failureMode: "healthy", now: "2026-07-17T20:00:00Z" }, fixture.contracts, keys);
assert.equal(recovered.allowed, true);
assert.equal(recovered.outcome, "delivered");
assert.equal(recovered.attempts.length, 1);
assert.equal(recovered.sideEffects, 1);

const rateLimited = simulateReplay(byId("evt_1046"), { failureMode: "rate-limit", maxAttempts: 3 }, fixture.contracts, keys);
assert.equal(rateLimited.outcome, "delivered");
assert.deepEqual(rateLimited.attempts.map((attempt) => attempt.statusCode), [429, 429, 200]);
assert.deepEqual(rateLimited.attempts.map((attempt) => attempt.scheduledAfterSeconds), [0, 15, 30]);

const exhausted = simulateReplay(byId("evt_1046"), { failureMode: "server-error", maxAttempts: 3 }, fixture.contracts, keys);
assert.equal(exhausted.outcome, "dead-letter");
assert.equal(exhausted.attempts.length, 3);
assert.equal(exhausted.sideEffects, 0);

const timeoutRecovered = simulateReplay(byId("evt_1047"), { failureMode: "timeout", maxAttempts: 3 }, fixture.contracts, keys);
assert.equal(timeoutRecovered.outcome, "delivered");
assert.deepEqual(timeoutRecovered.attempts.map((attempt) => attempt.statusCode), [null, 200]);

const permanent = simulateReplay(byId("evt_1047"), { failureMode: "unauthorized", maxAttempts: 5 }, fixture.contracts, keys);
assert.equal(permanent.outcome, "dead-letter");
assert.equal(permanent.attempts.length, 1);

const duplicate = simulateReplay(byId("evt_1042"), { failureMode: "healthy" }, fixture.contracts, keys);
assert.equal(duplicate.outcome, "duplicate");
assert.equal(duplicate.attempts[0].statusCode, 208);
assert.equal(duplicate.sideEffects, 0);

const blocked = simulateReplay(byId("evt_1049"), { failureMode: "healthy" }, fixture.contracts, keys);
assert.equal(blocked.allowed, false);
assert.equal(blocked.outcome, "contract-failed");
assert.equal(blocked.attempts.length, 0);

assert.throws(() => approveReplay(byId("evt_1046"), recovered, "too short"), /at least 12/);
const approved = approveReplay(byId("evt_1046"), recovered, "Endpoint owner confirmed recovery.", 1);
assert.equal(approved.status, "delivered");
assert.equal(approved.replayOf, "evt_1046");
assert.equal(approved.sideEffects, 1);

const imported = parseImportedEvent(importedText, fixture.contracts);
assert.equal(imported.status, "pending");
assert.equal(imported.eventType, "subscription.changed");
assert.throws(() => parseImportedEvent("not json", fixture.contracts), /valid JSON/);
assert.throws(() => parseImportedEvent(JSON.stringify({ id: "broken" }), fixture.contracts), /requires eventType/);

const summary = summarizeEvents(fixture.events);
assert.deepEqual({ total: summary.total, delivered: summary.delivered, retrying: summary.retrying, dead: summary["dead-letter"], duplicate: summary.duplicate, contract: summary["contract-failed"] }, { total: 10, delivered: 4, retrying: 1, dead: 2, duplicate: 1, contract: 2 });
assert.equal(summary.deliveryRate, 0.4);

const report = buildReplayReport(fixture.workspace, fixture.events, [recovered], [{ action: "test" }]);
assert.equal(report.product, "FlowReplay Console");
assert.equal(report.replayPlans.length, 1);
assert.match(report.disclaimer, /Synthetic sandbox/);

console.log("FLOWREPLAY ENGINE TESTS PASSED");
console.log(JSON.stringify({ events: 10, contracts: 6, retries: true, idempotency: true, deadLetterRecovery: true, contractPreflight: true, import: true, export: true }));
