# 连接方案与验证状态

核验日期：2026-10-12。官方文档、实时工具 schema 和实际调用是不同证据；下面的工具边界以本次服务清单为准，使用时重新确认，不作为永久产品限制。

## 官方 MCP：优先入口

[官方接入文档](https://docs.tapnow.ai/zh/docs/mcp/add-a-custom-connector)区分两个站点：

| 使用的站点 | Streamable HTTP 地址 |
| --- | --- |
| `app.tapnow.ai` 国际站 | `https://mcp.tapnow.ai/api/agent-gateway/mcp/general/mcp` |
| `app.tapnow.media` 中国区 | `https://mcp.tapnow.media/api/agent-gateway/mcp/general/mcp` |

按现有账户站点选择，不能把 `.media` 的旧 workbuddy 专用路径作为国际站默认地址。官方说明授权绑定账户和团队，团队选择影响产物位置及使用的 Tapies；团队不明确时先确认，不能默认使用第一个团队。

2026-10-12 已实际验证：Codex 标准 DCR/OAuth 授权可识别国际站已有 Google 登录会话；授权后取得 14 个工具，`tapnow_status` 返回 `ok`，`list_visual_projects` 返回既有画布并与网页核对一致。此证据证明该接入流程和项目列表读取可用，不证明所有 Google 账户均可授权，也不证明付费生成、余额明细、原片下载或完整画布编辑已测试。未为验证连接触发生成。

### 接入与复用

Codex 官方支持 Streamable HTTP 与 OAuth：[MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。先定位当前 Codex CLI，并检查 `mcp add --help`、`mcp login --help`，不要固化本机版本路径。

1. 使用 `codex mcp get tapnow --json` 核对名称、地址和启用状态。已有正确配置且工具可用时直接复用。
2. 尚未配置且用户授权接入时，使用当前 CLI 支持的命令；本次验证命令为：

   ```text
   codex mcp add tapnow --url https://mcp.tapnow.ai/api/agent-gateway/mcp/general/mcp --oauth-client-registration dcr
   ```

   `add` 可能直接启动 OAuth；已有配置仅需授权时用 `codex mcp login tapnow`，不重复添加。不要覆盖已有不同配置。
3. 复用登录会话完成官方授权，选择目标团队。需要账户登录时交给用户，不读取凭据、浏览器 cookie 或 OAuth 存储，不移用其他客户端令牌。
4. 读取实时工具/schema，再调用 `tapnow_status` 和 `list_visual_projects` 做只读验证；确认项目属于目标账户及团队。配置、授权、工具加载、业务调用分别报告，不能用服务地址存在代替成功接入。

当前会话未暴露新配置的工具时，先检查客户端是否已加载连接，按其支持方式重新连接或刷新会话。可以使用当前 Codex app-server 提供的标准 MCP 状态和工具调用 RPC 作检查，先从当前 CLI 生成的协议定义核对 `mcpServerStatus/list` 与 `mcpServer/tool/call`；无需发起模型推理或读取令牌。Windows 沙箱与真实用户配置可能不同，确认运行用户和配置位置，不因沙箱中的 `mcp get` 无结果便宣布未安装。

### 实时清单与能力边界

[官方能力概览](https://docs.tapnow.ai/zh/docs/mcp/use-tapnow-in-other-agents)说明图片、视频、电商组图、演示配图、尺寸转换和素材库能力。下表来自 2026-10-12 实际工具清单；列出工具不等于已经执行对应业务操作。

| 操作 | 工具 | 副作用与边界 |
| --- | --- | --- |
| 连通性、画布列表 | `tapnow_status`、`list_visual_projects` | 只读；项目列表不是节点和连线详情 |
| 素材与文件夹搜索 | `find_library_assets`、`find_library_folders` | 查询 private/team/both 范围；按实际 schema 传参 |
| 素材选择面板 | `show_library` | 依赖客户端支持 MCP Apps；面板不可用时用搜索工具 |
| 图片上传 | `upload_image` | 写入平台；输入须为免登录、可直接下载的 HTTPS 图片，当前上限 10 MB；不支持直接传 Windows 本地路径 |
| 图片、电商组图、演示配图 | `create_hero_image`、`create_product_shots`、`create_deck_visuals` | 付费生成；组图按输出数量计费，先核对授权范围及参考参数 |
| 视频生成 | `create_hero_video` | 付费；当前 model 为 draft/fast/quality，时长为 5/10 秒，可选单张 image_id；没有精确模型名、尾帧或分辨率参数 |
| 尺寸转换、保存素材库 | `resize_for_platform`、`resize_for_platform_apply`、`save_to_library` | 当前说明不消耗 Tapies，但裁切或保存仍会写入平台；交互面板取决于客户端支持 |
| 生成结果查询 | `get_production_result` | 只读、不启动生成；按原 node_ids 及 project_id 查询，done 时返回 media_url/media_type |

图片 `model` 当前为 artistic/fast/quality，不能据此声称使用了某个具体厂商型号。精确模型、双图首尾帧、指定分辨率、音频或既有节点编辑，只有实时工具确实暴露对应参数时才能通过 MCP 执行，否则转浏览器。提示词不替代参数槽位。

### 跨入口衔接与完成判据

- 从 MCP 项目列表定位原画布；浏览器补充操作时复用返回的画布链接，不另建重复任务。只有项目列表时不能报告“已读取全部画布内容”。
- 本地参考图若无法直接交给 `upload_image`，优先浏览器上传到原画布，再使用已确认的节点标识；不为上传方便擅自公开用户素材。跨项目参考按 schema 传原 project_id，不猜测节点标识。
- 生成工具返回任务标识后保留 project_id 与 node_ids；`task_id` 是账务关联标识，不能用来替代 node_id。提交状态未知时先查状态或原画布，不重发。
- `get_production_result` 为 generating 时按工具建议等待并继续查询；done 后核验实际媒体，failed 后按现有授权判断是否重试。查询失败或下载失败不能直接触发重新生成。
- media_url 可供取回结果，但返回链接不等于本地下载成功。需要本地交付时确认文件存在、可解码，并检查原片信息；需要特定模型时还需核对节点或结果中的实际型号。

## 浏览器与页面 Agent：补足控制

Codex 内置浏览器已有登录、上传本地图片、Agent 创建任务、画布修改精确型号和参数、生成及结果检查的验证经验。当前可用内置浏览器时复用，不反复安装通用浏览器 MCP 或尝试其他浏览器。

浏览器负责 MCP 未覆盖的节点内容读取、连线编排和精确生成配置，步骤见 [浏览器工作流](browser-workflow.md)。Agent 适合表达任务和建节点，确认卡可能选错型号；按技能入口核对实际模型、输入角色、参数和报价。编辑原节点保存后再加载可验证配置持久化，但修改配置不会改变已有结果。

2026-09-17 对 `.media` workbuddy 服务的检查曾遇到国际站 Google 会话未被识别；这只是旧入口的历史阻点，已不能用于判断 `.ai` general 服务不可授权。若当前登录出现区域或账户不一致，返回正确站点的官方地址，不自行注册新账户或绑定手机号。

## Desktop 与第三方项目

TapNow Desktop 的本地文件能力不等于当前客户端有桌面控制入口；先检查实际工具。第三方连接器清单不是官方服务的实时权威 schema。[Playwright MCP](https://github.com/microsoft/playwright-mcp) 是通用浏览器控制器，[Tapnow-Studio-PP](https://github.com/chapterv/Tapnow-Studio-PP) 是独立自部署项目，均不能代替官方云账户的 MCP 接入验证。
