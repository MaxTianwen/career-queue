# v1.0 数据来源与 API 清单

2026-09-25 按源码核对。记录已实现的调用路径；本次未重跑外部招聘请求，也未开始新来源调研。接口可用性、许可和新来源在下一版启动时重新核实。

## 两层来源

**发现候选 → 根据候选官方链接读取 JD**。支持某 ATS 全文接口，不等于扫描了使用该 ATS 的全部公司。

| 层次 / 入口 | v1.0 调用 | 提供什么 / 限制 |
|---|---|---|
| 自动发现索引 | `https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json` | Simplify / Pitt CSC 索引的公司、岗位、链接、地点与批次线索。当前唯一自动发现源；收录日期不是雇主发布日期。 |
| Greenhouse JD | `https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{postId}` | 正文、标题、地点等；只读已发现的支持格式链接。薪资 / 任期不保证有结构化值。 |
| Lever JD | `https://api.lever.co/v0/postings/{board}/{id}?mode=json` | 合并正文、要求列表、补充说明、薪酬说明；可读结构化地点、办公方式、薪资范围，缺失标未知。 |
| Ashby JD | `https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true` | 读取公司 board，选取对应且 isListed 的岗位；正文、地点、方式、可用薪酬与最近发布时间。没有把整张 board 作为新增发现源。 |
| 官方日期补读 | Greenhouse / Lever 受限官方岗位页的 `JobPosting` | 补 datePosted / validThrough；匹配对应职位，冲突 / 失败不猜日期，不抓任意站点。 |
| 手动链接入口 | CLI `fetch-job` / 网页手动读取 | 当前仅 Greenhouse；不能因此认为自动发现也只有 Greenhouse。 |
| Notion | `https://api.notion.com/v1` | 存 Queue、申请状态、JD 和材料；不是招聘数据源。 |

实现位置：[discovery.mjs](../src/discovery.mjs)、[greenhouse.mjs](../src/greenhouse.mjs)、[posting-metadata.mjs](../src/posting-metadata.mjs)、[notion.mjs](../src/notion.mjs)。

## 日期、筛选和覆盖限制

- Greenhouse 优先 first_published，缺少时尝试官方 JobPosting.datePosted；updated_at 不作为首次发布。
- Lever 从官方网页补日期，createdAt 不作为发布。Ashby publishedAt 表示最近发布，可能包含重新发布。
- 索引需符合 active / is_visible、目标批次、地域关键词及岗位方向才成为候选。索引漏收、批次误标或预筛不匹配可能造成漏岗。
- 仅支持指定主机和 URL 格式；其他 ATS、地区域名或链接形式不保证支持。失败 / 不支持时保留索引信息，但不能当完整 JD 生成材料或直接入 Queue。
- “完整 JD”表示取得正文，不保证任期、薪资、资格或 deadline 都可提取；未知仍需核实。
- 无 LinkedIn / Indeed 或全加拿大覆盖承诺；没有扫描全部 Greenhouse / Lever / Ashby 雇主。
- 三个并行只读任务；JSON 默认 15 秒超时，Greenhouse 30 秒，官方日期补读 10 秒；5 分钟搜索缓存与本机快照不改变日期语义。

## 已有验证记录

2026-09-24 本机记录：17,218 条索引中发现 219 条候选，31 条取得完整 JD 与官方发布日期，其余 188 条未取得全文 / 日期。此为历史样本，不是当前数量，也不是加拿大岗位总量或覆盖率；本次未重新搜索。

适配器回归包含模拟 API，不能据此宣称本次真实验证了三个外部接口。下一版需补逐来源实测及缺失率，见 [ROADMAP](../ROADMAP.md)。
