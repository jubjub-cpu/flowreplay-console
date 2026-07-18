# Validation Evidence

## Local Checks

Status: passed on 2026-07-17.

- `FLOWREPLAY ENGINE TESTS PASSED`
- `FLOWREPLAY BROWSER TESTS PASSED`
- Repository structure, fixture size, contract count, delivery-state coverage, disclosures, privacy patterns, accessibility hooks, and engine checks passed.
- Ten initial events and six contracts rendered.
- Dead-letter recovery, idempotent no-op, contract stop, local JSON import, JSON export, Canvas pixels, and keyboard skip navigation passed.
- Desktop and 390-pixel mobile document overflow: none.
- Browser console errors: none.
- Failed requests: none.
- Fixture-load failure state and retry control rendered.

## Deployment Checks

Status: passed on 2026-07-17.

- GitHub Pages built remote commit `1385b4b74bb5e5f2e2bacad9aa729907c27d1c99` successfully.
- `https://jubjub-cpu.github.io/flowreplay-console/` returned HTTP 200.
- `FLOWREPLAY BROWSER TESTS PASSED` against the deployed URL.
- Ten fixtures and six contracts rendered.
- Dead-letter recovery, idempotent no-op, contract block, JSON import, JSON export, nonblank Canvas, and keyboard checks passed.
- Desktop and mobile overflow: none.
- Browser console errors: none.
- Failed requests: none.

## Privacy Check

- No private email address, credential, signing secret, API key, production endpoint, customer event, or analytics integration is included.
- All payloads, endpoints, IDs, and delivery attempts are fictional.
- Local imports remain in browser memory.

## Commit Identity

All commits use `Gabe Baires <278264124+jubjub-cpu@users.noreply.github.com>`.

## v1.0.1 hardening

Validated locally on July 18, 2026.

- Increased secondary and status contrast and added keyboard focus plus an accessible label to the contract registry.
- Repository validator, replay-engine tests, and local browser workflow passed.
- Local and deployed axe-core audits passed at desktop and mobile viewports with zero violations.
- The deployed browser workflow passed with zero console errors, failed requests, or desktop/mobile overflow.
