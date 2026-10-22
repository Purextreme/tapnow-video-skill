# TapNow Video Skill for Codex

通过 TapNow 官方 MCP 处理接口已覆盖的图片、视频、项目与素材任务，使用浏览器补足精确模型、首尾帧、分辨率和画布编辑。此仓库为社区技能，不是 TapNow 官方 CLI 或 MCP 服务。

## 安装

将仓库中的 `tapnow-video` 文件夹复制到 Codex 的技能目录（通常为 `~/.codex/skills/`）。已有同名技能时先检查本地修改，再合并或替换。

在 Codex 中使用 `$tapnow-video`，或直接描述 TapNow 任务。阅读 [技能入口](tapnow-video/SKILL.md) 和 [连接方案](tapnow-video/references/connection-options.md)。

## MCP 接入

国际站官方地址：`https://mcp.tapnow.ai/api/agent-gateway/mcp/general/mcp`。

支持相应选项的 Codex CLI 可使用：

```text
codex mcp add tapnow --url https://mcp.tapnow.ai/api/agent-gateway/mcp/general/mcp --oauth-client-registration dcr
```

完成官方 OAuth 授权并选择目标团队；已有连接时直接复用。先读取实时工具列表，调用 `tapnow_status` 和 `list_visual_projects` 进行只读验证。

## 能力与授权边界

截至 2026-10-12，已验证国际站 OAuth、工具清单及画布列表查询。视频接口提供档位与有限时长，未覆盖全部网页模型和参数；具体能力以当前工具 schema 为准。未通过付费生成测试全部接口。

生成工具可能立即消耗 Tapies，须在当前用户授权的数量、模型和预算范围内调用。返回任务标识不代表生成完成；保留项目和节点标识查询结果，避免通过不同入口重复提交。

本仓库仅包含通用技能、参考文档和节点搜索、画布缩放和结果下载辅助脚本，不包含账户凭据、MCP 本机配置或用户素材。

官方资料：[TapNow 接入文档](https://docs.tapnow.ai/zh/docs/mcp/add-a-custom-connector)、[TapNow MCP 能力](https://docs.tapnow.ai/zh/docs/mcp/use-tapnow-in-other-agents)、[Codex MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。
