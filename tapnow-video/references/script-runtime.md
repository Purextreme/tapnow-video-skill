# 脚本运行、窗口变化与异常恢复

## 加载与复用

先读取 computer-use 和当前 CUA 浏览器文档，通过支持的接口绑定 `tab`（DOM）与 `native`（同一个 tab 的原生输入）。文件导入是控制器代码，页面 evaluate 只做 DOM 读取；禁止注入点击事件、私有状态、令牌或未公开 API。不要另起 Playwright／CDP 客户端争用浏览器。

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

- 每次操作读取新的窗口尺寸、DOM rect、画布 transform 和实际命中对象；没有保存屏幕绝对点击坐标。窗口大小变化清除会话拖动校准，重新计算空区、ROI 与点击点。
- 图片素材节点的世界坐标随画布缩放保持不变；屏幕坐标每次通过当前 transform 换算。画布标题／聊天栏也按语义控件定位，不依赖左上角／右上角固定像素。
- 搜索、新建节点、菜单弹出都有动画。等待目标 bbox 连续稳定和实际命中条件，不用“固定睡眠 5 秒”；未稳定就明确失败，不继续连点。
- 画布缩放有独立滑块，视频播放也可能出现 slider。出现歧义先读取当前 DOM 并按实际归属限定控件，不能把播放进度当画布缩放。
- 参考选择有独立的点击浮层。`bindCanvasSource` 等它出现，优先通过当前 DOM 命中点点击；需原生输入时先取新截图刷新坐标映射，截图不发送给模型识图。连接建立且选择器关闭后才继续。若精确连线仍不存在、同一个选择器明确保持打开，只允许一次映射刷新后的纠正；选择器已关闭而结果不明时停止。快捷键说明等遮挡也会使命中失败，先检查实际覆盖对象，不把它一律归因于动画或网络。
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
| 浏览器 tab 失联／过期 | 先按工具排障文档恢复同一已绑定浏览器下的 tab，不能反复重选浏览器或另开不相干会话 |

## 验证

Node：`node --test scripts/test-preparation.mjs scripts/test-workflow-policy.mjs`；缩放、上传脚本被修改时再运行对应 `test-zoom.cjs`、`test-upload.cjs`。
Python：项目 venv 执行 `scripts/test-matching.py`。纯几何／匹配测试不能代替真实画布：至少验证完整准备、所需模式、窗口变化、外部碰撞、失败停住及不生成。

用户要求计时时，报告成功率、样本数、完整墙钟和浏览器阶段，保留失败与版本；不把首次学习、冷页面加载、上传或网络恢复混成已缓存素材的准备速度，也不隐去它们。正常运行除返回计时外不额外写报告；本机媒体、路径、项目事实和测试结果留在任务记录，通用规则才进入 Skill。
