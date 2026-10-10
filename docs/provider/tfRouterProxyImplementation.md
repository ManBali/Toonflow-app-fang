# 代理站实现文档（图片生成 / LLM / MiniMax-H3 接入）

本文档是 [tfRouterIntegration.md](tfRouterIntegration.md) 的实现侧配套：假设你运营一个 OpenAI 兼容的 API 代理站（聚合上游模型、令牌计费、`/v1/chat/completions` 等），要让它成为 Toonflow 的供应商。协议规范以对接文档为准，本文只讲代理站怎么落地。

## 1. 架构与路线选择

```
Toonflow 服务端 ──媒体协议(4端点)──▶ 代理站「tfRouter 兼容层」──▶ 上游(方舟/MiniMax/OpenAI...)
                ──OpenAI协议(LLM)──▶ 代理站现有 /v1/chat/completions ──▶ 上游
```

两条路线：

| 路线 | 做法 | 适用 |
| --- | --- | --- |
| A（推荐） | 代理站新增 tfRouter 兼容层：实现 `image/generateImage`、`image/getImageStatus`、`video/generateVideo`、`video/getVideoStatus` 4 个端点（+ 可选 `/models?type=video`）；Toonflow 侧上传改了 `apiUrl` 的 tfRouter.ts 副本 | 代理站可开发；一次接入，图片/视频全覆盖，模型清单可自动拉取 |
| B | 代理站零改动；Toonflow 侧写一个新的自定义供应商 `.ts`，直接调用代理站现有的 OpenAI 兼容端点（图片 `/v1/images/generations` 等） | 代理站不可改/不想改；但视频两段式仍需在 `.ts` 里等待或轮询上游，且模型清单要手写进 `.ts` 字面量 |

LLM 两条路线都一样：代理站现有 `/v1/chat/completions` + `/v1/models` 已经满足协议，Toonflow 里添加自定义语言供应商即可。

路线 A 的关键组件是**异步任务层**：Toonflow 的媒体协议天然两段式（提交拿 taskICode → 轮询），代理站需要一个任务表：

```json
{
  "taskICode": "img-20261006-a1b2c3",      // 代理站生成，全局唯一
  "kind": "image" | "video",
  "model": "MiniMax-H3",
  "request": { ... 原始请求体 ... },
  "upstreamTaskId": "mm-xxxx",             // 上游任务 ID（如有）
  "status": "pending" | "running" | "success" | "failed",
  "resultUrl": "https://...",              // 成功后填
  "failReason": "...",                     // 失败后填
  "createdAt": "..."
}
```

- 提交端点：校验 Bearer 令牌 → 记账/预扣费 → 创建任务 → **立即**返回 `{ "data": "<taskICode>" }`，上游调用放后台执行。
- 查询端点：按 `taskICode` 查任务表 → 映射状态 → 返回。
- **任务必须持久化 48 小时以上**：Toonflow 进程中断后重启，只会拿旧 taskICode 来查结果、绝不重新提交（避免重复计费），查询窗口为任务创建后 60 秒 ~ 48 小时。

## 2. 图片生成实现

Toonflow 发来的请求（模型分支决定 metadata 形态）：

```json
{ "model": "doubao-seedream-5.0-Pro", "prompt": "...", "size": "2k",
  "images": ["data:image/png;base64,..."],
  "metadata": { "response_format": "url", "aspectRatio": "16:9",
    "sequential_image_generation": "disabled", "stream": false, "watermark": false } }
```

上游映射：

| 上游 | 映射要点 |
| --- | --- |
| 豆包 Seedream（火山方舟 images API） | `metadata` 各键即方舟参数，平铺后透传；`size`("2k") + `aspectRatio`("16:9") 换算为方舟像素尺寸（如 2K/16:9 → 2560x1440 或方舟支持的档位）；参考图 `images[]` 传给 `image` 参数（base64 或 URL 均可） |
| GPT Image（OpenAI `/v1/images/generations`） | `{ model, prompt, size }`；`metadata.aspectRatio` + `size` 换算成 OpenAI size 档位（如 1536x1024）；参考图走 images/edits 或多图模型时按上游能力映射 |
| 其他聚合模型 | 至少消费 `prompt`；`images`/`aspectRatio` 能力不具备时忽略 |

