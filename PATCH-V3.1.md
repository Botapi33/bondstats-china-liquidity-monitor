# China Liquidity Monitor v3.1 — English-first UI + current-data fixes

This build keeps all v3 data-pipeline fixes and refines the interface for the
English-language BondStats platform.

## UI changes
- Replaces the large vertical Chinese label with `CHINA LIQUIDITY`.
- Replaces `北京 · 货币市场` with `BEIJING · MONEY MARKET`.
- Keeps only one small Chinese character (`流`, “flow”) inside the seal as a
  restrained visual accent.
- Keeps the existing premium East-Asia financial-bulletin layout.

## Data fixes retained
- Multi-route official SHIBOR retrieval.
- Multi-route official LPR retrieval.
- FR/FDR official fixing retrieval with fallbacks.
- PBoC OMO parsing including zero-operation days.
- Last-verified fallback logic.
- Latest-published-business-day handling.
- Source-health telemetry.
- No hard-coded future dates or fragile URL-path assertions.

## Additional bug fix
The validator now accepts schema v3, matching the current `live.json` generated
by the new pipeline.

Install by overlaying this repository on the existing
`bondstats-china-liquidity-monitor` repo, commit/push, then rerun:

Actions → Refresh & Deploy China Liquidity Monitor → Run workflow
