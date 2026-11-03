# 可选的同源接口路径

默认 MCP → DOM／脚本。这里是网页实际使用的内部 HTTP 接口，不是公开稳定 API；只在当前页面观察到请求、语义已核验且明显减少大量 UI 操作时采用。批量坐标可受益，普通菜单／导航不改走接口。页面更新、结构不符或接口不可用时保留原 DOM／脚本路径。

## 坐标写入

`canvas-position-api.mjs` 只允许当前已观察的两个同源地址：

- `GET /api/canvas/v1/canvases/{id}?with_nodes=true&with_connections=true`：两项查询参数必须保留，省略会返回空节点／连线集合。
- `POST /api/canvas/v1/canvases/{id}/nodes:batchActions`：仅发送 `action: update`，每项仅含 `id` 和 `position: {x,y}`，不替换整份节点数据。

通过当前 CUA 的 `tab.capabilities.get('cdp')` 使用；不建立外部调试连接，不读取浏览器凭据文件、存储或 React 私有状态。从当次实际请求中暂存最小会话请求头；不得打印、落盘、写进 Skill 或保留在异常文本中。缺少已观察的会话授权时直接使用 UI；401／403 停止并核对当前登录／页面，不探测其它认证入口。结束时 `dispose()` 并清除调用方暂存的请求／请求头。

```javascript
const {createCanvasPositionApi} = await import(root+'canvas-position-api.mjs');
const {createLayoutRunner} = await import(root+'canvas-layout.mjs');
// readUrl、writeUrl、sessionHeaders 均来自当前页面实际请求，不能猜测。
const positionApi = createCanvasPositionApi({cdp,readUrl,writeUrl,headers:sessionHeaders});
const runner = createLayoutRunner({controller,before,plan,positionApi,syncCanvas,startMs});
try { const result = await runner.moveNodes(plan.map(p=>p.id)); /* 查看 result.routes */ }
finally { positionApi.dispose(); }
```

`syncCanvas` 是调用方提供的已验证页面同步动作。仅在没有上传、生成或未保存编辑在途时刷新原画布一次，等待明确节点／边就绪后返回；不能用固定睡眠或第二个可编辑画布代替。服务器写入不会保证当前页面自动重绘，因此刷新后必须经原 `readCanvas` 审核身份、连线和位置。

脚本先核对服务器与 DOM 的节点／边 ID、位置，再写入；回读还会保护节点数据、尺寸、连接及范围外位置。结果分为：全部到位；部分到位，只对剩余节点回退；写入前普通不可用，直接回退；写入后无法回读或存在无关变化，停止。超时不代表未写入，不重放 POST。`routes` 保留原因与耗时，连续墙钟含同步和回退时间；安全回退后本次 runner 禁用接口加速。构建时若能力或当前路由不满足条件，报告原因并使用原 UI runner。

### 请求节奏与停止条件

- 同一画布只保留一个操作者、一个接口实例；并发 `move` 会被拒绝。一次批量改坐标，不逐节点发请求；每个接口请求结束后至少间隔 1.5 秒再发下一次。这是保守的工程起点，不是官方安全频率，也不保证不会限流。
- 429／503 立即停住，不追加回读、重放 POST、刷新或切 DOM 继续。`routes` 只记录脱敏原因、`httpStatus`、`retryAt` 和是否已尝试写入。按服务端 `Retry-After` 的秒数或 HTTP 日期确定最早复查时间；缺失／无效时至少暂停 30 秒，时间到不代表允许自动重试。[HTTP 语义](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after)、[429](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)。
- 401／403、成功状态却返回非 JSON 页面、写入结果未知或图数据变化同样停止，不绕过验证。该接口实例锁住；runner 和保存的 checkpoint 也不能借续跑绕到 UI。达到复查时间且异常解除后，先只读核对原服务端结果与保存的基线，必要时在无传输／编辑在途时同步页面，再用新基线、新实例继续剩余项，不盲目重放上次写入。

图片懒加载可能回写派生尺寸或预览元数据。若因此触发差异，先核对素材与用户设置并等待状态稳定，再取新基线；不要放宽保护或回写旧的预览数据。

CDP 若因页面响应暂停而不可用，不反复重试或关闭工具保护。可使用同一浏览器内一个临时 tab，导航到已观察的同源只读地址，完成请求后关闭；不要同时打开两个可编辑副本。`readEvents` 设置短超时并按 cursor 限量分页，不把等待事件当成无限网络监听。

## 其它操作的证据边界

