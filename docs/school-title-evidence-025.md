# 0.2.5 已选标题的一次点击只读诊断

## 可用入口

沿用已安装扩展及原批次，不重新准备、不授权运行、不点击职位。重新加载本地扩展到 0.2.5 后，在原学校列表标签打开扩展，点击顶部 **只读诊断已选标题（不点击岗位）**。一次读取原批次已选的两个标题，并下载 `career-queue-school-title-evidence.json`；无须逐岗复制或先开 DevTools。该按钮不启动批次、不改检查点、不申请权限。原列表临时访问依赖现有 activeTab；不可访问时直接报错，不自动请求更广授权。没有保存选择、原标签不符、身份改变或正在执行时拒绝采集，不自行改选其它岗位。

## 导出的最小证据

- 严格核对已选 School ID、可见标题、公司、学期及唯一 A[role=button] 后，才读取该目标及最多四层祖先。
- 链接只报告缺失、占位 javascript、其它 javascript、同源职位路径、其它同源或外部等类别；不输出路径、查询串、片段、凭据或命名窗口值。
- 只读 onclick/pointer/mouse/key 属性，最多每项 4096 字符，仅导出事件类型及固定语法线索（window.open、isTrusted、userActivation、history 路由等）。字符串、注释、任意函数名、参数和原始代码不导出，也不读取会编译处理器的 onclick 属性 getter。
- 安全属性只保留角色、disabled/inert、aria-disabled 与 tabindex 类别；不导出原始 id、class、data-* 或账号属性。
- 最多看 40 个公开 script[src] 属性，汇总同源/外部计数及固定已知库类别，不输出 URL 或抓取脚本正文。与已选处理器的关系始终标 unknown，不能由文件名猜测学校路由。
- 不读 Cookie、Storage、表单值、隐藏正文、整页 HTML、网络记录或完整 JD；不请求远端资源，不触发网站点击/导航。

## 能区分什么

例如实际存在 inline onclick 且含 window.open、isTrusted 或 history 引用时，结果能缩小到相关机制；目标/祖先的 pointerdown 属性或命名 target 也会单独标记。所有线索只是语法引用，不证明代码执行、门槛方向或根因。源长度或祖先超限会显式标记，不能当作完整扫描。

## 明确不能读取的内容

标准扩展 API 不能可靠枚举页面通过 addEventListener 或框架绑定的监听器，也不能回溯既有控制台错误。结果字段 eventListenerEnumeration / historicalConsoleErrors 明确 unavailable。没有 inline 属性不等于没有监听器。没有申请 debugger、远程调试、MAIN-world 注入或页面桥接，也没有包装 window.open、事件注册或浏览器策略。

若只读结果仍只有未知类别，先停下分析该文件，不要求再跑岗位。只有确实需要普通 API 无法获得的绑定时，最少人工步骤才是：在原标题右键“检查”，在 Elements 的 Event Listeners 中查看 click（以及若存在的 pointerdown/keydown，包含 Ancestors）；只提供相关处理器名称/绑定位置或经裁剪的小段处理器，参数值和账号信息无需分享。无需整页源码、Console 全量截图、Network/HAR、Cookies、Storage 或再次点击职位。此路径是能力边界说明，不是现在要求用户执行的操作。

## 验证

测试覆盖身份变动、重复目标、两项选择、未选行隔离、认证页、源/祖先/脚本限额、敏感字串裁剪、属性 getter 禁用、无点击、无权限请求、原批次无写入及一次点击下载。另在用户电脑独立 Edge 配置验证真实 MV3 ISOLATED 采集与窄屏入口，临时合成扩展只访问 localhost。没有运行真实 Brave 学校批次；首次真实开页失败根因仍待证据。

本版仅增加诊断，不宣称修复首次开页原因；不改权限范围、Shields、既有申请历史或 main。完整记录：`private/<local-evidence>`。