实现建议：

1. 代理站内部把 `size + aspectRatio` 统一换算为目标像素，不要把 `"2k"` 字符串原样丢给不认识它的上游。
2. Toonflow 传来的参考图可能是 base64 data URL，上游要 URL 时需落临时存储换 URL，反之亦然。
3. 上游出图后：取图片 URL（或 b64）→ 存入代理站自己的对象存储 → 把**代理站自己的 URL** 写进任务表 `resultUrl`。不要直接透传上游的带签名/时效 URL（可能早于 Toonflow 的 48h 恢复窗口过期，或被防盗链拦截——Toonflow 下载结果是服务端直连，无 Referer）。
4. 查询响应按状态返回：
   - 进行中：`{ "status": "pending", "data": {} }`
   - 成功：`{ "status": "success", "data": { "data": "https://your-cdn/xxx.png" } }`
   - 失败：`{ "status": "failed", "data": { "failReason": "上游返回内容违规" } }`
5. 单文件结果 ≤ 100MB（Toonflow 下载上限），否则 Toonflow 判失败。base64 返回也可，但 URL + 自己的 CDN 更稳。

## 3. LLM 实现

代理站现有 OpenAI 兼容能力基本直接可用，核对三点：

1. `GET /v1/models`：Toonflow 用它拉模型清单。响应尽量带 `display_name`、`inputTokenLimit`、`outputTokenLimit`——模型上下文窗口优先取 `inputTokenLimit`，缺失则回退 Toonflow 硬编码限量表（认识 GPT/Claude/Qwen/GLM/Kimi/Doubao 等常见 id），再缺失默认 262144。给不准的 limit 不如不给。
2. `POST /v1/chat/completions`：Toonflow 固定 `stream: true`（SSE）。确保流式块格式标准（`choices[].delta.content`、usage 在最后一块或 `stream_options.include_usage`）。
3. 多模态消息：Toonflow 会把参考媒体注入第一条 user 消息——图片是标准 `image_url`（data URL），**视频是非标 `video_url` 字段**。上游不支持时剥离该字段即可，不要报错。

另外：`/v1/responses`（openai-responses 协议）或 Anthropic `/v1/messages` 只在用户把 `protocol` 配成对应值时才会被调用，选 `openai-completions` 则无需实现。

## 4. MiniMax-H3 接入实现

H3 在 Toonflow 侧的模型定义（写进 `.ts` 的 models 或由 `/models?type=video` 返回）：

```ts
{ id: "MiniMax-H3", label: "MiniMax-H3", type: "video",
  mode: ["text", "startFrameOptional", ["imageReference:9", "audioReference:3"]],
  durationResolutionMap: [{ duration: [4,5,6,7,8,9,10,11,12,13,14,15], resolution: ["480p","768p"] }],
  audio: true }
```

Toonflow 发来的提交请求（默认分支 metadata）：

```json
{ "model": "MiniMax-H3", "prompt": "...", "duration": 10, "resolution": "768p",
  "metadata": { "generate_audio": true, "ratio": "16:9", "resolution": "768p",
    "references": [ { "role": "reference_image", "type": "image_url", "image_url": { "url": "..." } } ] } }
```

映射到 MiniMax 原生两段式（`POST {base}/v2/video_generation`，参考仓库内 `packages/providers/src/media/meta.ts` 的成熟实现）：

