# 02 素材复用、节点导航与上传

**输入**：素材用途、已验证节点 ID＋完整标题，或需上传的绝对路径清单。
**完成条件**：素材身份唯一、目标实际被选中、输入槽位／连线可核验；上传须逐项成功。

- 先通过 MCP `find_library_assets` 限定类型、范围与关键词，返回紧凑 ID。画布已有素材直接复用，不重复上传；按下表选择新上传来源，不为迎合接口公开本地私有素材。
- `controller.navigate({id,title})` 使用 Node search、精确标题结果和 Enter；验证选中的 ID，并等待画布定位动画稳定。重名时先取得可区分的节点身份，禁止取第一个结果。
- `controller.observedClick(controller.node(id), {nodeBody:true})` 从当次 DOM 计算露出的可点击点，并用 `elementFromPoint` 验证实际命中对象。中心被覆盖时尝试同一节点的可见部分；完全遮挡则移动工作节点或调整视图，不能盲点中心。
- 搜索结果会平移／缩放，创建节点也会自动定位；不要保存旧的节点坐标。缩放使用 `setTapnowCanvasZoom`，不固定按若干次减号。
- 单张本地 PNG 可用 `upload-canvas-image.mjs` 一次完成打开菜单、file chooser 交接、新节点及原片哈希核验；其他格式／多文件使用 `upload-files.js` 并提供对应核验器，省去手动导航 Windows 文件窗口。按 [分阶段上传](../browser-workflow.md#本地上传的分阶段执行) 核对身份、完成状态和用途，再绑定槽位；上传脚本不负责排布。
- 首尾帧使用 `bindFrames(id, first, last)`；参考图使用 `bindReferences(id, orderedSources)`。核对源素材 URL／资产身份与角色、顺序及连线，不只检查图片张数。不要把 referenceImage 当成 firstFrame／lastFrame。

| 素材来源 | 上传路线 |
| --- | --- |
| 宿主已提供真实会话图片附件 | 当前 MCP 支持时用 `upload_image(image_file)`；必须有宿主传入的 `file_id` 与临时 HTTPS `download_url`，不能从本地路径或截图文件名伪造 |
| 已有可直接下载的 HTTPS 图片 | 当前 MCP 支持时用 `upload_image(image_url)`，核对当前大小／格式限制，不改造私有素材为公开链接 |
| 仅有本地文件，或 MCP 不支持的媒体 | 浏览器 file chooser → 单次 `setFiles(绝对路径)` → 原节点完成核验；不直接点隐藏 file input，不注入文件事件 |

两种 MCP 来源互斥；支持图片不代表支持本地字节、视频或任意附件。MCP 超时也先查原资产，不立即换入口重复上传。大批本地素材首次采用小批验证，按实测完成情况串行调整，不增加并发来掩盖传输错误。

`upload_image` 返回的 `image_id` 与 `project_id` 配套使用；它可能创建独立画布，不能假定素材已落在浏览器当前画布。确认选择器尚未交接文件且当前接口已核验时，≤640 KiB 的 PNG／JPEG／MP4 可选[浏览器直传脚本](../observed-api.md#本地上传接口研究)。超过该范围的本地文件交给网页文件选择器；网页根据文件及当前策略选择存储协议。

**异常**：出现 `Object storage upload failed` 时保留成功项，只重试明确失败项；完成状态未知时先核对，不重复传整批。429／503 按 Retry-After 停止，401／403 或验证页面先核对登录／访问状态，不靠刷新、换入口或更快请求处理。超时可能来自网络或页面，不直接归因于文件／Skill。仍无法确定素材身份时才进行一次针对性的视觉检查。
