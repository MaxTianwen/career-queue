# 首次未打开详情：独立机制审计（0.2.4 后）

本轮没有操作真实 Brave、学校批次或用户标签，没有更改产品代码、权限、Shields、申请历史、部署或 main。0.2.4 的 789 项完整回归仍是产品验证基线。本轮另跑实际 MV3 扩展 API 的隔离合成试验；不能称为学校实机通过。

## 已有真实证据的边界

- 原本机记录 `docs/task-01/SCHOOL_TRIAL_016.md` 记录列表诊断：30 个岗位都有唯一 A[role=button] 标题目标。现有 scan 导出只保留 tag/role/安全 id/class 与可见职位身份，没有 onclick 源码、事件监听器、window.open 参数或学校路由实现。不能从 role 推断内联、jQuery 委托、pointerdown 或命名窗口。
- `private/<local-evidence>` 曾记录 newTabObserved=true、DETAIL_TAB_OPENER_MISMATCH；0.1.9 又有真实单岗成功。因此“ISOLATED 永远不能触发学校开页”与已有证据不符。它不证明之后每次执行都相同。
- 首次批次失败是 0.2.2 NO_DETAIL_TAB_OBSERVED；0.2.3 的后续失败是旧 dispatched 的只检查恢复。它们不是两次独立的新点击样本。0.2.2 未采集现在的 clickEvidence，无法追溯其 trusted/activation。
- 0.2.4 `school-batch-worker.js` 确实用 chrome.scripting.executeScript 的 ISOLATED world。open 用 HTMLElement.click()，不产生完整 pointerdown/mousedown/up 输入序列，不伪造可信事件。返回 ok/dispatched 只表示函数派发返回，页面处理器抛错也未必传播到调用者。

## 真正使用扩展 API 的合成检查

用户电脑上的独立 Edge 测试配置加载了临时测试扩展。测试扩展仅有 scripting 与临时 localhost 页面权限，与产品扩展分开；没有 remote debugging、MAIN-world 切换、弹窗策略修改或真实学校网络请求。11/11 场景完成并通过对应断言，脚本与结果位于 `output/task-01/school-click-world-audit/`。

| 已知合成机制 | ISOLATED .click() 结果 |
| --- | --- |
| inline onclick、onclick 属性、直接监听器、document 委托 | 页面处理器实际运行 |
| 处理器要求 event.isTrusted | 未执行受限分支 |
| 处理器要求先发生 pointerdown | 未执行受限分支 |
| 没有处理器 | 无后续动作 |
| 处理器抛错 | 页面错误出现，但注入函数仍返回 ok |
| handler 调用 window.open 新窗口，默认策略 | handler 运行，window.open 返回 null |
| handler 指向已有命名 iframe | 得到现有目标引用；这不是顶层命名窗口复用的实测 |
| handler 执行 history.pushState | hash 路由变化，处理器运行 |

以上 **11 种场景的 clickEvidence 完全相同**：eventObserved=true、isTrusted=false、userActivationAtDispatch=false、defaultPrevented=false。这证明仅凭这些字段加“无新页”不能区分处理器门槛、未绑定、脚本错误与弹窗阻止，更不能由无权限提示推断拒绝。

当前 Edge 试验未复现“ISOLATED 导致所有内联 onclick 失效”。早期 Chromium issue 确实报告过相关 CSP 差异，但不能据此修改产品为 MAIN 来试着绕过，也不能认定是本次根因。0.2.3 的命名/复用标签识别已有适配器测试；本轮未用强制允许弹窗来伪造顶层命名窗口成功。

## 已排除的笼统结论与仍缺的证据

不能笼统归因于 ISOLATED 不触发页面监听器；不能把 Shields 的 Google tag 跟踪器拦截当成窗口拦截；不能把 .click 返回成功当成学校路由成功。实际页面可能有信任/输入序列门槛、初始化/路由错误、新窗口策略限制或其它 UI 路由。现有数据无法排序认定。

还有一个观察边界：当前观察器只有在原列表扫描为空时才对同页详情做身份核验。若学校把详情放在仍保留列表的 modal/iframe/SPA 区域，现有无新页诊断不能排除此类表现。本轮合成 hash 路由只是证明这种路由机制存在，不是学校确实如此的证据，未据猜测扩大读取范围。

## 最小必要的下一份证据（先只读，不要求现在操作）

