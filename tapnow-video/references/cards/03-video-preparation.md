# 03 图片、视频、真实素材引用与模型对比

**输入**：kind、title、精确 model、已有素材 ID＋title、prompt 或 promptParts、resolution、targetSeconds、audio；参考图和图片另传 aspect。
**完成条件**：实际型号、模式、输入角色／顺序／连线、全部参数、提示词和 1 份数量一致，生成按钮可用，但未激活。

调用 `runPreparedFlow({controller,request})`；`request.kind='frames'`、`'reference'` 或 `'image'`。不靠模型排序或旧目录选型；使用当前页面已验证的完整名称。图片节点可纯提示词或绑定参考图；图生视频的 Reference／Omni Reference 与首尾帧 Frames 分开核验。

```javascript
const request = {
  kind: 'frames', title, model,
  first: {id:firstId,title:firstTitle}, last: {id:lastId,title:lastTitle},
  resolution, targetSeconds, audio:false, turbo:false, prompt,
};
// 非首尾帧参考，使用真实素材引用：
const referenceRequest = {
  kind:'reference', title, model, references:[{id:sourceId,title:sourceTitle}],
  promptParts:['固定镜头，手持 ',{mention:sourceId},' 轻轻晃动。'],
  aspect:'Adaptive', resolution, targetSeconds:2, audio:false, turbo:false,
};
// 图片：kind:'image'，其余使用该图片模型实际支持的画幅／分辨率；不传视频时长。
const result = await runPreparedFlow({controller,request});
```

脚本顺序：精确导航 → 新建并命名草稿 → 选择型号和模式 → 调整视图 → 在可见空区放置草稿 → 按用途绑定输入 → 最后设置参数 → 替换提示词 → 核对最终证据。可传 `draft:{id,title}` 继续已确认的草稿，不能在未知完成状态下另建重复任务。

- 已选择的参数先读取，再决定是否点击。重复点 Frames 可能重置画质、时长；换型号／模式／素材后都要重新核对最终值。
- Frames 绑定图片后 aspect 可能成为 Auto，继承图片比例。不能把 Auto 报告成手动设置了 16:9；如用户要求确定比例，核对源图片与实际支持项。
- 参数菜单用同一个入口 Enter 关闭，禁止用 Escape 随手关闭；Escape 可能清空节点选择。
- 提示词编辑器先获得焦点再 Ctrl+A、Backspace、fill，最后读回全文。部分编辑器 fill 会追加旧文字，不能默认等于替换。
- `setMentionPrompt` 逐项输入真实 `@` 按键，选择 Linked node 中的精确来源；更多结果需展开。插入后核对芯片标题、稳定资产 ID、数量及全文，不能只检查文本出现了素材名字。显式 promptParts 必须引用每个已绑定参考；未传时脚本自动把已绑定参考追加为真实芯片。
- 先用简短正面描述。默认音频、Turbo 关闭；未暴露开关报告 not exposed。按已绑定输入后的实时秒数、numeric min/max/step 选择最小满足目标的合法时长，不用模型名称猜固定下限。短目标按 SKILL.md 的时长适配规则处理；意图、节拍或结局冲突不明时询问。
- 当前快捷函数覆盖图片首尾帧、Reference／Omni Reference 图片列表、图片节点及 1 份输出；音视频参考、特殊数量或不同菜单先做局部学习与验证，不静默降级。
- Reference 不应用 Frames 专属幻化风险门槛。实际提交 Frames 首尾帧遵守 [风险审核](../frames-risk.md)；prepareOnly 不进行任何提交。

## 多型号对比

`comparisonRequests(shared,cases)`（workflow-policy.mjs）复制同一任务与素材，cases 只改变精确型号、标题、各型号实际支持的输出参数。共用目标有效时长、简短提示词、参考身份及音频要求；逐型号读取最小时长并分别报告实际值。生成前逐个核对报价、数量与总预算；准备测试只创建／配置草稿，不调用任何生成入口。

不要把 Seedream（图片）与 Seedance（视频）互换。用户给出的版本或简称在当前菜单找不到时，先确认含义与可用项，不用相似型号凑对比。各型号参考方式不一致时说明差异，不宣称完全同条件。

**失败后**：保留已创建的草稿 ID 与失败阶段。重新读取它继续配置，不再次调用 createVideoDraft；脚本结果 `ok:false` 不能算准备完成。
