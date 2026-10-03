# 数据来源与 API 清单

## v1.4.10 当前增量（2026-10-03 发布）

当前入口：1 个公共索引 + 9 个指定雇主公开列表；不等于九个平台全网搜索。Qualcomm 接入官网实际使用的公开 Eightfold API：

- 列表：`https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com&query=intern&location=Canada&start=0`，另查询 co-op。每页 10 条，分别最多 20 页；校验计数、编号、地区及提前结束。
- 详情：`https://careers.qualcomm.com/api/pcsx/position_details?position_id=网页ID&domain=qualcomm.com&hl=en`，只请求已验证的数字网页 ID；不访问登录或提交接口。
- 官网 307 跳转证实 `qualcomm.eightfold.ai/careers/job/ID` 与 `careers.qualcomm.com/careers/job/ID` 对应，读取器直接使用官网规范链接。
- `displayJobId` 与 `atsJobId` 为雇主招聘编号；网页数字 ID 单独核对。`postedTs` 与实测公开页面 `datePosted` 相符，按日期显示，不用 `creationTs` 冒充发布。

2026-10-03 独立实测：intern 19 + co-op 5 条、3 页，22 个独立网页 ID。正式搜索 8 条预筛候选均读取全文，其中 5 条与索引共享、3 条额外待核实候选，不能宣传为 8 条全新合格岗位。五条学校样本可找到对应来源：2 条在候选列表，3 条纯硬件标题按既有 CS / Data 预筛排除，学校对照显示其编号及原因。五条 JD 均通过独立只读验证；预筛排除岗位不会被自动读取正文或生成材料。

仅写 FY27 或说明可工作月份、毕业年份的复杂正文，当前通用规则未识别时仍保留未知入职季。薪资专项提取、多季与不连续时长筛选待后续方案。公开接口可能变化，失败显示部分 / 未知，不当作岗位关闭。

## v1.4.9 增量（2026-10-03 发布）

当前发现为一个公共索引 + 8 个固定雇主列表：Tenstorrent、Cohere、Telesat、Vena、Genesys、Celestica、Veeva、Amazon。实际状态、页数、候选数和增量以 Dashboard 每次搜索统计为准；下文 v1.2.1 / v1.0.x 表格是历史快照，不代表当前只有一个发现入口。

