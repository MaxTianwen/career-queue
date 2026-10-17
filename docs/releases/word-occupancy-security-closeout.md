# Word export occupancy protection and authorization regression closeout

The legacy Word exporter now shares the existing v2 Word mutex, refuses an existing Word process or an interactive/document-bearing COM instance, and restores options or quits only an instance it owns. This protects user documents while preserving read-only synthetic export behavior.

Regression coverage verifies that both exporters reject an occupied shared mutex before opening documents. The existing account-security fixture now also checks member and administrator access to another owner's confirmation changes and file view, including mismatched job/record IDs, unchanged owner data after rejection, and authorized positive controls. No account authorization implementation or deletion semantics changed.

Validation on the isolated Windows environment: 1,023 passed, zero failed, zero skipped. The formerly skipped PDF rendering, PDF baseline switching, and legacy Word/PDF review tests ran after supplying only the existing Python runtime path in isolated configuration. Focused document and security suites passed 5 and 24 tests respectively. No user documents or production data were used. An interrupted run and an incomplete test-copy failure were retained locally; the final complete suite passed.

The new mutex test requires Windows and is skipped on Linux CI. Local zero-skips does not imply Microsoft Word availability in CI. No private runtime configuration, logs, generated files, credentials, or databases are included in this change. No service restart, registration/email enablement, or data migration is required or performed as part of publication.

Publication follow-up: CI exposed a date-boundary defect in the new synthetic ownership fixture: a UTC date was validated using the default Toronto date. The fixture now pins the UTC/Toronto boundary and supplies timezoneOffset=0; production date validation is unchanged. All 13 security-file tests pass after this test-only correction. The earlier 1,023-test Windows run predates this fixture correction; final CI validates the published revision.
