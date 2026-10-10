# Toonflow 供应商对接文档（tfRouter 协议规范）

本文档面向第三方代理站/网关：说明如何成为与内置 `tfRouter` 同类的 Toonflow 供应商。协议细节全部来自当前仓库源码（`packages/providers/src/media/tfRouter.ts`、`packages/providers/src/language/tfRouter.ts`、`apps/server/src/utils/media/provider.ts`、`apps/server/src/utils/media/generation.ts`、`apps/server/src/utils/ai/`）。

## 0. 总览：供应商有两种类型

| 类型 | 接入形态 | 需要实现什么 |
| --- | --- | --- |
| 语言供应商（LLM） | 纯配置（无需代码） | OpenAI 兼容的 `GET /v1/models` + `POST /v1/chat/completions`（SSE） |
| 媒体供应商（图片/视频） | 一个 `.ts` 适配文件（导出对象字面量） | 自定义「提交 + 轮询」协议的 4 个 HTTP 端点，可选模型清单端点 |

要点：

- 所有 HTTP 请求都由 **Toonflow 服务端**发起（Bun 运行时），代理站无需处理浏览器 CORS。
- 鉴权统一为请求头 `Authorization: Bearer <apiKey>`；apiKey 由用户在 Toonflow 设置里填，保存于 `settings.mediaProviderConfigs.<providerId>.apiKey`（媒体）或 `settings.customProviders[].apiKey`（语言）。
- 参考图片/视频/音频到达代理站时已是 **http(s) URL 或 `data:<mime>;base64,<...>` 字符串**；代理站生成的结果也必须以这两种形式之一返回（结果 URL 须公网可下载，单文件 ≤ 100MB）。

---

## 1. 语言供应商协议（LLM）

语言供应商在 Toonflow 里只是一份配置：`{ id, label, apiUrl, protocol, apiKey, models }`，实际调用由服务端按 `protocol` 发出。第三方代理站选 `protocol: "openai-completions"` 即可，需要实现：

### 1.1 模型清单：`GET {apiUrl}/models`

- 请求头：有 apiKey 时带 `Authorization: Bearer <key>`；30 秒超时。
- 请求路径：用户填的 `apiUrl` 若以 `/` 结尾会自动补 `/v1`；填 `https://proxy.example.com/v1` 则直接请求 `https://proxy.example.com/v1/models`。
- 响应格式：

```json
{
  "data": [
    { "id": "deepseek-v4.1-flash", "display_name": "DeepSeek V4.1 Flash",
      "inputTokenLimit": 1048576, "outputTokenLimit": 393216 }
  ]
}
```

- 字段映射：`label = display_name ?? displayName ?? id`；`contextWindow = inputTokenLimit`；`maxOutputTokens = outputTokenLimit`。后两个是可选项，缺失时回退 Toonflow 内置限量表或默认值（262144 / 32768）。

### 1.2 对话补全：`POST {apiUrl}/chat/completions`

- 标准 OpenAI Chat Completions 协议：`Authorization: Bearer <key>`，请求带 `stream: true`，以 **SSE**（`data: {...}\n\n`，终止 `data: [DONE]`）返回。
- Toonflow 会把参考媒体注入消息：图片为 `{ "type": "image_url", "image_url": { "url": "data:..." } }`；视频为扩展字段 `{ "type": "video_url", "video_url": { "url": "..." } }`，追加在第一条 user 消息上。上游不支持 `video_url` 时应剥离或转换，不要因此报 4xx。
- 代理站若已是 OpenAI 兼容聚合网关，本节**通常零开发**（透传即可）。

---

## 2. 媒体供应商协议（图片 / 视频）

媒体协议是自定义的两段式：**提交任务 → 拿任务 ID → 轮询查询**。Toonflow 侧由 `media/tfRouter.ts` 发起；第三方代理站通过「添加自定义媒体供应商」上传一份改了 `apiUrl` 的 `.ts` 适配文件，HTTP 协议保持不变。

### 2.1 约定

- baseUrl：`.ts` 里的 `apiUrl` 常量（官方为 `https://api.toonflow.net/v1`；代理站可设为 `https://proxy.example.com/v1`）。
- 鉴权：`Authorization: Bearer <apiKey>`，`Content-Type: application/json`。
- 非 2xx 状态码直接判失败（错误正文会脱敏后展示给用户）。
- 提交成功后 Toonflow 立即上报任务落盘；进程中断后恢复时**只按任务 ID 查询结果、绝不重新提交**。因此代理站必须持久化任务（至少 48 小时内按任务 ID 可查）。

### 2.2 图片生成

**提交：`POST {baseUrl}/image/generateImage`**

请求体（Toonflow 发出的固定结构）：

