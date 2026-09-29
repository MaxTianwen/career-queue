# Career Queue v1.2.2

[中文](README.md) | **English**

A personal workspace for finding Canadian co-op and internship opportunities. Manually run job discovery, filter Winter / Summer / Fall 2027 roles, save selected jobs to Notion, and prepare, preview, and edit one-page resumes for individual positions.

**Discover jobs → Save to Queue → Generate and review materials → Confirm materials and mark ready to submit → Personally confirm submission.**

Current release: `v1.2.2`, published with user authorization to main and the matching tag in the existing private GitHub repository. Local sentence comparison and review are included; model-based semantic rewriting remains deferred. See [CHANGELOG](CHANGELOG.md) and [PROJECT_SPEC](PROJECT_SPEC.md).

## Start and verify

Requires Node.js 22+; tested locally with Node.js 24. There are no npm runtime dependencies. From the project root, run:

```powershell
npm start
```

Open http://127.0.0.1:4317 . The server listens on localhost only. Keep the terminal running; if it is closed, run the same command again.

Without private configuration, you can still open the dashboard, try the clearly labeled demo workspace, or manually trigger public job discovery. The live Queue requires Notion; matching scores require the current resume and local Python text extraction environment; resume generation, editing, and PDF preview require the local document environment. The shareable source code excludes these private resources and is not a general-purpose resume editor that works out of the box.

```powershell
npm test
node src/cli.mjs check
node src/cli.mjs preview --input examples/jobs.example.json
```

Examples contain synthetic data; do not import them into your live Notion database. This version adds eligibility, availability, input-version and historical-material protection tests; final regression results are recorded in [CHANGELOG](CHANGELOG.md). Public read-only spot checks are reported separately from simulated API and demo tests. Tests do not write to live Notion or submit applications. A checkout without the private document environment skips the corresponding document protection test; a skipped test is not a pass. `check` inspects configuration only; `verify` reads the actual Notion schema.

## Current features

### v1.2.2 local sentence comparison and review

- Choose “准备简历修改对照” (Prepare resume comparison) to inspect original and proposed text, the exact supporting sentence and position in the active Word document, and related JD quotes. Keyword correspondence explains ordering, not eligibility.
- Accept or keep each whole same-experience reorder group; partial swaps cannot duplicate or remove bullets. No decision is preselected. If there is no safe adjustment, the app explicitly offers an unchanged copy.
- Confirm choices to create new DOCX/PDF versions, preserving typography and layout and enforcing one page. The latest PDF is automatically associated; final material review remains a separate confirmation.
- PDF preview includes “查看修改依据” (View change evidence). Manual edits record before/after text as user input with unverified facts. Older versions without review records are labeled honestly.
- Drafts bind the job, JD, resume files and assessment. They expire after 20 minutes or a service restart; input changes require a fresh comparison. Failed generation retains choices and does not publish unchecked files.
- Per user decision, this release uses local verbatim reordering only. Model integration and semantic rewriting remain deferred; historical knowledge-base text is not inserted.

### v1.2.1 public employer discovery

- Searches the existing index plus the public Tenstorrent University, Cohere and Telesat boards. These are three named employers, not all employers on three ATS platforms.
- Partial failures retain other results. Discovery metrics distinguish raw rows, scoped candidates, incremental verified / pending results, deduplication, inline descriptions and actual detail requests.
- Grouped sources keep separate JD text and evidence. Salary currency and period, duration ranges and workplace evidence remain explicit; missing values are not guessed.
- The read-only live run found three incremental candidates requiring review, including two Cohere Winter 2027 postings. None passed every rule without review. See [source audit](docs/DATA_SOURCES.md).


### v1.2.0 eligibility, availability and material evidence

