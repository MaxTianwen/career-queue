# 2026-10-13 acceptance and reliability update

## Findings and changes

- App tabs did not create browser history and a shorter view clamped the previous view's scroll. Session-only view positions and account-scoped history now restore back/forward and tab navigation; only view names and a random navigation marker enter history. Filters and loaded DOM remain intact. Logout discards positions and ignores old-account history.
- A 401 from an official API previously allowed a second page read. It now stops with unknown availability, preserving the job. No access restriction is bypassed.
- Known deadlines were inside collapsed details. Cards and tables now expose independently labelled employer and school deadlines, without inferring missing dates. The accepted design and reduced-motion behavior remain.
- School imports, exact identifiers, ambiguous status refusal, independent employer/school confirmations, withdrawal and repeated-import behavior were audited and tested. Existing behavior was preserved, including keeping an employer submission when a school confirmation is withdrawn. Fetch failure remains unknown; citizenship and US remote restrictions remain evidence based.

## Evidence and limitations

- Automated real authenticated browser acceptance: **not performed**. The user subsequently reported manual success for refreshing then filtering/scrolling, switching tabs and returning, back/forward, and opening an employer site then returning, with no reported lag or state loss. This does not cover school import or broader application flows. This execution context exposes opening a browser panel but no supported tool to inspect/control the user's authenticated browser. Minimal next step: connect such a browser and sign in personally at localhost:4322. No password, session token or browser profile was extracted.
- Browser: **45 assertions passed**, no browser exceptions, in isolated Edge on the user's computer using synthetic accounts. Covered navigation/back/forward, filters, card/table position, separate-tab return, keyboard focus, 320–1440px layouts, independent deadlines and reduced motion. A separate blank tab return was exercised; real employer-site/account behavior remains unverified.
- Controlled performance with 600ms per GET: first job display 0.88s; existing-session reentry 1.30s; warm tabs approximately 31ms and no repeated list GETs; filter render 1.6ms. Failure kept 20 existing cards and controls enabled; retry succeeded; two manual clicks produced one update. These are synthetic timings, not real-account end-to-end measurements.
- Full local final suite: **838 passed, 0 failed, 0 skipped**, real Word/PDF enabled. Clean source-only Windows copy: **832 passed, 0 failed, 6 skipped** (Word/legacy local runtime dependencies). JavaScript syntax and git whitespace checks passed. No separate lint/typecheck script is configured.
- CI file uses pinned official action SHAs, read-only repository permissions, no persisted checkout credentials, no secrets, no private data upload and explicit Python dependencies. Remote GitHub execution has not been confirmed at publication; clean Windows execution is not proof of Linux runner success. No YAML parser is installed locally; workflow structure was manually reviewed.
- Source snapshot timestamp: 2026-10-12T01:44:52.948Z. Public catalogue: 127 jobs, 110 Canadian; 83 with explicit duration/range/weeks/calendar interval, 26 without identified duration and 1 missing JD. Combined Canadian pending view: **130 total, 99 with duration evidence, 27 not explicit, 4 missing JD**. Counts describe this snapshot, not a fresh all-source discovery.
- Re-read 26 exact public descriptions successfully; no new explicit durations found. One employer's recorded access refusal was not retried. Three remaining school-only gaps lack URLs and pasted JDs; they require the user to paste the actual descriptions. The additional school-only description has a start date but no supported end date/duration. No months were inferred or production records rewritten.
- Live backup restored to an independent private directory; every business table matched and restored sessions were absent. At the first closeout, all 25 business tables matched. After the user manual check, existing applications and 23 personal/business tables still match; only catalogue and discovery_state changed, with an open-triggered refresh recorded. 35 unrelated pre-existing files remain unchanged. Backup copies stay private.

## Running and changed files

Use Node.js 22+ and `npm run start:v2`, then open `http://127.0.0.1:4322/`. The existing Career Queue service was reloaded after testing; Portal was not restarted. No application was submitted, no record permanently removed, no extra permission created, and publication is a separate authorized step.

- `src/availability.mjs`
- `web/v2/app.js`
- `web/v2/school.js`
- `web/v2/opportunity.js`
- `web/v2/opportunity-view.js`
- `web/v2/page-stability.js`
- `web/v2/editorial.css`
- `test/resume-bases.test.mjs`
- `test/resume-document.test.mjs`
- `test/acceptance-regression.test.mjs`
- `.github/workflows/ci.yml`
- `scripts/requirements-test.txt`

Private evidence: `private/<local-evidence>`, `audit-before.json`, `live-jd-audit.json`, `after-browser.json`, `perf-after-browser.json`, `full-tests.log`, `clean-ci-tests.log`. These files and local screenshots/backups are excluded from Git.

## School import pre-confirmation follow-up

The previous primary button wrote the pasted list before showing the comparison. It now calls the existing read-only preview endpoint first and shows new rows, unchanged duplicates, updates, source-status transitions and school submission effects. A separate confirmation writes; cancel/return does not. Editing text invalidates the draft. Invalid/duplicate IDs block confirmation. Employer status/dates and local school withdrawals are preserved.

The HTTP write endpoint now requires confirmed=true, a current preview fingerprint and an operation UUID. It validates the preview in the write transaction and reuses the existing school_imports receipt table; there is no schema change. The same request replays its persisted response after a lost response or restart without reapplying writes, even if the user subsequently withdrew the confirmation. Changed text under the same request ID is rejected. Receipt-write failure rolls back school rows, submission observations and confirmations together.

Final isolated Edge import checks: **12/12 passed**, including preview/cancel zero writes, text invalidation, concurrent-state stale refusal, lost-response retry, double clicks, duplicate preview, source-status changes that do not withdraw records, local-withdrawal retention, and mobile layout. These used synthetic accounts/data; no real school or application records were changed. Four new store tests and one HTTP protocol test bring the full suite to **838 passing**.

Additional changed files: `src/v2/store.mjs`, `src/v2/server.mjs`, `web/v2/index.html`, `web/v2/school.js`, `test/v2-workspace.test.mjs`, `test/school-preview-confirmation.test.mjs`. Existing workspace HTTP fixtures now explicitly preview and confirm.

Latest private evidence: school-preview-final.json, school-preview-browser.json, school-preview-full-tests.log, school-preview-clean-ci-tests.log under `private/<local-evidence>`. The pre-reload backup is also retained privately. Career Queue was reloaded after testing; Portal was not restarted. Validation completed before the separately authorized release.

Historical count clarification: a source snapshot count changed when a previously listed public role disappeared from a later complete index response. This happened before the update, is not proof of employer closure, and does not establish an extraction regression. Later refreshes mean snapshot counts are historical.