Amazon 使用官网公开搜索 [intern 加拿大列表](https://www.amazon.jobs/en/search.json?base_query=intern&country=CAN&offset=0&result_limit=100) 与 co-op 查询，offset 分页、每页 100 条、每组最多 10 页。此接口无需本机凭证，但属于网站使用的公开入口，不承诺长期不变；不是全网搜索，也不是所有 Amazon 岗位覆盖。实际 country=CAN 生效；country[]=CAN 未生效，未采用。

列表正文拼接 Description、Basic Qualifications、Preferred Qualifications，URL 的数字编号与 id_icims 必须一致。按 base_query=招聘编号读取时只接受唯一对应编号，用于全文补读和开放复查；无结果或访问失败只标未知。posted_date 保留日期精度，updated_time 不作发布时间；不猜截止、薪资结构值和办公方式，原始 JD 保留。

初次独立实测 intern 6 条 + co-op 2 条，按招聘编号合并为 6 条；4 条进入现有 CS / Data 预筛。学校 SCHOOL-04 对应 Amazon 10538066 已取得完整 JD；它在旧索引中已有摘要，因此这是补齐全文及主动发现覆盖，不能宣传为全新岗位。多入职选项保留原文和待核实批次，索引单季提示不再产生重复卡片。最新完整搜索增量见 v1.4.9 验收文档。

v1.4.9 当时未解决：Qualcomm 列表接入（现见上方 v1.4.10）；Veeva 旧学校样本在已查列表未发现，不能判关闭；RCMP 等未新增入口。多季与不连续时长组合、薪资专项提取仍是后续候选。没有付费来源、账号、模型或自动申请。

## v1.2.1 及更早历史核查


2026-09-29 按当前代码、官方文档和公开接口只读核查；v1.2.1 已获用户授权发布。没有发送私人简历或向正式 Notion 写测试数据。历史实测保留下文。

## 两层来源

**发现候选 → 根据候选官方链接读取 JD**。支持某 ATS 全文接口，不等于扫描了使用该 ATS 的全部公司。

| 层次 / 入口 | 当前调用 | 提供什么 / 限制 |
|---|---|---|
| 自动发现索引 | `https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json` | Simplify / Pitt CSC 索引的公司、岗位、链接、地点与批次线索。与下列雇主列表共同发现；收录日期不是雇主发布日期。 |
| Greenhouse JD | `https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{postId}` | 正文、标题、地点等；只读已发现的支持格式链接。薪资 / 任期不保证有结构化值。 |
| Lever JD | `https://api.lever.co/v0/postings/{board}/{id}?mode=json` | 合并正文、要求列表、补充说明、薪酬说明；可读结构化地点、办公方式、薪资范围，缺失标未知。 |
| Ashby JD | `https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true` | 读取公司 board，选取对应且 isListed 的岗位；正文、地点、方式、可用薪酬与最近发布时间。Cohere 的完整公开列表同时作为发现入口，其他 board 仍只按已有岗位补全文。 |
| Workday JD | HTTPS `{tenant}.wd{n}.myworkdayjobs.com` 官方职位页面 | 读取 JobPosting JSON-LD 的全文、招聘编号、地点与日期；不是私有 CXS API。不跟随跳转；仅支持匹配链接编号的职位，不扫描公司所有岗位。 |
| 官方日期补读 | Greenhouse / Lever 受限官方岗位页的 `JobPosting` | 补 datePosted / validThrough；匹配对应职位，冲突 / 失败不猜日期，不抓任意站点。 |
| 手动链接入口 | CLI `fetch-job` / 网页手动读取 | 当前仅 Greenhouse；不能因此认为自动发现也只有 Greenhouse。 |
| Notion | `https://api.notion.com/v1` | 存 Queue、申请状态、JD 和材料；不是招聘数据源。 |

实现位置：[discovery.mjs](../src/discovery.mjs)、[greenhouse.mjs](../src/greenhouse.mjs)、[posting-metadata.mjs](../src/posting-metadata.mjs)、[notion.mjs](../src/notion.mjs)。

## v1.2.1 首批主动发现源与实测

固定配置见 `src/discovery-sources.mjs`。本轮只启用下列三家；曾探查 Kensington、Solink，但未列为启用来源。

| 雇主 / 官方列表 | 公开 API | 2026-09-29 返回 / 预筛候选 | 本次独立新增 |
|---|---|---:|---:|
| [Tenstorrent University](https://job-boards.greenhouse.io/tenstorrentuniversity) | `https://boards-api.greenhouse.io/v1/boards/tenstorrentuniversity/jobs?content=true` | 4 / 1 | 1，批次未知，待核实 |
| [Cohere](https://jobs.ashbyhq.com/cohere) | `https://api.ashbyhq.com/posting-api/job-board/cohere?includeCompensation=true` | 144 / 2 | 2，Winter 2027，待核实 |
| [Telesat](https://jobs.lever.co/telesat) | `https://api.lever.co/v0/postings/telesat?mode=json&limit=100&skip=0` | 48 / 0 | 0 |

同次原索引 16,947 行 → 149 条预筛候选 → 143 张卡片。新来源增加 3 条，合计 152 条候选 / 146 张卡片。精确重复合并 6 条、四字段归组 0 条、身份冲突记录 2 条。三个新增均 REVIEW，全部规则明确 PASS 的新增为 0；不能把 REVIEW 说成已核实可投。索引存在 2 次 Greenhouse 详情失败；64 条候选链接未支持读取。首批来源列表均成功且单页完整；这不代表其它雇主、职位或批次都已覆盖。

新增实际岗位：[Cohere Software Engineer Intern](https://jobs.ashbyhq.com/cohere/8c035d3d-081d-4c8a-914a-72f4efaad254)、[Cohere Machine Learning Intern](https://jobs.ashbyhq.com/cohere/36d1f52f-8270-4652-adf5-5303a0ff341b)、[Tenstorrent AI Compiler Intern](https://job-boards.greenhouse.io/tenstorrentuniversity/jobs/4873659007)。两条 Cohere 的 3–6 月来自 JD，方式来自 Remote；Tenstorrent 发布于 2025 年，但尚无截止，不能因为旧就删除，也不能猜是 2027 入职。标题未知季节时保留待核实。

每家另抽查一个公开岗位。Tenstorrent 列表与详情 JD / 首次日期一致；Cohere 抽查 Toronto 全职岗位仅用于结构化薪资校验（CAD、1 YEAR），不混入实习结果；Telesat 抽查工程师仅核实 Lever 字段和日期补读，不计新增实习。原始公开数据及抽查在本机 `output/v121-audit/`，不提交原始大文件。

接口依据：[Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)、[Lever Postings API](https://github.com/lever/postings-api)、[Ashby Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)。只使用公开 GET，未调用申请提交接口、未登录 / 付费。Lever 支持 skip / limit，最多读 20 页，每页 100；达到上限、重复页、分页错误、结构变化或 GH 总数不符标 partial，不假称完整。Ashby 只用 isListed=true，publishedAt 按“最近发布”；GH first_published 与 updated_at 分开；Lever 创建时间不当发布日期。

指标口径：发现表为同次完成快照、独立卡片分母包含拒绝 / 已截止结果，不随过滤变化；全文系统表按当前未截止结果重算。相对索引新增只在索引读取完整时给出，PASS / REVIEW 分列；共享来源行不能相加。列表自带 JD 不计详情请求成功。字段未提取到与请求失败分开，不将缺失写成明确“官方没有”。去重与归组保留各自 JD；字段冲突选取完整来源，不拼接虚假岗位。

仍有限制：固定三家覆盖增量较小，未支持来源和旧 Workday 维护页替代链接继续作为后续候选；本版没有放宽跳转、开启其它 ATS 全量搜索或添加付费服务。来源长期变更仍可能导致部分失败，界面会显示。

## 日期、筛选和覆盖限制

- Greenhouse 优先 first_published，缺少时尝试官方 JobPosting.datePosted；updated_at 不作为首次发布。
- Lever 从官方网页补日期，createdAt 不作为发布。Ashby publishedAt 表示最近发布，可能包含重新发布。
- 索引需符合 active / is_visible、目标批次、地域关键词及岗位方向才成为候选。索引漏收、批次误标或预筛不匹配可能造成漏岗。
- 仅支持指定主机和 URL 格式；Workday 支持 locale、apply 和数字 posting 后缀，其他 ATS、自定义域名或链接形式不保证支持。失败 / 不支持时保留索引信息，但不能当完整 JD 生成材料或直接入 Queue。
- “完整 JD”表示取得正文，不保证任期、薪资、资格或 deadline 都可提取；未知仍需核实。
- 无 LinkedIn / Indeed 或全加拿大覆盖承诺；没有扫描全部 Greenhouse / Lever / Ashby 雇主。
- 三个并行只读任务；JSON / Workday 页面 15 秒超时，Greenhouse 30 秒，官方日期补读 10 秒；Workday 页面上限 2 MB；5 分钟搜索缓存与本机快照不改变日期语义。

## v1.0.2 Workday 接入实测（2026-09-25）

此前 102 条 Workday 候选属于**程序尚无适配器、未尝试读取正文**，并非证明 Workday 不能读取、要求付费或阻止访问。本版直接读取官方公开职位页面中的 JobPosting JSON-LD，无账号、密钥、新依赖或付费服务。没有调用私有 CXS API，不保证厂商长期维持此页面格式。

先以 BDO、Manulife、TD、Capital One、Intact、Autodesk、RBC 的 7 个真实页面核实结构，再运行完整搜岗：17,192 条索引 → 207 条候选 → 合并 1 条重复 → 206 条结果。

| 指标 | v1.0.1 | v1.0.2 |
|---|---:|---:|
| Workday 尝试读取 | 0 | 102 |
| Workday 取得全文次数（去重前） | 0 | 96 |
| Workday 独立完整 JD（去重后） | 0 | 95 |
| Workday 读取失败 | 0（未尝试） | 6 |
| Workday 有官方发布日期 | 0 | 95 |
| Workday 有官方截止日期 | 0 | 55 |
| 全来源完整 JD | 31 | 126 |

95 条 Workday 完整记录涉及 29 个雇主主机。6 条失败均为 Autodesk `/Ext/job/` 链接返回 HTTP 302；抽查 Location 指向 Workday 的 outage 维护页面，程序不跟随、不登录、不把维护页当正文。相同雇主其他正常页面仍可成功读取。这里的结果是当次可用性，不是永久访问保证。

55 条是**有截止日期**，不是过期数量。按 `deadlineExpired` 规则，本次 0 条已确认过期；未知截止仍待核实。官方 datePosted 全为日期，保留“未提供具体时间”，不强行算入最近 24 小时。完整 JD 并不等同符合全部资格，筛选仍保留 REJECT / REVIEW。

### 映射与验证边界

- `identifier.value` 必须匹配 URL 中的招聘编号；多个冲突 JobPosting、空描述、登录 / 维护页面或错误响应保持失败。
- `description` 解码为纯文本，保留可用段落；不执行网页脚本。页面已有扁平文本时不能恢复原排版，但取得的是该官网结构化正文。
- `datePosted` → 官方发布日期；`validThrough` → 截止日期，仅接受有效日期。没有把相对发布时间或索引时间当官方日期。
- `jobLocation` → 地点；结构化 `baseSalary` 同时有有效币种、数值和单位时才用于薪资。样本未提供这种结构化薪资，不代表 JD 内没有薪资文字；薪资 / 工作方式仍有提取空间。
- Workday 的 TELECOMMUTE 也出现在混合办公岗位，不能直接判定全远程。明确的 `#LI-Hybrid` 等标签可读取，现有 JD 规则继续补充，其余保持待核实。
- 官网标题 `Winter Co-op 2027`、`Summer Intern 2027`、`2027 Winter`、`January 2027` 可识别批次并覆盖索引线索；仅有年份不猜季节。
- 请求仅限 Workday 标准 HTTPS 职位路径，禁止凭证、非标准端口、任意域名和重定向；超时 / 大小限制与既有三路并发生效。失败不自动进入 Queue 或生成简历。
- 84 项回归通过，包括错岗 / 缺失 / 冲突数据、HTTP 错误、超时、大响应、日期与入职季、去重和旧缓存更新。浏览器只读验证了卡片、全文详情、日期、技能摘要及来源统计；未测试写入真实 Notion。

可复核的公开样例：[BDO](https://bdo.wd3.myworkdayjobs.com/BDO/job/Toronto---Bay-St/Co-op-or-Intern--Full-Stack-Developer--January-2027-_JR7057)、[Manulife](https://manulife.wd3.myworkdayjobs.com/en-US/MFCJH_Jobs/job/Toronto-Ontario/Summer-Intern-2027---Software-Engineering_JR26081684)、[TD](https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/TD-Centre---TD-Tower---66-Wellington-Street-West-Toronto-Ontario/Business-Insights---Analytics-Co-op-Intern-Winter-2027_R_1506527)。链接随雇主撤岗可能失效；原始审计仅保留本机 output/workday-audit。

## v1.0.1 历史实测（2026-09-25）

通过 Dashboard 在多伦多时间 13:56:36 完成真实搜索：17,192 条索引 → 207 条候选 → 207 条结果，31 条完整 JD（约 15.0%）；本次没有确定重复可合并。所有值仅反映这次索引预筛后的样本，并非加拿大岗位市场覆盖率。样本包含全国 / 美国远程及需核实资格的记录，不能等同 207 条可投岗位。

| 系统 | 候选 | 完整 JD | 读取失败 | 未支持全文 | 有官方日期 | 有时长 | 有薪资 | 有方式 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Workday | 102 | 0 | 0 | 102 | 0 | 0 | 0 | 16 |
| 其他招聘系统 | 71 | 0 | 0 | 71 | 0 | 0 | 0 | 7 |
| Greenhouse | 18 | 17 | 0 | 1 | 17 | 6 | 0 | 2 |
| Ashby | 9 | 7 | 0 | 2 | 7 | 2 | 5 | 7 |
| Lever | 7 | 7 | 0 | 0 | 7 | 1 | 0 | 6 |

“有时长”包含官方标题可识别范围；“有方式”可能来自索引地点的 Remote，全文未取得会明确提示。零值可能是来源未提供，也可能是解析器未提取，不能据此认定官网没有该字段。2 条 Ashby 未读取的记录使用 HTTP 链接，当前全文读取只允许 HTTPS；未静默放宽协议限制。“其他系统”包括雇主官网与不支持的 ATS，不是一个单独接口。

页面的“查看来源与信息完整度”实时重算未截止结果，包含不符合求职条件的记录；不会随着季节 / 地点筛选而改变统计口径。旧快照可显示统计，再次搜索刷新到新版去重缓存。原始审计与搜索快照仅保留在忽略的 output 目录；此表不包含个人资料。

## 官方依据与扩展方向

| 选项 | 官方依据 / 能力 | 限制与建议 |
|---|---|---|
| 现有公开索引 | [Summer2027-Internships](https://github.com/SimplifyJobs/Summer2027-Internships) | 仓库面向 Summer 2027；读取其中 Winter / Fall 标签不等于三季覆盖均衡。当前样本无法测量索引遗漏数量。 |
| 雇主名单 + Greenhouse | [Job Board API](https://docs.greenhouse.io/job-board.html) 提供公司 board 列表与详情，公开 GET 无需认证 | 可从选定加拿大雇主 board 主动发现候选；须维护公司名单，不能扫描全球所有 board。薪酬 / deadline 结构化字段可另行评估补充。 |
| 雇主名单 + Lever | [Postings API](https://github.com/lever/postings-api) 提供特定公司的公开职位列表 | 可复用全文能力扩大发现入口；仍须先确定雇主列表及地域筛选。 |
| 雇主名单 + Ashby | [Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) 提供公司 board | 当前已读取 board，但仅取索引指定职位；从整张 board 发现岗位属于待实施改动。 |
| SmartRecruiters | [Posting API endpoints](https://developers.smartrecruiters.com/docs/endpoints) / [List postings](https://developers.smartrecruiters.com/reference/v1listpostings) | 按公司取职位，不是全球搜索。具体 endpoint 的访问条件、授权与使用规则需接入前实测；本次未申请凭证。 |
| Adzuna 搜索 | [官方 Search API](https://developer.adzuna.com/docs/search) | 提供搜索入口，需 app_id / app_key；加拿大样本质量、配额、费用及使用条款仍待确认。没有注册、付费或发送私人资料。 |
| Workday 全文 | 本次实测缺口最大：102 / 207 候选 | v1.0.2 已通过公开页面 JSON-LD 取得正文，无需私有 API。仍需维护页面格式兼容性；自定义域名与重定向不在此版范围。 |
| TMU portal / Job Bank / 其他平台 | 此次未建立可用数据连接 | portal 留在 v1.1；未确认 API 不等于断言没有。需要访问方式、权限和成本证据后再选。 |

**建议下一步先试一小组加拿大 / GTA 雇主的 Greenhouse、Lever、Ashby board 主动发现**，与现有索引结果合并。可复用当前适配器与去重，容易测量新增有效岗位；但应先确认雇主名单。Workday 全文已于 v1.0.2 接入，改善已有候选的可处理率；增加发现来源仍是另一项待实施工作。新增服务 / 费用仍需确认。

后续试验至少记录：新增且符合条件的独立岗位、重复数量、加拿大 / GTA 与三季分布、完整 JD / 日期取得率、错误率及访问限制。未做试验前不承诺数量提升。

## 本版合并边界

- 所有已发现 ATS 岗位进入同一列表；目前仍只有一个发现索引。
- 支持的 Greenhouse 主机别名及三个 ATS 的申请后缀规范化；保留原始链接。其他系统的职位查询参数不合并掉。
- 相同官方链接 + 批次，或明确属于雇主 requisition_id / Workday JobPosting.identifier 的公司编号 + 批次，且字段不冲突时合并。ATS 内部 posting ID 不冒充跨来源雇主编号。
- v1.1.2 按用户要求将同公司、标题、地点和批次自动归组展示，即使编号不同；优先未截止且有完整 JD 的来源，不拼接不同来源正文。其他链接、编号、薪资、时长、方式及截止日期保留在折叠来源列表。四项缺失或地点 / 批次不同仍保留独立；其余 Queue 身份键冲突仍禁止直接入队 / 生成。归组减少的是展示重复，不证明雇主只开放一个招聘编号。
- 来源链接随新记录保留；不为既有 Notion 条目批量回写来源或改动人工备注、申请状态及材料。

模拟回归测试覆盖错误、重复和冲突，不能等同上述真实外部搜索验证。v1.0.0 历史审计继续保留于发布记录；当前来源以文件顶部增量及代码配置为准。
