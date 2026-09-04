# BondStats China Liquidity Monitor

**Tracking the pulse of China's monetary system**

A dependency-free GitHub Pages data product using official public PBoC / CFETS sources, automatic GitHub Actions refreshes, validation, source-health telemetry and last-verified fallbacks.

## Repository setup

1. Upload the complete repository including the hidden `.github` folder.
2. On macOS Finder, press `⌘ + Shift + .` if `.github` is hidden.
3. GitHub → **Settings → Pages → Source → GitHub Actions**.
4. GitHub → **Actions → Refresh & Deploy China Liquidity Monitor → Run workflow**.

Recommended repository name:

`bondstats-china-liquidity-monitor`

Expected Pages URL:

`https://botapi33.github.io/bondstats-china-liquidity-monitor/`

Expected live JSON:

`https://botapi33.github.io/bondstats-china-liquidity-monitor/data/live.json`

## Data integrity

The pipeline never manufactures a replacement market observation. If a source fetch or normalization fails, the previous verified observation is retained and its status becomes `fallback-last-verified`. The UI exposes source health.

Current adapters:
- CFETS Shibor official public endpoint
- CFETS LPR official public endpoint
- CFETS FR/FDR official public CSV
- PBoC open-market-operation public announcements hosted through ChinaMoney

The update schedule is every 15 minutes. This is **near-real-time publication monitoring**, not tick-level market data.

## Copyright / reuse design

BondStats stores and displays factual numeric observations, dates, status metadata and source links. It does not reproduce operator logos, copyrighted graphics, page layout or substantial announcement prose. Source attribution is retained in `public/data/sources.json`.

Before commercial redistribution at scale, re-check source terms periodically. The monitor intentionally does not use ChinaBond pricing/index datasets.

## Analytics

`liquidityRegime` is a clearly labelled BondStats analytical composite. It is not an official PBoC signal or classification.
