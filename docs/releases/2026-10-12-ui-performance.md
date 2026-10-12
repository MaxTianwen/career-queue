# UI and loading performance — 2026-10-12

Cards, responsive tables and filters use a consistent neutral layout with restrained hover depth, keyboard focus and reduced-motion support. Search combines company, title and requisition/school identifiers without searching private notes. Duration provenance badges are removed; stored evidence and school/company source badges remain intact.

Switching tabs no longer disables the workspace while reading lists. Loaded views are reused for 60 seconds within the current account session; writes and logout invalidate them, concurrent reads coalesce, and stale responses cannot overwrite a newer session. Failed reads retain existing results and allow retry. Entry discovery and manual refresh remain enabled; no recurring discovery schedule or persistent private-data cache is added.

Opportunity merging now checks identifiers before parsing identity conflicts. Matching/conflict semantics remain unchanged. Read-only production projections, including 14 application records, matched their pre-change hashes.

## Validation

- Final full serial Node test suite: 827 passed, 0 failed, 0 skipped on the final code; real Word/PDF enabled.
- Actual app in an isolated Edge browser on the user's computer, with synthetic accounts and jobs: responsive layouts, keyboard focus, reduced motion, no visible duration provenance, session reads, retry and manual refresh checked.
- With an artificial 600 ms delay on every GET, first job display after registration improved from 7.10 s to 0.86 s. Existing-session reentry took 1.30 s; warmed tab switches were interactive in 30–33 ms with no repeated list requests. These are controlled measurements, not production-account end-to-end timings.
- Read-only production list projection improved from 3.185 s to 0.315 s in the measured run. Timings are observational, not performance guarantees.
- JavaScript syntax and git whitespace checks passed. No separate lint or typecheck script is configured.

Run with Node.js 22+ using `npm run start:v2`; open `http://127.0.0.1:4322/`. No database migration, Portal restart, external submission or deployment is required.
