# Codex 的 TapNow MCP 接入

已有工具可用时直接复用；只在新增或排查连接时使用本页。

## 连接与授权

按账户所在站点选择官方地址，保留原团队；团队会影响产物位置和 Tapies 使用，目标不明确时先确认。

| 站点 | Streamable HTTP 地址 |
| --- | --- |
| `app.tapnow.ai` 国际站 | `https://mcp.tapnow.ai/api/agent-gateway/mcp/general/mcp` |
| `app.tapnow.media` 中国区 | `https://mcp.tapnow.media/api/agent-gateway/mcp/general/mcp` |

1. 使用 `codex mcp get tapnow --json` 核对连接，新增前检查当前 CLI 的 `mcp add --help` 和 `mcp login --help`。
2. 用户授权新增连接时，可按当前 CLI 支持情况使用：

   ```text
   codex mcp add tapnow --url https://mcp.tapnow.ai/api/agent-gateway/mcp/general/mcp --oauth-client-registration dcr
   ```

   `add` 可能启动 OAuth；已有连接只需登录时使用 `codex mcp login tapnow`，不重复添加或覆盖配置。
3. 登录交给用户，复用现有会话完成官方授权。区域或账户不一致时回到正确站点，不另注册账户或读取凭据、cookie、OAuth 存储。
4. 配置存在、授权成功、工具已加载和业务调用可用分别核验。先调用 `tapnow_status`，需要项目列表时再调用 `list_visual_projects` 并核对目标团队与画布。

工具未加载时检查 Codex 的连接状态，按当前客户端支持方式重连或刷新。Windows 沙箱与真实用户的配置可能不同，先核对运行用户和配置位置，不能仅凭沙箱中的 `mcp get` 无结果断定未安装。

来源：[TapNow 接入文档](https://docs.tapnow.ai/zh/docs/mcp/add-a-custom-connector)、[Codex MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。命令及服务能力以当前版本为准。

## 工具选择

下表用于发现工具，不固化型号、时长、上传上限或费用；每次按实时参数和任务报价核对。

| 用途 | 工具 | 操作边界 |
| --- | --- | --- |
| 状态、项目及素材查询 | `tapnow_status`、`list_visual_projects`、`find_library_assets`、`find_library_folders` | 只读；项目列表不等于画布全部内容 |
| 素材选择 | `show_library` | 需 Codex 支持 MCP Apps；面板不可用时用素材查询 |
| 上传 | `upload_image` | 写入平台；核对支持的输入来源，不为上传方便公开本地素材 |
| 图片、视频、电商组图、配图 | `create_hero_image`、`create_hero_video`、`create_product_shots`、`create_deck_visuals` | 可能直接付费提交；核对型号、参数及输出数量 |
| 尺寸转换、存库 | `resize_for_platform`、`resize_for_platform_apply`、`save_to_library` | 会写入平台，即使不收费也须在任务范围内 |
| 结果查询 | `get_production_result` | 沿用提交返回的 `project_id` 和 `node_ids`，不启动生成 |

工具无法表达指定型号、参考角色或参数时，转浏览器配置；不能把要求写进 prompt 后声称已设置。MCP 项目链接可用于打开原画布；本地图片不被上传工具支持时，在原画布通过浏览器上传，不另建重复任务。生成后的查询与交付见 [浏览器工作流](browser-workflow.md#生成查询与网页验收)。