| Toonflow 请求 | MiniMax 原生请求 |
| --- | --- |
| `model` | `model` |
| `prompt` | `content[0] = { "type": "text", "text": prompt }` |
| `duration` / `resolution` / `ratio`(metadata.ratio) | `duration` / `resolution` / `ratio`（顶层字段；注意 Toonflow 是小写 `768p`，MiniMax 文档用大写 `768P` 需转） |
| `metadata.generate_audio` | MiniMax H3 默认生成音频；无对应开关时忽略 |
| `references[]` | 逐项追加进 `content[]`：`reference_image` → `{ "role": "reference_image", "type": "image_url", "image_url": { "url": ... } }`；`first_frame` → `{ "role": "first_frame", ... }`；参考音频/视频按 MiniMax 对应 role（H3 支持图 ≤9、音频 ≤3，不支持参考视频，`videoReference` 不会被发来） |
| 参考媒体为 base64 时 | MiniMax 接受 base64 或 URL，可直接透传 |

提交响应 `{ "task_id": "..." }` → 代理站记入任务表 → 立即给 Toonflow 返回 `{ "data": "<taskICode>" }`。

后台轮询上游：`GET {base}/v2/query/video_generation/{task_id}`（Bearer），建议 5 秒间隔、10 分钟上限；响应 `{ "task": { "status": "succeeded"|"failed", "content": { "url": "..." } } }`。状态映射回 Toonflow 查询端点：

- `Queueing`/`Processing` 等中间态 → `{ "status": "pending", "data": {} }`
- `succeeded` → 下载/转存 `content.url` 到代理站存储 → `{ "status": "success", "data": { "data": "<代理站URL>" } }`
- `failed` → `{ "status": "failed", "data": { "failReason": "<task.status_message>" } }`

Seedance / wan 的接入同理，只是上游换成对应厂商的异步任务接口，metadata 键名按各自文档映射（kling/grok 的 metadata 分支见对接文档 2.3 节）。

## 5. 通用注意事项

1. **隐式失败判定**：Toonflow 对每个 HTTP 200 响应都检查 `status/state ∈ {failed,failure,error,rejected}`、`success === false`、数值 `code ∈ [400,600)`。你的成功响应里不要出现这些形态（尤其别用 `{ "success": true, "code": 200 }` 之外再塞一个业务 `code: 4xx`）。真正的失败直接用 HTTP 4xx/5xx + JSON 错误体更干净。
2. **鉴权**：所有端点统一 `Authorization: Bearer <代理站令牌>`，Toonflow 用户把令牌填进 apiKey。
3. **计费**：媒体端点按次数/模型计费（对齐你的价目表）。Toonflow 不读取价格，预扣费后任务失败记得退款。
4. **超时预算**：Toonflow 整体 30 分钟超时、3 秒轮询。视频上游超过 25 分钟未完成的，建议主动判失败并给 failReason，避免用户挂 30 分钟白等。
5. **结果 URL**：必须公网可直连下载（Toonflow 服务端下载，无浏览器环境）、http/https、≤100MB。转存到自有存储最稳。
6. **无需实现**：余额/充值/订单（`/v1/balance`、`/v1/recharge/*`）是官方平台专属 UI，Toonflow 只对 `api.toonflow.net` 显示；CORS 也不用配（全部服务端调用）。

## 6. 验证清单

1. curl 模拟完整序列：提交图片/视频 → 返回 `{ "data": "<id>" }` → 轮询 pending → success/failed 三态各验一次。
2. 参考图用 base64 data URL 传一次、公网 URL 传一次（Toonflow 两种都会发）。
3. 用 Toonflow 供应商调试台实测：`POST /api/providers/debug/inspect` 静态检查 `.ts`；`POST /api/providers/debug/run` 以 NDJSON 流回显每一次请求/响应（脱敏后），是验收协议实现的最直接手段。
4. Toonflow 画布实测：视频/图片节点选代理站供应商模型 → 生成 → 确认结果写入工作区 `assets/generated/`。
5. 断电恢复验证：生成中途重启 Toonflow，确认 60 秒后自动恢复——代理站应能按旧 taskICode 返回最终结果（任务未过期时），且不会收到重复的提交请求。