```json
{
  "model": "doubao-seedream-5.0-Pro",
  "prompt": "提示词",
  "size": "2k",
  "images": ["https://... 或 data:image/png;base64,..."],
  "metadata": {
    "response_format": "url",
    "aspectRatio": "16:9",
    "sequential_image_generation": "disabled",
    "stream": false,
    "watermark": false
  }
}
```

- `images` 仅在有参考图（单图/多参考模式）时存在，元素为 URL 或 base64 data URL，最多 64 张。
- `size` 已被 Toonflow 转为小写（如 `1k`、`2k`、`4k`），缺省 `2k`。
- `metadata` 按模型名分支：模型 id 含 `doubao`/`seedream` 时如上（完整方舟参数）；含 `gpt` 或名为「全能图片」时仅 `{ "aspectRatio": "16:9" }`；其余模型同样仅 `aspectRatio`。`aspectRatio` 缺省 `16:9`。

响应（**必须**）：

```json
{ "data": "<任务ID字符串>" }
```

顶层 `data` 必须是非空字符串，否则 Toonflow 报「未返回任务 ID」。

**查询：`POST {baseUrl}/image/getImageStatus`**

请求体：`{ "taskICode": "<提交时返回的任务ID>" }`

响应：

```json
{ "status": "success", "data": { "data": "https://cdn.example.com/xxx.png" } }
```

- `status` 判定（大小写不敏感，取 `result.status`，缺省取 `result.data.status`）：
  - `success` / `completed` → 成功，结果取 `result.data.data`（必须为 http(s) URL 或 `data:image/...;base64,...`）；
  - `failed` / `failure` → 失败，错误文案取响应中的错误信息或 `result.data.failReason`；
  - 其他任意值（建议 `"pending"` 或 `"processing"`）→ 继续轮询。
- 轮询间隔固定 3 秒，总超时 30 分钟。

### 2.3 视频生成

**提交：`POST {baseUrl}/video/generateVideo`**

请求体：

```json
{
  "model": "MiniMax-H3",
  "prompt": "提示词",
  "duration": 10,
  "resolution": "768p",
  "metadata": {
    "generate_audio": true,
    "ratio": "16:9",
    "resolution": "768p",
    "references": [
      { "role": "reference_image", "type": "image_url", "image_url": { "url": "..." } }
    ]
  }
}
```

- `duration` 为秒数（number）；`resolution` 如 `480p`/`768p`/`1080p`。
- `generate_audio` 仅当用户开启时出现（布尔）。
- `references` 角色映射（默认分支，Seedance / wan / MiniMax-H3 等）：
  - 混合参考模式：`reference_image`（image_url）、`reference_video`（video_url）、`reference_audio`（audio_url），可以混排多张；
  - 首尾帧模式：`first_frame` / `last_frame`（image_url）；
  - 单图模式：单个 `reference_image`；
  - 纯文本模式：无 `references`。

可灵（kling）与 grok 分支的 `metadata` 结构不同，代理站若只做 MiniMax/Seedance/wan 可忽略；如需兼容：

- 模型 id 含 `kling`：`{ "aspect_ratio": "16:9", "sound": "on"|"off", "video_list": [{"video_url": "..."}], "image_list": [] }`（omni/o1 型号的 `image_list` 元素为 `{ "image_url": "...", "type": "first_frame"|"end_frame" }`，其他型号用 `image` / `image_tail` 表示首尾帧）。
- 模型 id 含 `grok`：`{ "aspectRatio": "16:9" }`。

响应（同图片）：`{ "data": "<任务ID字符串>" }`。

**查询：`POST {baseUrl}/video/getVideoStatus`**

请求 `{ "taskICode": "..." }`，响应结构与图片查询完全一致（`status` + `result.data.data` 为视频 URL 或 `data:video/...;base64,...`）。

### 2.4 状态机与隐式失败判定（重要坑点）

Toonflow 宿主对**每一次**响应（含提交）都会做隐式失败检查——即使 HTTP 200。满足任一条件即判失败：

- 顶层或 `data`/`task` 内的 `status` / `state` ∈ `{failed, failure, error, rejected}`；
- `success === false`；
- 数值型 `code` ∈ [400, 600)。

因此代理站的正常响应不要携带这些形态的字段（例如不要返回 `{"success": true, "code": 200, ...}` 之外的 `code: 4xx` 形态来表示业务成功）。

### 2.5 模型清单（可选但建议）

`.ts` 适配文件的 `modelsUrl` 指向 `GET {baseUrl}/models?type=video`，Toonflow 的「获取模型」按钮会调用它：

- 请求：`GET`，有 apiKey 时带 `Authorization: Bearer`；30 秒超时、禁止重定向。
- 响应：

