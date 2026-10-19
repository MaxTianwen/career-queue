# Task01: publication ordering and resume routing — 2026-10-19

## Behavior

- Opportunities sort by official publication date descending; unknown dates follow known dates. Date-only values keep their original precision. Exact timestamps use UTC calendar-day groups and precede date-only entries within the same day, without inventing an exact publication time.
- First-discovery markers last less than 24 hours and survive repeated refreshes or disappearance/reappearance. Missing historical first-seen dates stay unknown. The separate recent-publication filter requires an explicit timestamp; date-only values cannot claim exact 24-hour freshness.
- Reviewed CS and Data originals are configured in My Files. Local JD-duty rules choose the appropriate original; Firmware/Embedded uses CS. Generic Python/SQL or a title alone cannot decide. Negated requirements and a collaborator's skills do not provide positive candidate evidence; optional paired requirements do not decide a track.
- Scoring, material context and offline export use the shared selection. Mixed/unknown duties or missing baselines need a per-job choice. Legacy single-resume use is explicitly labeled. PDF originals can support scoring, while offline Word optimization requires an uploaded Word original.
- Selection fingerprints protect returned packages and generation contexts when the JD, baseline or override changes. Originals remain unchanged; in-use bindings protect against accidental archiving.
- Missing, null or malformed sources/files fields produce job-specific return-manifest errors. Valid jobs in the same package can still be imported and reused idempotently. Dangerous archive structures, unsafe paths/documents and account boundaries remain whole-package rejection conditions.

## Verification and limits

- Targeted offline/routing regressions: 27 passed, 0 failed.
- Full local serial suite: 1081 passed, 0 failed, 0 skipped; CQ_V2_TEST_WORD=1, including actual Word/PDF tests. The tested code is unchanged for this publication; README and this release note only clarify behavior and acceptance limits.
- Local Microsoft Edge, headless with isolated profiles and synthetic accounts: 22 checks at each of 1280px and 390px, 44 passed. Covered baseline setup, classification/score/source consistency, manual overrides, export, malformed return fields, valid-row import and repaired-package reuse. Screenshots were generated; this run did not add manual visual screenshot review.
- The new UI reuse assertion initially regenerated different DOCX bytes on each retry. The fixture now retains identical document bytes; the product deduplication logic was not changed to accommodate the test.
- Local activation included a validated backup and unchanged hashes for all 42 database tables. No user baseline settings, original document bytes or application records were replaced. Operational logs, backups, personal files and machine-specific diagnostics remain local and are not included in this release.
- User acceptance with real personal documents is pending. Classification remains a conservative local rule system, not semantic AI. Scores are evidence-coverage references, not employer ATS scores or admission probabilities. The app does not call an external AI, share documents automatically or submit applications.
- CI uses synthetic Linux fixtures and skips Windows/Word-specific coverage by design. The status of this exact commit must be checked in GitHub Actions; local test success is not a claim that remote CI has run.
