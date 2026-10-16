# Reproduce the isolated filter/application/file UI checks

Use Node24 (Node22 is declared by the application but was not separately verified), Python with scripts/requirements-test.txt installed, and an existing Chromium/Edge executable. No browser installation or security-setting change is performed.

From the repository root in PowerShell:

```powershell
$env:CQ_V2_TEST_PYTHON = 'C:\path\to\python.exe'
$env:CQ_TEST_BROWSER = 'C:\path\to\msedge.exe'
node --test test/browser-devtools.test.mjs
node scripts/test-filter-actions-ui.mjs
```

CQ_TEST_BROWSER defaults to the usual Windows Edge executable. Set CQ_V2_TEST_PYTHON explicitly to avoid the fixture helper's optional local-runtime fallback. Install Python dependencies with that interpreter: `python -m pip install -r scripts/requirements-test.txt`.

Each invocation prints a unique output/filter-actions-ui/run-* evidence directory and creates fresh SQLite databases and browser profiles there. It starts an ephemeral loopback test server, uses synthetic accounts/files/jobs, and replaces discovery with a local stub. It does not use production databases, accounts, sessions, ports 4322/4317, or perform real job discovery/submission. Preserve failed evidence when diagnosing; no automatic directory deletion is performed.

The browser connection reads DevToolsActivePort only from the fresh profile it just spawned; no stderr startup line is required. Incomplete files are retried, invalid ports/paths rejected, and missing executables, early browser exit or 30-second startup timeout reported. No user browser is attached or restarted.

Expected result: 43 checks at each of 1280px and 390px, 86 total. JSON and screenshots cover filter count/reset, button text, refresh/progress, application cards/table, and PDF-image/Word-text preview. Synthetic files and fault injection do not prove real portal or remote Word services.

Full regression: `npm run test:serial`. Set CQ_V2_TEST_WORD=1 only in a Windows environment with the required Word integration; otherwise use 0 and report skipped Word checks explicitly. Running the public UI script does not require private verification scripts or a private runtime config.
