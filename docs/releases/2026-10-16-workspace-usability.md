# Workspace usability and account isolation — 2026-10-16

This source update includes the accumulated local workspace changes since the previous main revision. It does not deploy a public service, enable registration or configure email delivery.

## Workspace behavior

- Filters: the redundant jump is hidden while filters are visible; a keyboard-accessible return appears after scrolling away. The reset button shows the active condition count and a neutral empty state. Clearing removes all constraints, including country/year; initial defaults remain Canada/2027.
- Manual entry: the action is labeled “手动添加职位”. Company and title are required; a job URL or description can be supplied. Saving prepares a draft, not a submission or automatic application.
- Refresh: actions are right aligned on desktop and stacked on mobile. Running refreshes expose progress; repeated clicks do not start another run. Existing cooldown and source-status semantics are unchanged.
- Applications: compact six-column tables and one card per job share explicit school/employer states and dates. Missing employer steps remain visible. Evidence, channel editing and corrections remain in collapsible details; unknown dates are not replaced by import timestamps.
- Files: Resume/Cover Letter classification, soft deletion/history access and owner-bound PDF page images or clearly labeled DOCX text previews. Viewing does not activate a resume or approve application materials.
- Discovery: country, duration, publication and field precedence fixes preserve evidence and unknown values. School and public records retain independent source and submission history.

## Account and operational boundaries

Member-only enrollment has an atomic 30-member limit independent of the operator account. Invitations remain compatible. Account disable/restore, session revocation, owner checks and layered rate limits are covered by isolated tests. Email verification/reset code fails closed without a configured transport; this update does not connect an email service or open enrollment.

Restored backups revoke copied sessions and keep registration closed; live sessions are preserved during local source reloads. Port collisions fail before database initialization. No personal database or content is included in this commit.

The browser extension source is version0.3.8. Manual current-page reading is separate from experimental navigation/diagnostics; real authenticated portal automation is not claimed verified. See browser-extension/README.md.

## Validation

Run npm run test:serial. CI uses Node24 and Python with scripts/requirements-test.txt; it does not run Microsoft Word. Local Word/PDF checks require CQ_V2_TEST_WORD=1 and the existing local runtime. Preview fixture generation accepts CQ_V2_TEST_PYTHON and does not require private configuration in CI.

The isolated browser script node scripts/test-filter-actions-ui.mjs covers desktop/mobile reset state, keyboard focus, return-to-filter access, manual entry, refresh coalescing, application table and private file previews. It uses synthetic accounts and documents only. Source publishing is distinct from local process activation and public deployment.
