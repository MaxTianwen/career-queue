# Career Queue v1.0.2

**中文** | [English](Readme_EN.md)

个人加拿大 co-op / intern 求职工作台。手动触发岗位发现，筛选 Winter / Summer / Fall 2027 职位，保存到 Notion，并为选中的岗位准备、预览和修改一页简历。

**发现职位 → 已保存 Queue → 生成 / 审阅材料 → 上传为待提交 → 本人确认已投递。**

版本：`1.0.2`，收口日期：2026-09-25。功能与验证边界见 [CHANGELOG](CHANGELOG.md)，当前规格见 [PROJECT_SPEC](PROJECT_SPEC.md)。v1.0.2 在前版基础上增加 Workday 公开页面全文读取；新增发现源、v1.1 / v2.0 仍待后续启动。

## 启动与验证

需要 Node.js 22+；本机验证为 Node.js 24。无 npm 运行依赖，在项目根目录运行：

```powershell
npm start
```

打开 http://127.0.0.1:4317 ，服务仅监听本机。保持启动终端运行，关闭后可再次运行同一命令。

没有私人配置也可打开 Dashboard、体验明确标注的演示工作区或手动触发公开岗位搜索。正式 Queue 需要 Notion；匹配评分需要私人知识库；简历生成 / 编辑及 PDF 预览需要本机文档环境。公开源码不含这些私人资料，不是开箱即用的通用简历编辑器。

```powershell
npm test
node src/cli.mjs check
node src/cli.mjs preview --input examples/jobs.example.json
```

示例为合成数据，不要导入正式 Notion。v1.0.2 回归 84 项全通过，包含 Workday 读取、异常、日期、去重与缓存升级；未用测试写入正式 Notion。没有私有文档环境的公开副本会跳过对应文档保护测试，不能将跳过等同通过。`check` 仅检查配置；`verify` 才读取真实 Notion schema。

## 当前功能

| 区域 | v1.0.2 能力 |
|---|---|
| 发现职位 | 公开索引发现、支持来源的官方 JD、进度 / 错误提示、本机搜索快照。 |
| 岗位速览 | 发现卡片、发现详情及 Queue 详情突出时长、地点、薪资、办公方式与匹配技能；未知不推测。 |
| 来源与去重 | 分来源完整 JD / 字段统计，保留来源链接；确定重复合并，疑似重复提示，身份冲突需核实后手动录入。 |
| 筛选排序 | 开始季、任期、办公方式、Toronto / GTA / GTA 外、城市；按分数或官方发布时间排序。 |
| 已保存 Queue | 明确选择后保存到 Notion，去重、备注、归档；保存后定位并高亮记录。 |
| 申请记录 | 材料上传完成后待提交；本人确认日期后已投递；后续进展和下一步。 |
| CS / Data 简历 | 对选中且有完整 JD 的岗位运行本地规则定制，原格式生成新的 DOCX / PDF。 |
| 预览编辑 | 实际 PDF 本机渲染、放大 / 翻页；正文在线修改、另存版本、重新检查一页。 |

详情与预览支持外侧点击 / Esc 关闭，未保存编辑有提醒。生成和手动保存都不自动上传 Notion、不改变申请状态；审阅后仍需在材料上传入口明确选择对应文件。

## 搜索和评分边界

- 自动发现只有一个公开索引：Simplify / Pitt CSC 的 Summer2027-Internships，不是全网搜索。
- 自动官方 JD 读取支持 **Greenhouse、Lever、Ashby、Workday**；手动链接 `fetch-job` 入口只支持 Greenhouse。接口、日期含义与覆盖限制见 [DATA_SOURCES](docs/DATA_SOURCES.md)。
- Workday 从受支持的官方职位页读取 JobPosting 正文 / 日期 / 编号，无需账号或付费 API；重定向、登录页、缺失或冲突数据保持失败提示。不是全 Workday 岗位搜索。
- 24 小时是可选视图，不是岗位有效期。首次发布、官方日期、最近重新发布分别标注；未知日期不使用索引收录时间代替。
- 已识别截止时间且已过期的岗位从发现列表和待选 Queue 隐藏，申请历史保留。未知 deadline 保持待核实，不能保证识别全部关闭岗位。
- Match Score 是本地关键词证据覆盖：技能 70%、经历主题 30%，无识别项的部分重新归一化。详情提供依据及缺口；不等于 ATS 分数、完整资格判断或录取概率。
- 默认地域规则：GTA 现场 / 混合 4–16 个月，GTA 外至少 8 个月；远程不套用异地最短任期限制，但是否允许从加拿大办公仍须核实。
- 明确无薪排除，薪资未披露不等于无薪。最低工资不硬编码，无可靠比较依据时待核实。

