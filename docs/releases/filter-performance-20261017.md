# Reuse filter facts within each calculation

Country totals previously repeated complete term, duration and category parsing for each country's membership check. Filtering now computes full facts only when requested conditions need them, country totals share country evidence within the current iteration, and opportunity facts reuse one start-term extraction.

There is no persistent cache. Content changes, account-specific objects, filter changes and the rolling 24-hour publication boundary continue to use current inputs. Country eligibility, city substring matching, year/season and duration rules are unchanged.

On Windows / Node 24.16.0, two reversed-order runs of a fixed synthetic workload at 126 jobs measured median 210–239 ms before and 61–62 ms after. Each sample includes four filter/count/label passes, not network or DOM rendering. This is a computation benchmark, not a claim about whole-page latency.

Validation: 55 focused tests passed; 2,896 baseline/candidate comparisons matched; 96 isolated browser checks passed at 1280px and 390px. The full serial run contained 1,039 tests: 1,036 passed, zero failed and three document tests skipped for missing isolated runtime configuration. After supplying the existing Python path in the isolated environment, their three files passed all five tests, covering every skipped test including actual Word/PDF. This is full-run plus supplemental evidence, not a single 1,039-pass run. After applying the exact candidate, all 55 focused tests passed again.

Source and database backups passed an isolated restore check. The local v2 service restarted successfully; its page and served filtering module matched the candidate. All 38 production table fingerprints and settings remained unchanged, and the older dashboard service was not restarted. No authenticated production browser journey is claimed. Private evidence, runtime paths and databases are excluded from this commit.

Rollback only the scoped source changes (or revert this commit) after checking subsequent edits, then restart v2 under the normal controlled procedure. There is no schema change and no database rollback is required.
