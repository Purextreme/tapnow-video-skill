# 模型对照与证据边界

检索及 UI 核验日期：2026-09-17。每项区分模型官方能力、TapNow 文档能力、现场 UI 观察。后续版本与账户权限可能不同。

## Kling 3.0 与 Kling 3.0 Omni

| 项目 | Kling VIDEO 3.0 | Kling VIDEO 3.0 Omni |
|---|---|---|
| 模型沿革 | VIDEO 2.6 后续模型 | VIDEO O1 后续模型 |
| 生成任务 | 文生、图生、首尾帧 | 文生、图生、首尾帧、多图／主体参考 |
| 主要侧重 | 动作、原生音频、多镜头叙事与一致性 | 更广的参考组合、主体与声音一致性、编辑及自定义分镜 |
| 音频／多镜头 | 均支持，按任务配置 | 均支持；指南注明直接视频输入与原生音频存在限制 |
| 时长 | 3—15 秒 | 最长 15 秒 |
| 是否可互换 | 否 | 否 |

来源：[快手官方发布](https://ir.kuaishou.com/news-releases/news-release-details/kling-ai-launches-30-model-ushering-era-where-everyone-can-be)、[VIDEO 3.0 指南](https://app.klingai.com/cn/quickstart/klingai-video-3-model-user-guide)、[Omni 指南](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide)。普通版指南本次通过官方搜索索引读取，旧域直接访问受 robots 限制。

两者都能做首尾帧，不能由任务类型反推型号。普通版支持主体绑定也不代表它等同于 Omni 的通用多模态输入／编辑入口。

Omni 的 2026-02-06 指南：无视频时图片与主体合计最多 7 项，有视频时最多 4 项；直接参考视频是 1 段、3—10 秒、≤200MB、最高 2K。用于创建人物主体的视频是 3—8 秒，属于另一种输入用途。声音输入时长在正文与 FAQ 有不同表述，执行时核验当前入口，不合并成一个断言。

早期指南列 720p／1080p；后有 [官方原生 4K 更新](https://kling.ai/blog/kling-ai-introduces-native-4k-video-model)。不能把旧文的 1080p 写成永久上限，也不能把整个系列的更新推及每个 TapNow 任务入口。

### TapNow 现场识别

| 页面完整名称 | 可见图标 alt 标识 |
|---|---|
| Kling 3.0 | `kling-v3-pro` |
| Kling 3.0 Omni | `kling-video-o3` |
| Kling 3.0 Omni Edit | `kling-video-o3-edit` |

上述是当前页面 DOM 可见标识，不是公开 API 契约。首次核验中 Agent 卡未列普通 3.0，但完整画布菜单列出它；原因未确定。应分别检查入口，不推定别名关系。

现场两个生成型号均有 4K、3—15S 徽标。普通 3.0 节点提供 Standard／Pro／4K、Frames、3—15 秒、音频开关；Frames 下画幅及分辨率显示 Auto。切换型号后画质和时长曾恢复默认，因此每次都重查。不要根据 Standard 名称单独宣称某个精确像素尺寸。

## TapNow 文档直接列出的差异

| 型号 | 当前文档要点 |
|---|---|
| Seedance 2.5 | Frames、Omni Reference、Video Edit；支持 1080p，新任务默认 720p；全能参考最多 30 图／10 视频／10 音频 |
| MiniMax H3 | Frames／Reference；768P／2K，4—15 秒；参考最多 9 图／3 视频／3 音频 |
| MiniMax H3 Max | 单首帧或文生；480P／768P，5—15 秒；不支持首尾帧或多模态参考 |
| Wan 3.0 | 文生、首帧、1—10 图参考；480P／720P／1080P，2—30 秒或 Auto；尾帧入口未由该文证实 |
| FLUX 3 | 文生或单首帧；720p／1080p，5—20 秒；不要据此推断有尾帧模式 |

来源：[TapNow 视频文档](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video)。这些是平台接口说明，不代表模型全部能力。价格以当前任务估算与最终结算为准。

## 其他型号：已证实与未证实范围

| 型号 | 可验证信息／边界 | 一手来源 |
|---|---|---|
| Seedance 2.0 | 多模态输入，最多 9 图／3 视频／3 音频；TapNow 的入口限制另外核验 | [Seed 官方](https://seed.bytedance.com/en/blog/seedance-2-0-official-launch) |
| Seedance 2.0 Mini／Fast | TapNow 官方活动页证实两个独立型号；活动已结束，不能据此声称仍享无限额度。具体能力不套用普通版 | [TapNow](https://docs.tapnow.ai/en/docs/account/creative-os-creation-festival) |
| Seedance 2.5 | 官方单次最长 30 秒并支持延长；单次时长和延长总长分开记录 | [Seed 官方](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5) |
| Gemini Omni 1.1 Flash | 官方列首尾帧、视频参考、360p 草稿、720p，以及 1080p／4K 超分；累计延长 40 秒不等于单次 40 秒 | [Google 官方](https://blog.google/innovation-and-ai/technology/developers-tools/build-with-gemini-omni-1-1-flash/) |
| Gemini Omni Flash／无 Flash 后缀名称 | 不自动当成 1.1 Flash 简称；型号关系及 TapNow 规格未充分核实 | 当前 UI 完整名称优先 |
| HappyHorse 1.0 | 官方目录列文生、首帧、参考图、编辑；720P／1080P，3—15 秒；首帧不等于首尾帧 | [阿里云官方](https://www.alibabacloud.com/help/en/model-studio/video-generate-edit-model) |
| HappyHorse 1.1 | 官方目录列文生、首帧、参考图；480P／720P／1080P，3—15 秒；不能自动继承 1.0 的编辑入口 | [阿里云官方](https://www.alibabacloud.com/help/en/model-studio/video-generate-edit-model) |

## 扩充规则

新增型号时记录：完整名称、任务模式、输入数量与角色、音频、单次时长、延长上限、分辨率、原生或超分、来源和日期。公开资料缺项写“未验证”，不根据 Pro／Max 等命名猜测能力，也不把菜单宣传徽标当作所有模式的共同规格。
