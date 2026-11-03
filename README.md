# TapNow Video Skill for Codex

面向 Codex 的社区 Skill，支持 TapNow 的图片和视频草稿、素材管理、画布整理及原片交付。优先使用 TapNow 官方 MCP，画布操作交给浏览器 DOM 和本地脚本。DOM 无法定位时，先做本地图标匹配，必要时再用模型视觉核验。

## 安装与试用

1. 将仓库里的整个 `tapnow-video` 文件夹复制到 Codex 的技能目录，通常为 `~/.codex/skills/`。安装后应能找到 `~/.codex/skills/tapnow-video/SKILL.md`。已有同名 Skill 时，先检查本地修改。
2. 复用已有的 TapNow MCP 连接，或按账号所在站点配置连接器并完成 OAuth 授权。先做一次只读状态或画布列表检查，核对目标团队。需要网页配置时，打开已登录的原画布。[MCP 配置与 CLI 命令](tapnow-video/references/connection-options.md) · [TapNow 官方连接指南](https://docs.tapnow.ai/zh/docs/mcp/add-a-custom-connector)
3. 在 Codex 中调用 `$tapnow-video`，例如“在指定画布用这两张图配置首尾帧视频草稿，核对输入顺序和参数，先别生成”。[Skill 入口](tapnow-video/SKILL.md)

## 五张操作卡

| 操作卡 | 能做什么 |
| --- | --- |
| [01 会话与能力路由](tapnow-video/references/cards/01-session-routing.md) | 核对连接、团队与画布，选择执行路线并统计准备耗时。 |
| [02 素材与节点定位](tapnow-video/references/cards/02-assets-navigation.md) | 搜索与复用素材、上传本地文件、精确定位节点、绑定输入并核对角色。 |
| [03 图片与视频准备](tapnow-video/references/cards/03-video-preparation.md) | 配置图片和视频草稿，支持首尾帧、参考素材的真实 `@素材` 引用及多模型配置对比。 |
| [04 视频延长与放大](tapnow-video/references/cards/04-video-extension.md) | 配置视频前补、后续和放大草稿，核对来源及参数。 |
| [05 复杂画布整理](tapnow-video/references/cards/05-canvas-management.md) | 按连线流程排列工作节点，检查内外碰撞，支持分批续跑、分组和堆叠。 |

## 上传、下载与生成

- **上传**　支持的图片附件或现成 HTTPS 图片优先走 MCP。本地文件默认通过网页选择器交接。小文件只有在确认选择器尚未交接、且当前接口已核验时，才考虑脚本直传。[素材卡](tapnow-video/references/cards/02-assets-navigation.md)
- **下载**　优先取 MCP 返回的原片地址，也可用脚本点击节点工具栏的 Download。下载后核对实际文件，区分预览与原片。[原片下载与对比](tapnow-video/references/browser-workflow.md#原片下载与对比)
- **接口加速**　批量节点坐标写入和小文件直传可以选用当前页面已核验的同源接口。接口调用有节流和回读校验。遇到限流、鉴权异常或写入结果未知时，先停下来核对状态。[同源接口约定](tapnow-video/references/observed-api.md)
- **生成**　草稿准备与生成提交分开。按当前页面或 MCP 确认可用型号、参数、输出数量和报价，并遵守授权预算。提交状态未知时，先查原任务和节点，避免重复生成。[生成与验收](tapnow-video/references/browser-workflow.md#生成查询与网页验收)

## 计时、日志与排障

完整准备流程以 20 秒为目标，按连续墙钟计时，生成等待单独计算。准备、上传、排布和下载脚本会记录异常、回退和准备超时。日志只保存操作阶段、耗时等诊断字段，自动分卷并清理，保留最近 14 天且最多 12 个文件。[日志目录与字段](tapnow-video/references/script-runtime.md#本地诊断日志)

页面和脚本行为对不上时，先区分选区、窗口缩放和网络问题，再检查页面是否更新。脚本修改可先跑本地测试，再做无生成的画布验证。[验证方法](tapnow-video/references/script-runtime.md#验证) · [TapNow 官方更新日志](https://docs.tapnow.ai/en/docs/changelog)