| 操作 | 当前证据与采用条件 |
| --- | --- |
| 普通草稿创建、标题、模型参数、提示词保存 | 节点批处理确实持久化这些字段；未提交的视频草稿已通过接口创建并刷新核验。须从当前 UI 取得有效型号／模式／参数，不能照搬历史 defaults 或整份生产节点数据。创建超时先查新 ID，不能自动重复创建。 |
| 参考图绑定与真实 @ 引用 | 已通过独立 `connections:batchActions` 创建参考连线并刷新核验缩略图和 @ 芯片。连线带 `data.order`，提示词保存为 `{{Image N}}` 一类引用标记，必须与实际输入顺序一致；不能只写素材名称或只画一条线。当前结论针对已测图片参考视频，不推及首尾帧、音频或任意模型。 |
| 画布改名、配置、节点搜索／详情 | 当前前端有 `PATCH` 画布／配置及 v2 搜索／详情调用定义；尚未全部做直接接口回写验证，保持候选，优先现有 MCP／DOM。 |
| 分组、堆叠、首尾帧、延长、放大 | 不能由“节点接口存在”推定语义相同；涉及容器成员、输入角色或额外编辑器状态，未逐项验证前沿用现有卡片。 |
| 上传 | 默认走 [素材卡](cards/02-assets-navigation.md) 的官方 MCP／file chooser。小 PNG、JPEG 和 MP4 已验证从本地文件直传到原片核验和画布落点，必要时用[可选直传脚本](#本地上传接口研究)。 |
| 收起聊天、弹出菜单、视区导航 | 多为本地界面状态，DOM／脚本通常更直接，不强求服务器接口。 |
| 生成、删除、分享、权限 | 本轮不提供重放器；准备路径不调用生成。不得把发现入口当成获得额外授权。 |

扩展时按“观察一次 UI 请求→最小免费草稿验证→服务器回读→一次页面验收→恢复测试对象”推进。先验证字段是合并还是替换、ID 去重、输入顺序和并发冲突；没有证据就不启用自动写入。产品小幅变化只修当前适配并无生成验证，影响角色、费用或结果的变化请用户决定。只记录通用规则，测试画布名称、坐标、媒体和凭据留在任务内。

## 本地上传接口研究

当文件窗口不可靠、当前会话已观察到匹配的请求时，可显式启用 `direct-upload-api.mjs`。脚本按网页实测流程申请地址（`POST /api/files/upload-urls`）、向签名对象地址做一次 `PUT`、调用同源 `PUT /api/files/upload-urls/{file_id}/complete`，再校验下载原片的长度和 SHA-256。仅在原片吻合后按需创建一个上传节点；服务端回读核验新节点及既有节点和连线。存储 200 只表示传输阶段成功。

```javascript
const {createDirectUploadApi} = await import(root+'direct-upload-api.mjs');
const api = createDirectUploadApi({cdp,headers:sessionHeaders,initUrl,storageTransport:'browser'});
try { const result = await api.upload({file,canvas,videoDimensions}); }
finally { api.dispose(); /* 同时清除调用方暂存的请求与会话头 */ }
```

`file` 为绝对路径；只上传素材时省略 `canvas`，落点时传入从当前页面确认的 `{id,readUrl,writeUrl}`；MP4 落点还需实测 `videoDimensions: {width,height}`。无在途编辑时同步原画布一次，核对确切节点和预览；视频可能需要选中节点才挂载播放器。脚本 `wallMs` 到服务端核验为止，另计页面同步与媒体就绪。

- 这个脚本只处理 PNG／JPEG／MP4 的 `single_put`。常规备选只用浏览器传输，限 640 KiB。本地传输限 8 MiB，仅在专项验证时显式选用。两处都是脚本上限。操作计时须包含落点和页面就绪，不能用单次 PUT 耗时承诺 20 秒内完成。
- 上传签名和网关会话头只在内存短暂使用；签名存储只收其要求的头，不收网关鉴权。每个请求结束至少间隔 1.5 秒，沿用[限流停止条件](#请求节奏与停止条件)。只有预检明确返回 `safeToFallback:true` 时才可在核对状态后换回默认路线。写入结果未知时保留阶段及已取得的 `file_id`／节点 ID，只查原对象；不重放，也不切其他入口重传。页面结构或策略变化时先重新观察和做最小验证。

### 大文件与续传

大文件交给网页文件选择器，让 TapNow 管理存储协议。已观察并实测 `gcs_resumable`，网页以 8 MiB 分段传输。会话内续传通过空 `PUT` 和 `Content-Range: bytes */总大小` 查询。收到 308 时按 `Range` 的末字节加一继续。已有进度却无法核对范围、会话失效或遇到限流时，暂停并核验。存储返回完成后才请求 TapNow 确认并核对原片。[Google Cloud 续传说明](https://docs.cloud.google.com/storage/docs/performing-resumable-uploads)

续传会话地址等同临时凭据，仅存内存。已验证同一会话内的分段和中断恢复。浏览器重启后能否继续取决于原会话和网页状态，交由网页管理。其它对象存储协议须先观察当前网页的实际请求。