- Job details separate required, preferred and alternative requirements, preserving JD quotes and evidence from the current resume. Missing resume evidence does not prove inability. Complex, negated, education, enrollment and work-authorization conditions remain unverified unless personally confirmed. Only a confirmed conflict with a current-JD mandatory condition causes rejection. Return-to-school arrangements are excluded at the user's request.
- Personal confirmations apply to the current job and JD version; changes invalidate old confirmations. Match Score still uses active resumes with unchanged weights, without adding historical knowledge-base facts or personal eligibility answers.
- Generation and preparation recheck the selected official posting, showing open, closed or unknown status with the check time. Open checks can be reused for 15 minutes. Explicit closure blocks new generation; timeouts, maintenance, redirects or missing content do not prove closure. Unknown results can be reviewed on the official site and explicitly confirmed with supporting notes.
- Assessments bind the JD, active CS / Data resume versions and hashes, rules and confirmations. Changed inputs trigger recalculation and flag older materials for regeneration or explicit re-review. Generation, manual editing, material approval and submission retain their corresponding snapshots; originals and submitted PDFs are preserved.
- The earlier v1.2.0 added no discovery source, model or form-filling integration. A read-only RBC Workday spot check returned open; a Super Ashby check remained unknown, not confirmed closed.

### v1.1.3 school lists and independent submissions

- The School Tasks tab filters employer-submitted / school-pending, unlinked, unconfirmed requirements, school-submitted and school-expired records. School data stays in the existing Notion application Payload; no additional database or schema setup is required.
- Link a school job ID and URL in saved-job details, confirm whether school submission is required, and retain separate deadlines. Opening a link does not mark submission. Explicit confirmation records the actual date, confirmation time, optional receipt, and the submitted material snapshot or a user-provided description. Employer submission records its own snapshot; missing historical confirmation times remain unknown.
- Source information can be updated before school submission. Incorrect links can be detached and replaced while preserving history. Submitted school snapshots cannot be overwritten. There is no automatic school login, form filling or submission.
- Under School Tasks, paste the list including headers (browser tab-separated text or Markdown), review and edit extracted fields, match existing applications, and explicitly select links to save. Batches support 1–100 rows with repeat-import and partial-failure protection. Unmatched rows are not automatically added to Queue; pasted lists are not a second application database.
- School IDs remain separate from employer requisition IDs. The parser extracts clear trailing JR / numeric codes, reports incomplete copies and duplicate employer IDs, and preserves deadline text and minute precision. Times without a zone use Toronto.
- Missing URLs do not block matching; use the school ID to find the job and add its link later. App Status is source evidence only, not submission confirmation. Missing optional fields on reimport do not erase existing links or enrichment.

| Area | v1.1.2 capabilities |
|---|---|
| Job discovery | Public index discovery, official job descriptions from supported sources, progress and error reporting, and local search snapshots. |
| Job overview | Discovery cards, discovery details, and Queue details highlight duration, location, pay, work arrangement, and evidence-backed skills; missing facts remain unknown. |
| Sources and duplicates | Per-source JD and field coverage, retained source links, identity deduplication and automatic grouping by company, title, term, and location. Alternative links and requisition IDs are retained; different terms or locations remain separate. |
| Filtering and sorting | Start term, duration, work arrangement, Toronto / GTA / outside GTA, and city keywords; sorting by score or official publication date. |
| Saved Queue | Explicitly save selected jobs to Notion, detect duplicates, add notes, and archive; locate and highlight a record after saving. |
| Applications | Mark ready to submit after materials are uploaded; mark submitted only after personal confirmation and a submission date; record progress and next steps. |
| CS / Data resumes | Local rule-based tailoring for selected jobs with full descriptions, producing new DOCX / PDF versions while preserving the original formatting. |
| Preview and editing | Locally render the actual PDF, zoom and navigate pages, edit body text online, save a new version, and recheck the one-page limit. |

Click outside a details or preview dialog, or press Esc, to close it. Unsaved edits prompt for confirmation. Generating a resume or saving manual edits does not upload files to Notion or change the application status. The latest validated PDF is automatically associated with the same job. Preview it, check the review confirmation, and save it to Notion without downloading and uploading it again. Online edits associate the new version and reset the review checkbox.

