# School official-detail identity validation

Official enrichment now rejects an explicit requisition ID that conflicts with the school record, even when company, title, location and cohort match. For AMD's known numeric job URL, the URL ID must also agree. A rejected update leaves the previously verified cache unchanged.

The URL comparison is intentionally limited to AMD; other ATS path IDs need not equal requisition IDs. Existing missing-ID matching and title-alias behavior remain unchanged. No schema, UI or data migration is required.

Fixed synthetic fixtures cover both conflicts and successful enrichment across a database reopen, retaining duration, term, location, country, publication date, original school records and owner isolation. The fixtures contain no private portal text or applicant records.

Local validation: 35 related tests and 1006 full regression tests passed, with actual Word/PDF enabled on the existing Windows/Node24 environment. Node22 was not separately tested. Run `node --test test/school-official-identity.test.mjs test/school-official-cache.test.mjs` for the focused checks.
