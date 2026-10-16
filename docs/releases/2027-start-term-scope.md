# 2027 opportunity scope and start-term correction

Discovery and school opportunities now use a fixed 2027 start-year scope without a redundant year selector. Explicit other-year opportunities are excluded; unknown starts remain visible with a verification notice. Saved jobs and application history retain their existing scope.

Start terms use explicit placement/interval/window starts rather than all years in mixed text. End dates and graduation years do not become start years. Explicit months reuse the existing internship season mapping. Availability-window filters keep duration, start year and season linked to the same option.

A retained public Qualcomm posting (requisition 3096801) provides May/June 2027 starts for separate 12- and 16-month windows ending in 2028. It now yields Summer 2027; an FY27 title alone yields no inferred start year. The original screenshot pixels were not inspected; validation uses the exact title, requisition and retained official-source text.

Validation: final isolated full suite 1,018 passed, zero failed, three skipped; desktop/mobile UI 90 passed. Protected real Word single-page export and two-page rejection passed. Three older PDF/review integration tests remain skipped because their private runtime is not configured. An earlier obsolete unknown-season assertion was updated to the requested month mapping while preserving date precision checks.

Local activation preceded this commit. Source and database backups were verified by an independent restore; all database table fingerprints, schema, sessions and historical records stayed unchanged. Served modules matched the tested candidate. No data backfill, account changes or registration enablement occurred. Only the workspace service was restarted.

Rollback: restore only the audited source files from the local activation backup (remove new candidate files only after verifying they are unchanged), then restart the workspace service. Database replacement is unnecessary for this code-only change; routine disaster-recovery backups intentionally revoke restored sessions.