## Search and scoring limits

- Automatic discovery combines the Simplify / Pitt CSC index with three named public employer boards. It is not a search of the entire web.
- Automatic official job-description retrieval supports **Greenhouse, Lever, Ashby, and Workday**. The manual `fetch-job` URL entry point supports Greenhouse only. See [DATA_SOURCES](docs/DATA_SOURCES.md) for endpoints, date semantics, and coverage limits.
- Workday reads JobPosting data from supported public job pages without an account or paid API. Redirects, login shells, missing data, and conflicting identities remain explicit failures. This does not search every Workday employer.
- The 24-hour view is an optional filter, not a job's validity period. First publication, official dates, and latest republication are labeled separately. Index inclusion dates never substitute for unknown publication dates.
- Jobs with recognized deadlines that have passed are hidden from discovery and the pending Queue; application history is retained. Unknown deadlines remain unverified, so the app cannot identify every closed posting.
- Match Score reads the active CS / Data resume and displays its filename and version. Before any upload, it uses the initial fixed resume baseline. Unreadable or scanned files without usable text remain unscored; the historical knowledge base is never a fallback. Mixed or unknown roles score both resumes separately, using the higher whole-resume score for ordering without combining skills. It measures local keyword evidence coverage: skills contribute 70% and experience themes 30%, with weights normalized when one component has no recognized items. Details show supporting evidence and gaps. It is not an ATS score, a complete eligibility assessment, or a probability of receiving an offer.
- Direction filters: CS / Data / mixed / unknown directions using titles and explicit JD duties. Descriptions have readable sections and lists, with green highlights for skills mentioned in the current resume, amber for basic exposure and blue for related experience. Hover or focus a highlight to view evidence. Plain-text sources receive reading layout rather than a reconstruction of the employer's original design; the source JD is not rewritten.
- Default location rules: GTA on-site / hybrid placements may last 4–16 months; those outside the GTA must last at least 8 months. Remote roles are exempt from the out-of-area minimum, but permission to work from Canada still needs verification.
- Explicitly unpaid roles are excluded. Undisclosed pay does not mean unpaid. Minimum-wage amounts are not hardcoded; cases without reliable comparison data remain unverified.

## Resume workflow and environment

Version 1.1.1: **我的简历 (My resumes)** accepts separate CS / Data Word (`.docx`) or PDF baselines, up to 10 MB each. A successful upload becomes the active baseline for that track and persists in `private/resume-bases/` across restarts. Previous versions can be previewed and explicitly reactivated; originals are never overwritten.

- Word files must initially contain readable text and fit one page. Uploaded-template tailoring conservatively reorders existing, identically styled adjacent bullets within the same experience based on the JD. Other content is preserved; it does not insert old knowledge-base facts or perform model-based rewriting. If no reordering is needed, the original text remains.
- An active PDF supports preview and scoring but blocks tailoring for that track until the matching Word file is uploaded. Unsupported complex Word layouts also block tailoring. Neither case silently falls back to an older resume; failed uploads leave the current baseline intact.
- Generated versions record their baseline and retain their own editable body fields even after later uploads. Uploading or switching a baseline recalculates scores and JD highlights. Scoring uses the active baseline, not a job-specific tailored version.
- The workbench now has top navigation, desktop side filters and a two-column opportunity grid, with a single column on mobile. Detailed evidence and sources remain in job details.

The dashboard currently uses Chinese labels; the steps below include the labels shown in the app.

