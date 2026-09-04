# Methodology

## Official observations

The monitor distinguishes source observations from BondStats analytics.

- **Shibor:** official CFETS / National Interbank Funding Center publication.
- **LPR:** official CFETS / National Interbank Funding Center publication.
- **FR / FDR fixing rates:** official CFETS public benchmark files.
- **Open market operations:** factual operation fields extracted from official PBoC open-market-operation announcements.

## Fallback behavior

A failed fetch is not converted into a new observation. The pipeline keeps the last verified value and changes source health to `fallback`.

## 7D OMO net flow

When sufficient recent official 7-day reverse-repo observations are available, the monitor compares the latest 7-day operation amount with the corresponding 7-day maturity cohort. It is shown as a 7D OMO flow measure, not as a complete measure of every PBoC liquidity instrument.

## Liquidity Regime

Injecting / Neutral / Draining is a BondStats composite using observable official liquidity-operation and money-market variables. It remains disabled when there is insufficient source coverage.