**优先只读查看原列表第一条已选职位的事件绑定，以及已有失败的相关控制台错误。** 只需要该标题元素是否有内联 onclick，以及 Elements → Event Listeners 中 click/pointerdown/mousedown/keydown 的绑定位置（含祖先委托）；若已有与该次点击相关的错误，只提供错误类别和指向的同一处理器位置。不要导出整页 HTML、全部脚本、Network/HAR、Cookie、Storage、表单值或账号信息。标准页面 JavaScript 没有可靠的全量 listener 枚举接口；不能用 hasAttribute('onclick')=false 推断无监听器。当前授权及已取得材料里没有这份记录，不能自行补造。

如以后明确同意一次新尝试，必须同时取得这些可判定证据，而不是只回传相同失败码：

1. 先保存 0.2.4 批次诊断，再只读准备；保存前后 batchId 与 archives 中旧 attempt。
2. 每次只进行一轮明确新尝试，保存本轮完整诊断 JSON，不能只看短状态。记录实际是否出现新页、复用详情页、同页详情/遮罩或 iframe，以及原生弹窗阻止指示；不要关闭或放宽拦截。
3. 若有与点击关联的处理器异常/CSP 拒绝，归入对应执行错误；若原生浏览器明确报告弹窗阻止，归入窗口阻止；若已有处理器代码明确要求可信事件或 pointerdown，归入输入门槛。没有这些证据仍标未定位，不反复点击，不擅自切换 world 或模拟可信输入。

本轮不要求用户执行上述动作。要保证下一次能定位到具体处理器，需要先取得该只读绑定证据；仅使用 0.2.4 的现有短码无法保证区分上述全部机制。

## 0.2.4 准确按钮顺序（未来明确同意后才使用）

在 `brave://extensions` 重新加载原扩展到 0.2.4，保留原学校列表和任何详情页。诊断按钮在顶部，不触发授权或点击。必须在原列表当前激活时打开扩展，展开“岗位读取与导入（诊断时无需操作）”。

1. **保留失败证据并只读重新准备** → `phase=reviewed`、`code=NEW_ATTEMPT_NOT_STARTED`；新的 batchId，原失败在 archives，attempt/permissionRequest/execution 为空。该步不点击、不请求权限。当前即可停在这里。
2. **确认新尝试：之后将再次点击未完成职位** → `phase=armed`；新的 permissionRequest.id、requestInvoked=false。短码 `request=not-invoked`。仍未点击。
3. **请求所需权限并运行（可能无提示）** → 本轮 `execution.kind=explicit-new`。不是旧检查恢复；有覆盖权限时可能不弹提示。
4. 保存顶部 **下载批次诊断 JSON**。旧数据导出不是诊断。

| 可验证字段 | 证明什么 / 不证明什么 |
| --- | --- |
| batchId 与 archives[].snapshot.id / attempt.id | 新旧批次及原失败证据分开保存 |
| execution.kind | explicit-new 是明确新尝试；inspect-existing 只检查旧页面 |
| execution.id = permissionRequest.id | 本轮执行与授权协调记录关联 |
| execution.openInvokedThisRun，短码 dispatchCall | 调用过打开函数；不是网站处理器成功证据 |
| attempt.id / createdRunId / stage | 新 attempt 与本轮 execution 对应；旧 stage=dispatched 不算新点击 |
| permissionRequest.requestInvoked / outcome / preexistingAtArm | request 调用是否收到回报、返回结果、准备时覆盖权限；promptShown 永远 unknown，不能保证出现提示 |
| permissionAudit.checkedAt / persistent / exact | 查询时的当前覆盖/精确权限；不是历史状态 |
| permissionCleanup.requestId / result | 撤权或保留记录属于哪一轮；不使用任意旧 event 冒充当前清理 |
| attempt.clickEvidence / observation | 合成事件元数据、观察到的页类型/候选数；不能独立证明处理器运行或窗口阻止 |

## 标准与官方资料

- [HTML click() 规范](https://html.spec.whatwg.org/multipage/interaction.html#dom-click)：合成 click 的 not-trusted 标记。
- [HTML 用户激活模型](https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event)：激活触发事件要求 trusted；不能假定扩展弹窗中的手势经异步权限/消息/存储自动变成页面中的有效激活。
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)：ISOLATED / MAIN 的执行环境定义。
- [Chrome content-script CSP](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#content_security_policy)：隔离环境的 CSP 与 MAIN 页面 CSP 有别。
- [GoogleChrome 历史 issue 807](https://github.com/GoogleChrome/chrome-extensions-samples/issues/807)：作为历史候选线索，不作为本次 Edge/Brave 根因证明。
