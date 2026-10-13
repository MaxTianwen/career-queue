# Six-item reliability review — 2026-10-13

This follow-up preserves the existing UI and workflow. Tests use isolated synthetic records.

| Checklist | Verified coverage | Limits |
| --- | --- | --- |
| Loading and navigation | Navigation, preserved results on refresh failure, retry and coalesced refresh have isolated browser coverage. | Authenticated production failure injection was not performed. |
| JD and term/duration | Identity matching, description caching, term/duration pairing and unknown values have regression coverage. | Missing text stays unknown; denied sources are not retried. |
| School workflow | Preview before confirmation, idempotency, stale previews, independent channels and withdrawal retention have regression and browser coverage. | No real submission or withdrawal was used as a test. |
| Deadlines and eligibility | This update preserves cached deadlines, carries structured deadlines into saved-application checks and displays independent expiry/closure labels. Existing geographic and citizenship tests remain. | Availability checks run during preparation, not continuously for every displayed job. Missing listings and fetch errors are not closure evidence. |
| UI and performance | Responsive layout, keyboard, card/table and controlled-latency checks remain. Three additional browser checks cover module loading and shared deadline labels. | Synthetic timing is not a guarantee for every network or account size. |
| Regression and recovery | Local suite: 843 passed, zero failed or skipped, with Word/PDF enabled. Independent restoration verified business tables and cleared sessions. | Remote CI is tracked separately; no dedicated lint/typecheck command is configured. |

## Changes

- Reusing complete descriptions after refresh or detail failure preserves deadlines and evidence. New explicit dates take precedence; new complete descriptions may return a deadline to unknown.
- Saved-application checks consult the matching catalogue URL for structured deadlines. A changed deadline invalidates the previous short-lived check.
- Cards and tables show expiry using the existing Toronto date boundary. Explicit school closure is labelled as school evidence, without inferring employer closure or treating submission as closure.
- Five targeted chain tests cover refresh, persistence, filtering, preparation, date changes and unknown outcomes. Date-label assertions use a fixed clock.

JavaScript syntax and git whitespace checks passed. Isolated local Edge module/card/table checks passed with no browser exceptions. Production records were not used to manufacture test transitions. No application was submitted.

Run with Node.js 22+ using `npm run start:v2`, then open `http://127.0.0.1:4322/`.