## 简历操作与环境

1. 打开职位详情，选择自动 / CS / Data，点击“生成定制简历”。
2. 检查通过后自动预览 PDF；历史文件从“查看已生成版本”进入。
3. 预览中点击“编辑文字”，修改摘要、技能、项目 / 工作经历正文，再“保存新版本并预览”。
4. 标题、教育、联系方式和段落结构锁定。原稿及历史版本不覆盖，手动事实由本人核实。
5. 超页或格式失败不发布材料，不缩小字号 / 页边距；输入保留供调整。
6. 审阅 DOCX / PDF 与 review.md，明确上传该版本的材料，之后进入待提交。

定制为本地规则，未接入大模型；仅选择已核对事实，不编造经历、技能或成果，不保证 ATS / AI 通过。`prepare --key '<key>'` 仅导出上下文，网页生成入口才执行定制。

原始简历只读。固定 DOCX / 基线 PDF / 事实映射及哈希配置位于本机 `private/resume-templates/`，知识库为 `career_knowledge_base.md`。Windows Microsoft Word 隐藏独立实例只读导出，Python / pdfplumber 检查格式、字体、字号、边界、可提取文本和一页限制；预览也在本机渲染。Python 路径在私有模板配置。其他机器需配置并核验映射，不能直接替换任意 DOCX 使用。

## Notion 接入

Notion 是正式申请记录的唯一存储；Queue / Applications 为同库两个业务视图。本机已完成授权及 schema 验证，机器专属信息仅见 `private/SETUP_STATUS.md`。

新环境将 `.env.example` 复制为 `.env`，填写 token 并授权 integration 访问专用数据库；不要覆盖已有 `.env`。已有数据库填写 ID 后执行：

```powershell
node src/cli.mjs setup
node src/cli.mjs verify
```

`setup` 只补字段，类型冲突停止。已有数据库不要重复 `init`；仅其他全新工作区需创建时使用 `node src/cli.mjs init --parent '<页面UUID>'`。多 data source 时明确配置 `NOTION_DATA_SOURCE_ID`。

Queue 过滤 Status = Queue；Applications 过滤待提交 / 已投递 / 面试中 / 已结束，排除归档。正式字段为 Position（title）、Company、Location、Salary、URL、Notes、Status、Application date、Next step、Term、System notes、Materials、Key、Payload、Last seen。人工备注不覆盖，内部字段可隐藏。

## 发布与已知限制

- 代码、合成示例、当前文档为 GitHub 候选；凭证、知识库、模板、生成材料、日志、缓存、历史备份由 `.gitignore` 排除。机器专属 AGENTS.md 和未验证的 OpenClaw 草稿保留本机，不纳入公开 v1.0。
- `.gitignore` 不会移除已提交的敏感文件。提交 / 推送前检查暂存区和历史；即使是私密仓库，也不纳入凭证、私人简历或生成材料。尚未选择开源许可证。
- 单服务写操作串行；不要同时通过 CLI / 多个服务写同一记录。Notion 没有跨客户端事务与唯一键保证。
- 无自动投递、自动填表、批量简历、每日调度、邮箱同步或模型 API。
- 本机功能验证不等于完整真实申请验收；尚未以真实材料上传并走完待提交 / 已投递链路。

后续规划见 [ROADMAP](ROADMAP.md)：v1.0.2 已加入 Workday 全文，v1.0.1 的高亮、统计与去重继续保留；新增发现源待确认。v1.1 学校 portal 申请关联、v2.0 多用户方向尚未启动。