```json
{
  "data": [
    { "id": "MiniMax-H3", "label": "MiniMax-H3", "type": "video" },
    { "id": "doubao-seedream-5.0-Pro", "label": "Doubao Seedream 5.0 Pro", "type": "image" }
  ]
}
```

- `type` 缺省时取 URL 的 `?type=` 参数或旧模型同名项的 type；`label` 回退 `display_name`/`displayName`/旧 label/`id`。刷新时按 type 整组替换旧模型。

### 2.6 Toonflow 侧的模型定义（`.ts` 文件内 `models` 字面量）

`models` 决定前端 UI 提供哪些参数，每个模型：

```ts
{
  id: "MiniMax-H3",              // 原样放入请求体的 model 字段
  label: "MiniMax-H3",           // 显示名
  type: "video",                 // "image" | "video" | "audio"
  mode: ["text", "startFrameOptional", ["imageReference:9", "audioReference:3"]],
  durationResolutionMap: [{ duration: [4,5,6,7,8,9,10,11,12,13,14,15], resolution: ["480p","768p"] }],
  audio: true                    // "optional" 显示声音开关；true 强制生成；缺省不生成
}
```

- 图片模型用 `imageSizes: ["1K","2K"]`、`imageRatios: ["16:9","9:16"]`、`mode: ["text","singleImage","multiReference"]`。
- `mode` 数值 `imageReference:n` 表示参考图上限 n。`mode` 同时决定 2.3 节的 `references` 角色映射。

常用内置模型参数参考（tfRouter）：

| 模型 id | type | 关键参数 |
| --- | --- | --- |
| `Seedance 2.5` | video | 图30/视频10/音频10；4–30s；480p/720p/1080p；audio optional |
| `Seedance 2.0`（fast/mini） | video | 图9/视频3/音频3；4–15s；480p/720p |
| `wan-3.0` | video | 图10/视频5/音频5；2–30s；480p/720p/1080p |
| `MiniMax-H3` | video | 图9/音频3；4–15s；480p/768p；audio 强制 |
| `doubao-seedream-5.0-Pro` | image | text/单图/多参考；1K–2K；16:9、9:16 |
| `doubao-seedream-5.0-Lite` | image | text/单图/多参考；2K–4K；16:9、9:16 |
| `全能图片G-2.5` / `G-2.0` | image | text/单图/多参考；1K–4K；8 种比例 |

---

## 3. Toonflow 侧接入步骤

### 3.1 媒体供应商（代理站实现自定义协议后）

1. 复制 `packages/providers/src/media/tfRouter.ts`，把 `apiUrl` 常量改为代理站地址（如 `https://proxy.example.com/v1`），`id`/`label` 改为自己的小驼峰 id（如 `myProxy`），按需修改 `models` 清单。
2. Toonflow → 设置 → 媒体模型 → 添加供应商 → **自定义**，上传该 `.ts`（≤ 1MB，必须 `export default` 纯对象字面量，`id/label/version/modelsUrl/models` 均为字面量）。
3. 填写 apiKey（保存到 `settings.mediaProviderConfigs.myProxy.apiKey`）。
4. 点「获取模型」触发 `modelsUrl` 拉取，或在编辑对话框手改模型清单。
5. 画布节点模型下拉选择该供应商的模型；模型字符串格式为 `JSON.stringify(["myProxy","<modelId>"])`。

### 3.2 语言供应商（纯配置，无需代码）

1. Toonflow → 设置 → 语言模型 → 添加自定义供应商。
2. 填 `id`、`label`、`apiUrl`（如 `https://proxy.example.com/v1`）、`protocol = openai-completions`、`apiKey`。
3. 点「获取模型列表」拉取 `/models`，勾选模型（或手动添加，含 `contextWindow`/`maxOutputTokens`）。
4. 保存后 Agent / 文本节点即可选用。

### 3.3 验证工具（供应商调试台）

Toonflow 服务端内置调试接口，可逐请求回显代理站交互：

- `POST /api/providers/debug/inspect`：对 `.ts` 源码做静态检查（结构/字面量/模型清单合法性）。
- `POST /api/providers/debug/run`：实际执行一次生成，以 NDJSON 流回显每次 fetch 的方法、URL、请求体、状态码、响应正文（脱敏，最多 200 次请求，总超时 30 分钟）——验证代理站协议实现的首选方式。

### 3.4 无需实现的部分

余额查询、充值套餐、支付、订单查询、插件市场（`/v1/balance`、`/v1/recharge/*` 等）是 TF-router 官方平台专属：仅当供应商 `apiUrl` 的 origin 为 `https://api.toonflow.net` 时 Toonflow 才展示官方账户组件。第三方代理站**不需要**实现这些端点。
