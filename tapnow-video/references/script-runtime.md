# 脚本运行、窗口变化与异常恢复

## 加载与复用

先读取 computer-use 和当前 CUA 浏览器文档，通过支持的接口绑定 `tab`（DOM）与 `native`（同一个 tab 的原生输入）。文件导入是控制器代码，Playwright evaluate 只做 DOM 读取，不注入事件或读取私有状态。可选接口仅通过当前 CUA 公开的 CDP 能力，按[同源接口约定](observed-api.md)重放已观察、已授权的请求；不要另起 Playwright／CDP 客户端争用浏览器。

```javascript
const {homedir} = await import('node:os');
const {join, sep} = await import('node:path');
const {pathToFileURL} = await import('node:url');
const root = pathToFileURL(join(homedir(), '.codex', 'skills', 'tapnow-video', 'scripts') + sep).href;
const {TapnowPreparation} = await import(root+'browser-actions.mjs');
const {setTapnowCanvasZoom} = await import(root+'set-canvas-zoom.js');
const {runPreparedFlow} = await import(root+'preparation.mjs');
const controller = new TapnowPreparation({tab,native,setZoom:setTapnowCanvasZoom});
// 请求与预检先准备好，正式操作时只调用这一行：
const result = await runPreparedFlow({controller,request,startMs,mcpMs});
```

每个会话复用控制器和经过核验的请求；按实际平台路径替换 root。不要每次重新发送整段函数和全量截图。模块修改后使用新的模块地址／会话重新加载，避免把旧缓存当成新版本。最终每组动作获取一次最新 AX／DOM 状态；中间步骤在脚本内用明确后置条件核验。

重新加载模块后把当前 controller 和 request 直接传入 `runPreparedFlow`；不要复用捕获了旧 controller 的测试闭包。加载地址变化不代表旧闭包自动升级。

## 全屏、窗口缩放与动画

- 每次操作读取新的窗口尺寸、DOM rect、画布 transform 和实际命中对象；没有保存屏幕绝对点击坐标。窗口或画布缩放变化清除会话拖动校准，重新计算空区、ROI 与点击点。
- 图片素材节点的世界坐标随画布缩放保持不变；屏幕坐标每次通过当前 transform 换算。画布标题／聊天栏也按语义控件定位，不依赖左上角／右上角固定像素。
- 搜索、新建节点、菜单弹出都有动画。等待目标 bbox 连续稳定和实际命中条件，不用“固定睡眠 5 秒”；未稳定就明确失败，不继续连点。
- 画布缩放有独立滑块，视频播放也可能出现 slider。出现歧义先读取当前 DOM 并按实际归属限定控件，不能把播放进度当画布缩放。
- 参考选择有独立的点击浮层。`bindCanvasSource` 等它出现并检查当前 DOM 命中点；Reference 路径的语义点击已出现未消费情况，直接用一次新截图映射的原生点击，截图不发送给模型识图，其他路径保留既有入口。连接建立且选择器关闭后才继续。若精确连线仍不存在、同一个选择器明确保持打开，只允许一次映射刷新后的纠正；选择器已关闭而结果不明时停止。快捷键说明等遮挡也会使命中失败，先检查实际覆盖对象，不把它一律归因于动画或网络。
- 多素材用 `sourceImages` 一次读取各自节点的主要图片身份；@ 插入前再次读取，不跨操作缓存。缺失预览等待、身份歧义停住，输入顺序、缩略图、真实 @ 芯片及精确连线核验不省略。
- 节点搜索可能同时改变缩放；固定像素的编辑栏不能按节点世界尺寸推算。替换放置策略前，同时验证编辑栏可见、源素材可点击和节点无新增重叠；仅让编辑栏进入视野仍可能遮住素材。没有通过完整流程的方案不替换现有策略，不为 20 秒目标削减核验。
- DOM 状态、截图和原生坐标可能短暂不同步。不能把导航前截图与导航后 DOM 坐标混用；图标匹配使用当次截图自身的像素坐标，点击后验证面板。不要把预览白屏、延迟加载等页面问题误诊为模型或素材参数错误。

## 本地图标特征匹配

`scripts/match-control.py` 使用 OpenCV 灰度归一化模板匹配，多尺度搜索，并以最高分和第二个独立位置的分差拒绝歧义；没有 OCR 或模型调用。该工具只分析本地截图、返回候选位置，绝不点击。

1. 一次视觉／DOM 学习，截取纯控件图标存入 `assets/controls/`；不能把完整用户画面或媒体素材打进通用 Skill。`continue-video.png` 为初始模板，`continue-video-current.png` 为当前 UI 校准模板；优先验证当前模板，UI／主题／DPR 变化后重新校准，不降低阈值强行接受。
2. 用 CUA 获取当次截图，限定当前选中节点的工具条 ROI。项目 venv 安装 `scripts/requirements-matching.txt`；不要全局安装大型视觉框架。
3. 调用 `python match-control.py --image <absolute.png> --template <absolute.png> --roi X Y W H`。仅 accepted=true 才可考虑点击；分数不足／重复图标时扩大证据，不能任取一个。默认阈值是起点，当前主题／缩放下须有正负样本验证。
4. 输出坐标是当次截图像素；按截图宽高与 DOM viewport 宽高转换为 CUA 所需坐标。全屏、缩放、菜单移动或换截图后丢弃旧结果。点击前确认目标区域未变，点击后核对目标面板／状态；否则不复用匹配。

