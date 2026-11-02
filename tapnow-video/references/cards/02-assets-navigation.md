# 02 素材复用、节点导航与上传

**输入**：素材用途、已验证节点 ID＋完整标题，或需上传的绝对路径清单。
**完成条件**：素材身份唯一、目标实际被选中、输入槽位／连线可核验；上传须逐项成功。

- 先通过 MCP `find_library_assets` 限定类型、范围与关键词，返回紧凑 ID。画布已有素材直接复用，不重复上传。工具仅接收公网 URL 时，不为迎合接口公开本地私有素材。
- `controller.navigate({id,title})` 使用 Node search、精确标题结果和 Enter；验证选中的 ID，并等待画布定位动画稳定。重名时先取得可区分的节点身份，禁止取第一个结果。
- `controller.observedClick(controller.node(id), {nodeBody:true})` 从当次 DOM 计算露出的可点击点，并用 `elementFromPoint` 验证实际命中对象。中心被覆盖时尝试同一节点的可见部分；完全遮挡则移动工作节点或调整视图，不能盲点中心。
- 搜索结果会平移／缩放，创建节点也会自动定位；不要保存旧的节点坐标。缩放使用 `setTapnowCanvasZoom`，不固定按若干次减号。
- 本地文件使用现有 `upload-files.js`，严格遵守 [分阶段上传](../browser-workflow.md#本地上传的分阶段执行)：文件交接不等于网页上传完成；逐个核对缩略图、名称、上传状态和用途，再绑定槽位。
- 首尾帧使用 `bindFrames(id, first, last)`；参考图使用 `bindReferences(id, orderedSources)`。核对源素材 URL／资产身份与角色、顺序及连线，不只检查图片张数。不要把 referenceImage 当成 firstFrame／lastFrame。

**异常**：出现 `Object storage upload failed` 时保留成功项，只重试明确失败项；完成状态未知时先核对，不重复传整批。超时可能来自网络或页面，不直接归因于文件／Skill。仍无法确定素材身份时才进行一次针对性的视觉检查。
