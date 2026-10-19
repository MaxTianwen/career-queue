# Career Queue

[中文](README.md) | **English**

A local workspace for Canadian co-op and internship discovery, school opportunities, reviewed documents and separate school/employer application records. It does not submit applications automatically.

## Run

Use Node.js 22+ (CI uses Node.js 24), then run `npm run start:v2` and open `http://127.0.0.1:4322/`. Use an existing local account or `npm run admin:v2`. If the background service is running, open the page without starting another instance. The legacy app uses `npm start` on port 4317; data is not migrated automatically.

Document operations need Python with `python -m pip install -r scripts/requirements-test.txt`. Set its absolute executable path in the private local file `private/v2-local/runtime.json`, for example `{"python":"C:/path/to/python.exe"}`. Preserve existing settings. Legacy document tests also read the `python` field in `private/resume-templates/templates.json`. Do not commit these files. Local Word generation requires Microsoft Word; returned offline PDFs are inspected with Python libraries, and returned DOCX files are not rendered again by Office.

## Discovery and documents

Opening the signed-in app and manual refresh discover public opportunities. Results sort by official publication date descending, with unknown dates last. Date-only sources retain day precision; exact timestamps take precedence within the same UTC day. A newly discovered identity keeps its marker for less than 24 hours from first discovery; refreshes and reappearance do not reset it. Publication within 24 hours is independently determined from an explicit timestamp. “New” does not mean newly published. Country, track, term and duration filters remain independent. Daily background discovery is disabled.

School listings retain source identity and application history. An explicit school submission does not imply employer submission. Missing dates and uncertain eligibility remain unknown. Prepared documents do not create application records.

### Offline batch exchange

1. In My Files, parse and review each uploaded original, select CS or Data as its purpose, and confirm activation. Firmware/Embedded uses CS. Mixed, unknown or missing-baseline jobs require an explicit per-job choice. Legacy single-resume mode remains available until track routing is configured. Select 1–5 jobs and a generic cover-letter Word source; export uses the same selected resume as scoring. PDF originals can be scored but cannot serve as Word optimization sources.
2. Preview the exact JD text, source links and capture status before export. Missing text blocks export; short valid text is allowed. Truncation hints are not completeness certification. A manual review applies to that job's current content fingerprint and expires when the text changes. Unreviewed status is disclosed in the exported prompt.
3. Check capacity and download the task ZIP. Personally use an external AI or editing tool if desired. The app has no built-in semantic rewriting, paid model API, automatic document sharing or submission. Return `return-manifest.json` at the ZIP root, the four specified DOCX/PDF files per job and evidence-backed change notes.
4. Preview the returned ZIP, select valid jobs and confirm import. A damaged document, multi-page PDF, or missing/malformed sources/files manifest field invalidates its job; dangerous archives, macros or scripts reject the whole package. Success focuses results; failure focuses the error. Imported documents remain pending personal review.

Importing A and then the same-version A+B creates only B. Changed JD, sources or outputs retain separate versions; old records are not deleted. Identical bytes can be reused within the same account, document role and format. The 20-file/20MB account limit includes source and archived files. Export gives a conservative estimate of four new files per job; import atomically rechecks actual bytes, reuse and selected jobs. Five-job exports are not universally prohibited.

The separate original-text reorder feature only applies reviewed rearrangements; it is not semantic tailoring. Offline validation checks one-page rendered PDFs and Word/PDF token sequence, not factual truth, eligibility, final Word layout or ATS performance. No screening success is promised.

## Verification

This release passed 1081/1081 local serial tests, including actual Word/PDF checks, and 44/44 isolated local Edge checks using synthetic accounts. Final user acceptance with real personal documents is still pending. These checks do not replace personal document review; inspect GitHub Actions for the specific commit separately. See [this release scope and limits](docs/releases/2026-10-19-task01-routing-freshness.md).

Run `npm run test:serial`. For full local Windows Word coverage, set `CQ_V2_TEST_PYTHON` to the installed Python executable and `CQ_V2_TEST_WORD=1`. CI uses synthetic fixtures on Linux with `CQ_V2_TEST_WORD=0`; Word and authenticated browser acceptance remain local checks. See [release scope and verification](docs/releases/2026-10-18-offline-exchange.md) and [browser extension instructions](browser-extension/README.md).

## Privacy

Never commit private configurations, credentials, databases, backups, personal resumes/cover letters, original school/JD exports or machine-specific diagnostics. `private/`, `output/` and `.env` remain local. Review the staged file list and contents before publishing; ignore rules do not remove already tracked files or history. Materials must preserve confirmed facts and contribution boundaries.