1. Open a job's details, review eligibility and availability, choose automatic / CS / Data, and click “准备简历修改对照” (Prepare resume comparison), accept or keep each group, and confirm to generate. Unknown availability requires personal verification on the official site; closed jobs and confirmed mandatory conflicts block generation.
2. Once validation passes, the PDF preview opens automatically. Use “查看已生成版本” (View generated versions) to access older files.
3. In the preview, click “编辑文字” (Edit text), edit the summary, skills, or project / work-experience body text, then click “保存新版本并预览” (Save a new version and preview).
4. Headings, education, contact information, and paragraph structure are locked. Original files and previous versions are never overwritten. Users are responsible for verifying facts they enter manually.
5. If a document exceeds one page or fails formatting checks, it is not published. Font sizes and margins are not reduced; the entered text is retained for revision.
6. Preview the associated PDF in “申请材料” (Application materials), check the review confirmation, and save it as ready to submit. Materials with older or missing input evidence require regeneration or explicit re-review. Only the resume PDF is mandatory; a Cover Letter is optional unless required by the job. DOCX and review.md stay local. You can also select a PDF from your computer. Confirmed records retain their material version and hash; generating another version does not replace confirmed attachments.

Tailoring uses local rules, not a large language model. It selects previously verified factual statements, does not invent experience, skills, or achievements, and does not guarantee passing ATS or AI screening. `prepare --key '<key>'` only exports context; the dashboard's generation action performs the tailoring.

Original resumes are read-only. Initial fixed templates, baseline PDFs, factual mappings and runtime configuration live in `private/resume-templates/`; the knowledge base is `career_knowledge_base.md`. A hidden Microsoft Word instance exports documents without saving the source. Python / pdfplumber checks formatting, fonts, font sizes, boundaries, extractable text and the one-page limit; previews render locally. Other machines still need Word and the configured Python runtime. Upload new baselines through My resumes for validation rather than replacing files named in the private template configuration.

## Connect Notion

Notion is the sole store for live application records; Queue and Applications are two views of the same database. Authorization and schema verification have been completed on the original development machine. Machine-specific details are kept only in `private/SETUP_STATUS.md`.

For a new environment, copy `.env.example` to `.env`, enter a token, and authorize the integration to access the dedicated database. Do not overwrite an existing `.env`. For an existing database, configure its ID and run:

```powershell
node src/cli.mjs setup
node src/cli.mjs verify
```

`setup` only adds missing fields and stops on type conflicts. Do not run `init` again for an existing database. Only when creating a database in a separate, brand-new workspace should you use `node src/cli.mjs init --parent '<page UUID>'`. If there are multiple data sources, explicitly configure `NOTION_DATA_SOURCE_ID`.

Filter Queue by Status = Queue. Filter Applications by 待提交 (ready to submit), 已投递 (submitted), 面试中 (interviewing), or 已结束 (closed), excluding archived records. Database fields are Position (title), Company, Location, Salary, URL, Notes, Status, Application date, Next step, Term, System notes, Materials, Key, Payload, and Last seen. Manual notes are preserved; internal fields may be hidden.

## Distribution and known limitations

- Code, synthetic examples, and current documentation are suitable for inclusion in GitHub. Credentials, the knowledge base, templates, generated materials, logs, caches, and historical backups are excluded by `.gitignore`. Machine-specific AGENTS.md and unverified OpenClaw drafts remain local and are not part of the shareable v1.0 files.
- `.gitignore` does not remove sensitive files already committed. Review staged files and history before committing or pushing; credentials, private resumes, and generated materials are excluded even from a private repository. No open-source license has been selected.
- Writes are serialized within one server process. Do not use the CLI or multiple services to write the same record concurrently. Notion provides no cross-client transaction or uniqueness guarantee for this workflow.
- There is no automatic application submission, form filling, bulk resume generation, daily scheduling, email synchronization, or model API integration.
- Local feature verification is not a complete live application acceptance test. The full workflow using real materials, from upload through ready to submit and confirmed submission, has not yet been validated.

See [ROADMAP](ROADMAP.md): v1.2.1 is published. v1.2.2 local comparison and review are published; semantic rewriting is deferred. OpenClaw remains planned for v1.3. Semi-automatic applications move into v2.0 alongside the multi-user CS / Data pilot, in stages: establish accounts and data isolation, then trial assistance on selected sites, with the user clicking final Submit in the recommended first pilot. Sites, models, costs and data-transfer scope need decisions before implementation. None of these future features has started; the current app remains manually operated.
