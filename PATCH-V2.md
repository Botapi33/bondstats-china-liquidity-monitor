# China Liquidity Monitor v2 — full replacement

This patch replaces the data adapters and the entire standalone UI.

Key data fixes:
- CFETS LPR now uses the documented `cm-u-bk-currency/LprChrtCSV` dataset.
- CFETS Shibor now uses the documented `cm-u-bk-currency/ShiborPriHis` dataset.
- CFETS FR/FDR official CSV feeds remain direct.
- Every source now retries four times with browser-compatible headers.
- Source failures are isolated; successful feeds still publish.
- Last verified values are preserved and marked as fallback instead of becoming blank.
- OMO uses two official discovery hubs and improved parsing.

UI:
- Completely new East-Asia financial bulletin language.
- No generic dashboard-card layout.
- Restrained jade + vermilion accents, editorial grid, vertical Chinese labels and exchange-bulletin structure.
- No images, logos or copied third-party design.

Install by overlaying all files on the existing `bondstats-china-liquidity-monitor` repo. Keep the existing GitHub Pages setting. Commit/push and run `Refresh & Deploy China Liquidity Monitor`.
