# China Liquidity Monitor v3 — current-data fix

This patch keeps the v2 UI and replaces the data pipeline.

## What changed
- Adds multiple official-source routes for SHIBOR: CFETS API, chinamoney.org.cn mirror, Shibor.org recent-business-day page, and the official Shibor page.
- Adds multiple official-source routes for LPR.
- Makes FR/FDR parsing header-agnostic and retries both ChinaMoney public domains plus historical endpoints.
- Adds PBoC OMO parsing for both positive operations and explicit zero-operation days.
- Keeps the last verified observation if a source is temporarily unavailable.
- Uses latest published business-day data. On weekends the correct latest values remain Friday's fixings instead of being shown as stale/missing.
- Bootstraps `live.json` with the latest verified 2026-09-04 market observations so the public UI is no longer blank while the official-source adapters recover.

## Install
Overlay the ZIP on the existing repo, commit/push, then run:

Actions → Refresh & Deploy China Liquidity Monitor → Run workflow

After the run, inspect `public/data/live.json` and the workflow log. `sourceHealth` shows exactly which official source paths succeeded.
