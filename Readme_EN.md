# Career Queue v1.1.1

[中文](README.md) | **English**

A personal workspace for finding Canadian co-op and internship opportunities. Manually run job discovery, filter Winter / Summer / Fall 2027 roles, save selected jobs to Notion, and prepare, preview, and edit one-page resumes for individual positions.

**Discover jobs → Save to Queue → Generate and review materials → Upload and mark ready to submit → Personally confirm submission.**

Version: `1.1.1`. Baseline date: September 25, 2026. See [CHANGELOG](CHANGELOG.md) for features and verification limits, and [PROJECT_SPEC](PROJECT_SPEC.md) for the current specification. Version 1.1.1 includes resume baseline uploads, the redesigned workbench, direction filters and readable job descriptions. Version 1.1.2 will add generated-material reuse and scoring against current resumes; school-portal linking remains deferred. These supporting documents are currently in Chinese.

## Start and verify

Requires Node.js 22+; tested locally with Node.js 24. There are no npm runtime dependencies. From the project root, run:

```powershell
npm start
```

Open http://127.0.0.1:4317 . The server listens on localhost only. Keep the terminal running; if it is closed, run the same command again.

Without private configuration, you can still open the dashboard, try the clearly labeled demo workspace, or manually trigger public job discovery. The live Queue requires Notion; matching scores require a private knowledge base; resume generation, editing, and PDF preview require the local document environment. The shareable source code excludes these private resources and is not a general-purpose resume editor that works out of the box.

```powershell
npm test
node src/cli.mjs check
node src/cli.mjs preview --input examples/jobs.example.json
```

Examples contain synthetic data; do not import them into your live Notion database. All 98 v1.1.1 regression tests passed, including Workday retrieval, failure handling, dates, deduplication, and cache upgrades. Tests did not write to the live Notion database. A checkout without the private document environment skips the corresponding document protection test; a skipped test is not a pass. `check` inspects configuration only; `verify` reads the actual Notion schema.

## Current features

| Area | v1.1.1 capabilities |
|---|---|
| Job discovery | Public index discovery, official job descriptions from supported sources, progress and error reporting, and local search snapshots. |
| Job overview | Discovery cards, discovery details, and Queue details highlight duration, location, pay, work arrangement, and evidence-backed skills; missing facts remain unknown. |
| Sources and duplicates | Per-source JD and field coverage, retained source links, conservative merges, and suspected-duplicate warnings. Conflicting identities require verification and manual entry. |
| Filtering and sorting | Start term, duration, work arrangement, Toronto / GTA / outside GTA, and city keywords; sorting by score or official publication date. |
| Saved Queue | Explicitly save selected jobs to Notion, detect duplicates, add notes, and archive; locate and highlight a record after saving. |
| Applications | Mark ready to submit after materials are uploaded; mark submitted only after personal confirmation and a submission date; record progress and next steps. |
| CS / Data resumes | Local rule-based tailoring for selected jobs with full descriptions, producing new DOCX / PDF versions while preserving the original formatting. |
| Preview and editing | Locally render the actual PDF, zoom and navigate pages, edit body text online, save a new version, and recheck the one-page limit. |

Click outside a details or preview dialog, or press Esc, to close it. Unsaved edits prompt for confirmation. Generating a resume or saving manual edits does not upload files to Notion or change the application status. After reviewing the materials, explicitly select the relevant files in the upload form.

## Search and scoring limits

- Automatic discovery uses one public index: Simplify / Pitt CSC's Summer2027-Internships. It is not a search of the entire web.
- Automatic official job-description retrieval supports **Greenhouse, Lever, Ashby, and Workday**. The manual `fetch-job` URL entry point supports Greenhouse only. See [DATA_SOURCES](docs/DATA_SOURCES.md) for endpoints, date semantics, and coverage limits.
- Workday reads JobPosting data from supported public job pages without an account or paid API. Redirects, login shells, missing data, and conflicting identities remain explicit failures. This does not search every Workday employer.
- The 24-hour view is an optional filter, not a job's validity period. First publication, official dates, and latest republication are labeled separately. Index inclusion dates never substitute for unknown publication dates.
- Jobs with recognized deadlines that have passed are hidden from discovery and the pending Queue; application history is retained. Unknown deadlines remain unverified, so the app cannot identify every closed posting.
- Match Score measures local keyword evidence coverage: skills contribute 70% and experience themes 30%, with weights normalized when one component has no recognized items. Details show supporting evidence and gaps. It is not an ATS score, a complete eligibility assessment, or a probability of receiving an offer.
- Unreleased local improvements: filter CS / Data / mixed / unknown directions using titles and explicit JD duties. Descriptions have readable sections and lists, with green highlights for supported skills, amber for basic exposure and blue for related experience. Hover or focus a highlight to view evidence. Plain-text sources receive reading layout rather than a reconstruction of the employer's original design; the source JD is not rewritten.
- Default location rules: GTA on-site / hybrid placements may last 4–16 months; those outside the GTA must last at least 8 months. Remote roles are exempt from the out-of-area minimum, but permission to work from Canada still needs verification.
- Explicitly unpaid roles are excluded. Undisclosed pay does not mean unpaid. Minimum-wage amounts are not hardcoded; cases without reliable comparison data remain unverified.

## Resume workflow and environment

Version 1.1.1: **我的简历 (My resumes)** accepts separate CS / Data Word (`.docx`) or PDF baselines, up to 10 MB each. A successful upload becomes the active baseline for that track and persists in `private/resume-bases/` across restarts. Previous versions can be previewed and explicitly reactivated; originals are never overwritten.

- Word files must initially contain readable text and fit one page. Uploaded-template tailoring conservatively reorders existing, identically styled adjacent bullets within the same experience based on the JD. Other content is preserved; it does not insert old knowledge-base facts or perform model-based rewriting. If no reordering is needed, the original text remains.
- An active PDF is saved for preview but blocks tailoring for that track until the matching Word file is uploaded. Unsupported complex Word layouts also block tailoring. Neither case silently falls back to an older resume; failed uploads leave the current baseline intact.
- Generated versions record their baseline and retain their own editable body fields even after later uploads. Match Score still uses the verified knowledge base and is not recalculated from uploads.
- The workbench now has top navigation, desktop side filters and a two-column opportunity grid, with a single column on mobile. Detailed evidence and sources remain in job details.

The dashboard currently uses Chinese labels; the steps below include the labels shown in the app.

1. Open a job's details, choose automatic / CS / Data, and click “生成定制简历” (Generate tailored resume).
2. Once validation passes, the PDF preview opens automatically. Use “查看已生成版本” (View generated versions) to access older files.
3. In the preview, click “编辑文字” (Edit text), edit the summary, skills, or project / work-experience body text, then click “保存新版本并预览” (Save a new version and preview).
4. Headings, education, contact information, and paragraph structure are locked. Original files and previous versions are never overwritten. Users are responsible for verifying facts they enter manually.
5. If a document exceeds one page or fails formatting checks, it is not published. Font sizes and margins are not reduced; the entered text is retained for revision.
6. Review the DOCX / PDF and review.md, then explicitly upload that version's materials to move the application to ready to submit.

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

See [ROADMAP](ROADMAP.md): v1.0.2 adds Workday full descriptions; v1.0.1 highlights, source coverage, and conservative deduplication remain available. New discovery sources await a decision. School-portal linking (later v1.1), OpenClaw scheduled discovery, summaries and user-selected job processing (v1.3), and a multi-user service (v2.0) are planned and have not started. The current app remains manually operated.
