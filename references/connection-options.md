# 连接方案与验证状态

核验日期：2026-09-17。优先复用现有可靠入口，下面的限制属于核验时的环境，不是永久产品能力。

## 浏览器：已完成真实生成闭环

Codex 内置浏览器已验证：登录会话、上传本地图片、Agent 创建生成任务、画布修正精确型号和参数、单次生成、全屏结果及原片信息检查。新标签页可在同一登录环境恢复原画布和素材。外部 Chrome 连接曾多次超时；已有可用内置浏览器时不反复重试。

对于已登录 `.ai` 的 Google 账户，当前优选方案是内置浏览器直接操作画布，按需使用页面 Agent。无需为了每次创作重新研究或安装 MCP。只有目标操作确实缺少入口，或出现已证实更合适的接口时，再重新选路。

编辑保存也已验证：修改原节点时长后重新加载画布，原节点仍保留新参数；恢复原时长后可以继续使用原生成结果，未触发重新生成。节点配置是下一次生成的输入，不能把修改后的时长当作已有视频的实际时长。

选择规则：需要具体模型及参数时直接检查画布；Agent 适合建立节点和表达创作任务，但确认卡可能选错型号，必须核对。所有付费重试先确认原任务状态。

本地下载尚未形成可靠闭环：页面下载曾取消，媒体下载方法曾跳转原片并发生页面崩溃。任务要求本地文件时继续解决传输，不把可在线播放当作已完成本地交付。

## TapNow MCP：服务已确认，客户端能力需逐项验证

公开服务地址：`https://mcp.tapnow.media/api/agent-gateway/mcp/workbuddy/mcp`。

一手只读证据：

- [资源元数据](https://mcp.tapnow.media/.well-known/oauth-protected-resource/api/agent-gateway/mcp/workbuddy/mcp)：授权服务器为 `https://oauth.tapnow.media/`，scope 为 `mcp.tools.invoke`、`mcp.tools.read`。
- [OAuth 元数据](https://oauth.tapnow.media/.well-known/oauth-authorization-server)：authorization code、refresh token、PKCE S256、动态客户端注册；公开客户端认证方式包含 `none`。

该地址带有 workbuddy 路径，不能未经验证就假定所有客户端、回调地址和工具均开放。[第三方连接器镜像](https://github.com/ahang1598/doubao-workbuddy-qwenwork-skills/tree/main/workbuddy/connectors/marketplace/connectors/tapnow)仅作为发现线索；它列出的图片、素材库及项目工具不是当前服务器的权威清单，未证明视频或 Kling 生成能力。

### 账户区域与登录阻点

正常 Codex DCR 流程已经成功建立客户端注册并到达显示“Codex”的 TapNow 授权页，但授权跳转的是 `app.tapnow.media`。实测该入口只有手机号、SSO、邮箱；用户在 `app.tapnow.ai` 的 Google 登录会话未被直接识别。因此当前证据只证明 OAuth 握手可发起，尚未证明该账户能完成授权、读取原画布或共享余额。

[官方故障排查](https://docs.tapnow.ai/en/docs/account/troubleshoot-issues)明确区分全球站与中国区；但本次未找到官方说明两域账号互通关系，或适用于 `.ai` Google 账户的国际 MCP 地址。不能仅根据域名宣布账号独立，也不能以相同邮箱推断为同一账号。遇到此情形保留原 `.ai` 浏览器路线，不自行注册新账号、绑定手机号或替换 OAuth 域名。

Codex 官方支持 Streamable HTTP + OAuth/DCR：[MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。接入前使用当前 CLI 帮助确认命令；正常 OAuth 授权后读取实时工具清单，先验证只读项目查询，再按用户需求启用写操作。不得移用 WorkBuddy 的账户令牌、伪装官方客户端或绕过授权。

标准配置形状：

```toml
[mcp_servers.tapnow]
url = "https://mcp.tapnow.media/api/agent-gateway/mcp/workbuddy/mcp"
```

是否已经配置、OAuth 是否完成、工具是否加载是三个独立状态。`mcp add` 成功不证明授权完成，OAuth 成功也不证明存在视频工具。若目标工具缺失，回到浏览器执行该操作，保留 MCP 已验证可用的部分。

本次未完成授权的本地 MCP 测试项已清理；不能报告为已安装可用连接，也不在后续普通浏览器任务中自动重新发起授权。

## Desktop 与第三方项目

TapNow Desktop 支持本地文件的能力不等于当前 Codex 已具备桌面控制入口。先检查可用工具；没有入口时用浏览器，不为控制已有网页改动桌面安全设置。

[Playwright MCP](https://github.com/microsoft/playwright-mcp) 是通用浏览器控制器，已有可用浏览器工具时无需重复安装。[Tapnow-Studio-PP](https://github.com/chapterv/Tapnow-Studio-PP) 是独立自部署项目，不是用户 TapNow 云账户的控制器。
