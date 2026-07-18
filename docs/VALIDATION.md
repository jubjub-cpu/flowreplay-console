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

Status: pending the first GitHub Pages publish.

The deployed browser suite will run against `https://jubjub-cpu.github.io/flowreplay-console/` and must match the local workflow before v1.0.0 is released.

## Privacy Check

- No private email address, credential, signing secret, API key, production endpoint, customer event, or analytics integration is included.
- All payloads, endpoints, IDs, and delivery attempts are fictional.
- Local imports remain in browser memory.

## Commit Identity

All commits use `Gabe Baires <278264124+jubjub-cpu@users.noreply.github.com>`.
