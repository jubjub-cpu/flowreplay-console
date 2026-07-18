# Architecture

## Product Boundary

FlowReplay Console is a static browser product for reasoning about webhook delivery behavior. It is not a webhook sender, queue, proxy, signature verifier, or production observability system.

```text
Synthetic event fixture or local JSON import
                  |
                  v
         Versioned contract preflight
          | pass              | fail
          v                   v
   Deterministic response   Stop before delivery
          |
          v
  Retry class + backoff schedule
          |
          v
  Idempotency lookup -> HTTP 208 no-op when matched
          |
          v
  Replay plan -> human reason -> approval record
          |
          v
  Local event stream + JSON evidence export
```

## Engine

`assets/replay-engine.mjs` is a pure module with no DOM dependency.

| Function | Responsibility |
| --- | --- |
| `validateEvent` | Resolve `eventType@version`, read required payload paths, and return specific missing/type errors. |
| `classifyResponse` | Separate success, idempotent, transient, and permanent outcomes. |
| `backoffSeconds` | Produce fixed, linear, or exponential delay evidence. |
| `simulateReplay` | Combine contract, idempotency, injection, attempt cap, and terminal outcome. |
| `approveReplay` | Require a reason and create a new replay event without mutating its source. |
| `parseImportedEvent` | Parse one event and reject missing envelope fields or contract failures. |
| `buildReplayReport` | Assemble summaries, events, plans, audit entries, and the simulation disclaimer. |

## UI State

The browser keeps events, contracts, filters, selected evidence tab, replay settings, plans, and audit entries in memory. Re-rendering is scoped by concern: event rail, summary, inspector, replay builder, registry, audit, and Canvas timeline.

## Failure Taxonomy

| Injection | Modeled behavior |
| --- | --- |
| Healthy 200 | First attempt succeeds. |
| HTTP 429 | Two transient responses, then success when the attempt cap permits. |
| HTTP 503 | Transient responses continue until the attempt cap is exhausted. |
| Timeout | First attempt times out and the second succeeds. |
| HTTP 401 | Permanent response stops after one attempt. |

## Trust Boundaries

- Fixture boundary: only fictional examples ship in the repository.
- Import boundary: local JSON is parsed in browser memory and never uploaded.
- Contract boundary: invalid envelopes stop before simulated delivery.
- Idempotency boundary: successful keys produce zero-side-effect no-ops by default.
- Human boundary: the engine can build a plan, but only a person with a reason records the replay.
- Export boundary: reports preserve the deterministic-simulation disclosure.

## Production Extension Path

A production implementation would need authenticated ingestion, full JSON Schema or OpenAPI validation, signature verification, encrypted secrets, persistent idempotency storage, durable queues, per-provider retry policies, observability, role-based access, and change-controlled replay authorization. Those capabilities are deliberately outside v1.0.0.
