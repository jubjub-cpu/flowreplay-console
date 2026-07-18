# Case Study

## Context

An integration team receives webhook complaints that look similar in a support queue but have different causes: a subscriber is rate-limiting requests, another endpoint is returning 503, one payload drifted from its registered contract, and one event was delivered twice.

## Product Question

How can a reviewer distinguish those states, test a recovery policy, and preserve evidence without sending a production webhook?

## Product Response

FlowReplay Console places the event stream, delivery-state summary, Canvas timeline, envelope evidence, and replay controls in one operational surface. The reviewer can see whether a request reached the endpoint, why an attempt is retryable, when the next attempt would occur, and whether a completed idempotency key would block a side effect.

The default selected fixture is `evt_1046`, a synthetic `invoice.failed@v1` event that reached dead letter after three HTTP 503 responses. A healthy replay plan predicts one successful attempt. The approval control remains disabled until a reviewer supplies a reason. Approval appends a separate replay event and audit entry while leaving the failed source untouched.

Two contrasting controls make the boundary concrete:

- Replaying delivered `evt_1042` with idempotency enabled predicts HTTP 208 and zero side effects.
- Replaying `evt_1049` stops before delivery because `data.email` is missing from a `customer.updated@v2` envelope.

## Key Decisions

- Use deterministic failures so a reviewer can repeat exact evidence without an external endpoint.
- Show the response class and delay on every attempt instead of collapsing retries into a spinner.
- Preserve the original event and append a replay record rather than rewriting history.
- Keep contract checks before the delivery plan so malformed payloads never appear retryable.
- Require a human reason for every approved replay, including idempotent no-ops.

## Validation Evidence

- Ten events and six contracts load from synthetic JSON.
- Engine checks cover contract errors, retry classes, three backoff modes, five failure injections, duplicate suppression, approval evidence, import, and report construction.
- Browser checks recover a dead letter, block a contract failure, prove a duplicate no-op, import an event, export evidence, and verify the nonblank Canvas timeline.
- Desktop and 390-pixel mobile workflows have no document overflow, console errors, or failed requests.

## Outcome

The product demonstrates developer infrastructure and API product reasoning through a reviewable interface. It does not claim production reliability, live traffic, customer use, or measured incident reduction.
