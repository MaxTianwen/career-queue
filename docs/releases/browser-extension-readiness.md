# Greenhouse 本机扩展接入：候选验收

2026-10-05 用户确认采用 Chrome / Edge 本机扩展。并入尚未推送的 v2.8.0 工作阶段，不单独创建零碎版本。真实扩展安装与填写验收尚未完成；不宣称官网自动填写已正式可用。

## 只读页面核查

检查 Tenstorrent `5055233007` 与 Affirm `7850544003` 的公开 Greenhouse 页面。这两条仅为结构样本，不是给用户推荐的岗位，也没有填写测试资料。

- First Name / Last Name / Email 为有对应 label 的文本输入，DOM required 为 false 但标签带星号；不能只靠 required 属性推断完整要求。
- Phone 是 tel 输入，与 Country combobox 配合。普通 API 文本分类不足以证明可独立填写电话。
- 下拉框也有 text 输入；必须检查 role，不能把 combobox 当文本框。
- LinkedIn 的 question 编号因岗位而异，不能硬编码某个公司的字段 ID。
- 两页都有 reCAPTCHA 标识；标识不等于正在挑战。遇到实际可见挑战时暂停，不尝试处理。

依据：[Greenhouse 官方 Job Board API](https://docs.greenhouse.io/job-board.html)、[Chrome activeTab 权限说明](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)。公开读取接口与需要招聘方凭据的提交接口不是同一权限；本实现不调用提交接口。

## 当前候选实现

`browser-extension` 是 Manifest V3 本机扩展，无 background 常驻脚本，无全网站权限。Dashboard 经本人确认生成短时配对码，扩展显式预览并再次确认。服务端绑定会话、账号、职位、草稿指纹；三分钟到期、旧码替换、退出登录和一次性消费保护。仅两个桥接接口允许扩展 Origin；其他接口保持原有隔离与 CSRF 规则。

页面填写器先检查整组字段，拒绝重名、缺失、已有内容、复杂/只读控件；填写时逐项检查并发送 input/change。动态变化导致中断时报告部分进度，不自动撤销。不操作附件、资格/披露、电话组合控件、登录、验证码或最终提交。

## 验收边界

- 自动化接口验证：账号隔离、跨站限制、过期/撤销/消费、草稿变更及服务重启失效。
- 隔离 DOM 合同验证：仅匹配空白普通文本、事件触发、重复/隐藏/复杂控件拒绝、动态变更部分进度。
- 尚需本人加载扩展后的 Chrome / Edge 实机验收：扩展权限、Origin、popup 与当前页绑定、实际 React 控件接受值。没有用内置浏览器控制工具代替 Chrome 扩展实机运行，也没有在真实招聘表单填写合成信息。
- 安装步骤见 `browser-extension/README.md`。现有本机预演保留。未推送 GitHub，原申请/材料/日程不修改。

### 本轮已完成的验证

- `output/v2-acceptance/browser-extension-full.txt`：524项，521通过、0失败、3真实Word默认跳过。
- 隔离Dashboard页面：未勾选连接确认拒绝生成；勾选后生成成功并显示复制按钮。没有将配对码、密码或个人答案写入报告；已登出并停止QA。
- 正式备份 `2026-10-05T22-35-35.341Z-9c285f45` 后隐藏重载PID6192，health200。21张原持久表全列哈希一致，见 `browser-extension-formal.json`。
- 正式登录页标记保留。本轮仍未进行 Chrome/Edge 扩展安装后的真实执行验收、窄屏或截图验收。
