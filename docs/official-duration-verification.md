# Official duration verification — 2026-10-12

AMD's current public route is `/careers-home/jobs/{id}`. A normal public GET for exact posting 91320 returned HTTP 200 and an exact JobPosting description. Fourteen additional existing AMD requisitions also returned their own descriptions and explicit durations. These were separate real public reads, not mocked responses and not copied durations.

The defect was acquisition: the index supplied the older `/jobs/{id}` path, and a previous refusal was cached for the entire host. Detail reads now use the verified current official route while existing catalogue identity remains stable. Refusals on the current route persist across refreshes; there is no fallback after a 401/403/429. No authentication, proxy, CAPTCHA workaround, or browser protection change was used.

91320 preserves the user's excerpt separately from the fetched official description. Its five linked choices are Winter 4/8 months, Summer 4/8 months, and Fall 4 months, with their original dates. Fall 8 must not match. User excerpts remain labelled as excerpts, not full JD retrieval. The UI distinguishes an excerpt from an additional official read.

Exact company/requisition/location evidence can associate a school record whose single term is among the official verified start options. Different requisitions, different years, and unsupported term matches remain separate. Original school records, applications and personal materials are not rewritten; independently cached official evidence is bound to the original school source hash.

Validation: full serial suite 820 passed, zero failures/skips, including real Word/PDF tests. Subsequent focused regression covering the final exact-term association and visible provenance: 35 passed. Native Edge on the user's computer, using a new isolated profile and the real database's 91320 projection, rendered the production front-end module and confirmed the five choices and Fall-8 rejection. This is not an authenticated production API test. Production health and served module hashes matched; authenticated production API verification remains unavailable without an authorized logged-in browser connection.

School batch collection remains unverified on the real Portal and is not represented as complete. Missing duration evidence is never inferred from weekly hours, hiring-response timelines, other postings, or generic program lengths. Private fetch responses, database backups, source rows and test outputs are excluded from publication.
