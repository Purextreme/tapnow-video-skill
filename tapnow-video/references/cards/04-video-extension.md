# 04 视频延长、前补与放大准备

**输入**：原视频节点 ID＋title、operation、duration、continuity、prompt。
**完成条件**：原视频身份正确，Video Creation Beta 面板显示目标延长方式与参数，提示词准确，Confirm and generate 可用且未点击。

```javascript
const request = {
  kind:'extend', source:{id,title}, operation:'Add prologue',
  duration:'6s', continuity:'Natural continuity', prompt,
};
await runPreparedFlow({controller,request});
```

`prepareExtend` 自动搜索原视频，在该节点内定位 `svg.tabler-icon-time-duration-30` 所属按钮，进入 Video Creation Beta，设置 Add prologue／Continue story、实际可选时长和延续方式，替换提示词并读回摘要。图标没有按钮名称时可用已观察到的 DOM 特征，不能靠“第几个按钮”。

- Add prologue 是前补，Continue story 是后续；按用户意图选择。不能从“加长”自行推定前补。
- 当前秒数和模型限制以打开的面板为准，不能沿用截图中的固定范围。输入不被当前 UI 支持时停止并保留面板，不换参数凑成功。
- 原视频可能带入素材。核对来源和继承的参考，不擅自清空。
- 固定图标的 DOM 特征不存在时，使用 [本地图标匹配](../script-runtime.md#本地图标特征匹配)；模板为纯控件图标，不含用户媒体。匹配不唯一时不点击，才升级一次视觉确认。
- 正式提交按钮名称为 Confirm and generate；准备脚本拒绝这个按钮。关闭面板使用其中的 Close，不能关闭其他浮层或浏览器。

## 视频放大

```javascript
await runPreparedFlow({controller,request:{
  kind:'upscale',source:{id,title},title:upscaleTitle,
  model:exactUpscaleModel,resolution:exactResolution,
  frameRate:'Adaptive',slowMotion:'Adaptive',
}});
```

`prepareUpscale` 在来源节点工具条定位已观察的 HD 图标，新建且仅新建一个放大草稿；也可传精确 draft 继续。核对来源连线和视频缩略图，设置当前放大型号、分辨率、帧率与慢动作，等报价／按钮就绪。Adaptive 默认保留时间特性，不擅自插帧或改变速度；原片与放大结果分别保留。`Video Upscale` 是正式付费提交按钮，准备脚本禁止激活；HD 入口只创建草稿，不能将两者混淆。图标变化按运行约定局部重学，不改点相邻工具。