方法参考：[OpenCV Template Matching](https://docs.opencv.org/4.13.0/d4/dc6/tutorial_py_template_matching.html)。像素外观会受主题、DPR、压缩和版本影响；它是 DOM 不足时的补位，不能取代素材语义和最终状态验证。

## 网络、页面与浏览器恢复

`classifyFailure` 仅给恢复方向，不自动刷新、重传或重复生成。

| 证据 | 恢复 |
| --- | --- |
| 简单只读也连接失败／固定长延迟 | 对同一目标做一次小范围只读检查，区分 MCP、浏览器辅助进程与站点；需要时按既有代理启动器恢复，不关闭安全机制 |
| 节点存在，但控件缺失／歧义／动画超时 | 重新读一次限定 DOM／AX，检查选择、浮层、遮挡和全屏变化；有证据后修对应定位 |
| 页面网络错误、无上传／生成在途 | 保存原画布与节点 ID 后可刷新一次，等待明确画布就绪，再只读核对；不靠反复刷新掩盖问题 |
| 上传／生成完成状态未知 | 查询原对象，保留成功项，不刷新重放整个操作；明确终态后才按授权处理 |
| 429／503、401／403 或验证页面 | 按[接口停止规则](observed-api.md#请求节奏与停止条件)暂停并核对；不能换入口、刷新或重复上传来绕过限制 |
| 浏览器 tab 失联／过期 | 先按工具排障文档恢复同一已绑定浏览器下的 tab，不能反复重选浏览器或另开不相干会话 |

## 验证

Node：`node --test scripts/test-*.mjs scripts/test-*.cjs`。测试前将 `TAPNOW_LOG_DIR` 设为本次独立的绝对临时目录，避免测试异常混入日常日志。限流／拒绝场景用本地模拟，不对真实站点发压测请求来主动触发风控。
Python：项目 venv 执行 `scripts/test-matching.py`。纯几何／匹配测试不能代替真实画布：至少验证完整准备、所需模式、窗口变化、外部碰撞、失败停住及不生成。

用户要求计时时，报告成功率、样本数、完整墙钟和浏览器阶段，保留失败与版本；不把首次学习、冷页面加载、上传或网络恢复混成已缓存素材的准备速度，也不隐去它们。正常运行除返回计时外不额外写报告；本机媒体、路径、项目事实和测试结果留在任务记录，通用规则才进入 Skill。

画布批处理在导航前捕获 `startMs=Date.now()` 并传给 `createLayoutRunner`；返回的 `fullWallMs` 使用同一个起始时间，续跑也包含中断间隔。逐节点耗时仅用于定位瓶颈，不能相加冒充完整墙钟。检查点由调用方在任务目录按需保存。

## 本地诊断日志

按[加载约定](#加载与复用)使用控制器所在的 Node 运行时。可与本次模块加载合在同一次调用中。纯 MCP 任务用本地 Node 执行同一模块，省去浏览器往返。

```js
const {maintainTapnowLogs, recordTapnowEvent} = await import(root+'diagnostics.mjs');
await maintainTapnowLogs();
// 未经过脚本的异常才补记，例如 MCP 查询超时。
// await recordTapnowEvent({operation:'session', route:'mcp', stage:'result',
//   outcome:'failed', reason:'timeout', elapsedMs});
```

准备、上传、排布和工具栏下载会自动记录异常，包括状态不明、实际回退、已恢复的上传回执超时和超过 20 秒的完整准备。记录仅含 UTC 时间、操作、路线、阶段、结果、分类、耗时及可用的 HTTP 状态／写入不确定标记。日志字段采用白名单。原始报错、标题、项目／节点 ID、路径、媒体、提示词、网址和凭据都不写入。

Windows 使用 Codex 的本地目录 `~/Documents/Codex/.tapnow-skill/logs`，让 CUA 与终端可读写同一份日志。其他系统使用 `~/.local/state/tapnow-skill/logs`。可读取环境变量的 Node 进程可用绝对路径 `TAPNOW_LOG_DIR` 指定目录。按 UTC 日或单文件 128 KiB 分卷，保留最近 14 天且最多 12 个分卷。开始任务及创建新分卷时自动清理本日志的过期或超量文件，无需后台进程。日志写入失败不改变原操作结果。

排障按异常时间读取最新的 `tapnow-*.jsonl`，结合当前页面和任务状态核验原因。已归纳的规则进入 [异常暂存](self-improvement-log.md)，运行日志和临时证据不入库。
