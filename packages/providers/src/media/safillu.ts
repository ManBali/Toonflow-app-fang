const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

const siteUrl = "https://api.safillu.com";
const videoApiUrl = `${siteUrl}/tfrouter-frames/v1`;
const imageApiUrl = `${siteUrl}/runninghub-image/v1`;
const audioApiUrl = `${siteUrl}/runninghub-audio/v1`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Safillu 响应格式错误");
  return value as Record<string, unknown>;
}

async function fetchJson(context: ProviderContext, path: string, body?: unknown, signal = context.signal) {
  const apiKey =
    typeof context.config.apiKey === "string"
      ? context.config.apiKey
          .trim()
          .replace(/^Bearer\s+/i, "")
          .trim()
      : "";
  if (!apiKey) throw new Error("请填写 Safillu API Key");
  signal?.throwIfAborted();
  const response = await context.tool.fetch(`${videoApiUrl}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) await responseError(context, response, "Safillu 请求失败");
  return object(await response.json());
}

/** 带 failReason 的插件错误也走 HTTP 200，但鉴权/网关错误体各异，非 2xx 时尽力附上响应正文。 */
async function responseError(context: ProviderContext, response: Response, label: string): Promise<never> {
  const body = await response.text().catch(() => "");
  let detail = "";
  if (body) {
    try { detail = context.tool.errorMessage(JSON.parse(body)); } catch { detail = body.slice(0, 200); }
  }
  throw new Error(`${label}（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
}

function mediaUrl(input: MediaInput) {
  if (input.type === "url") {
    if (!/^https?:\/\//i.test(input.url)) throw new Error("参考媒体需要 HTTP 或 HTTPS 地址");
    return input.url;
  }
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

// ACT: Safillu 接口限制——参考文件解码后单个 30 MiB、合计 64 MiB、合计 13 个（9 图 + 3 音频 + 1 视频）；提交前本地拦截，避免无意义请求。
function checkReferences(inputs: MediaInput[]) {
  let total = 0;
  for (const input of inputs) {
    const bytes = input.type === "binary" ? input.data.byteLength
      : input.type === "base64" ? Math.floor((input.data.startsWith("data:") ? input.data.slice(input.data.indexOf(",") + 1) : input.data).length * 3 / 4)
      : 0;
    total += bytes;
    if (bytes > 30 * 1024 * 1024) throw new Error("Safillu 参考文件解码后单个不能超过 30 MiB");
  }
  if (total > 64 * 1024 * 1024) throw new Error("Safillu 参考文件解码后合计不能超过 64 MiB");
  if (inputs.length > 13) throw new Error("Safillu 参考文件合计不能超过 13 个");
}

function mediaAsset(value: unknown): MediaAsset[] {
  if (typeof value !== "string" || !value.trim()) throw new Error("Safillu 未返回生成结果");
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) return [{ mediaType: "video", type: "url", url }];
  const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!data || !data[1].startsWith("video/")) throw new Error("Safillu 返回的媒体地址无效");
  return [{ mediaType: "video", type: "base64", mimeType: data[1], data: data[2] }];
}

function wait(signal: AbortSignal, interval = 3000) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, interval);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function taskState(context: ProviderContext, taskICode: string, signal?: AbortSignal): Promise<MediaAsset[] | null> {
  const result = await fetchJson(context, "video/getVideoStatus", { taskICode }, signal);
  const data = result.data == null ? {} : object(result.data);
  const status = String(result.status ?? data.status ?? "").toLowerCase();
  if (status === "success" || status === "completed") return mediaAsset(data.data);
  if (status === "failed" || status === "failure") {
    throw new Error(context.tool.errorMessage?.(result) || (typeof data.failReason === "string" ? data.failReason : "视频生成失败"));
  }
  return null;
}

async function generateTask(context: ProviderContext, body: unknown) {
  // ACT: 单次生成最多等待 30 分钟；任务 ID 在提交后立即上报宿主落盘，进程中断后可由宿主按 ID 恢复结果。
  const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(context.signal ? [context.signal] : [])]);
  const task = await fetchJson(context, "video/generateVideo", body, signal);
  if (typeof task.data !== "string" || !task.data.trim()) throw new Error("Safillu 未返回任务 ID");
  try { context.tool.reportTask?.({ mediaType: "video", taskICode: task.data }); } catch { /* ACT: 上报失败不影响生成本身。 */ }
  while (true) {
    const files = await taskState(context, task.data, signal);
    if (files) return files;
    // 官方文档建议每 10–15 秒查询一次，过频可能触发限流。
    await wait(signal, 10_000);
  }
}

/** 查询一次 Z-Image 图片任务：成功返回图片地址数组，失败抛错，null 表示仍在进行中。 */
async function imageTaskState(context: ProviderContext, taskICode: string, signal?: AbortSignal): Promise<MediaAsset[] | null> {
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) throw new Error("请填写 Safillu API Key");
  signal?.throwIfAborted();
  const response = await context.tool.fetch(`${imageApiUrl}/tasks/${encodeURIComponent(taskICode)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new Error(`查询任务失败：HTTP ${response.status}`);
  const data = object(await response.json());
  const status = typeof data.status === "string" ? data.status : "";
  if (status === "success") {
    const items = Array.isArray(data.data) ? data.data : [];
    const assets = items
      .map(item => (typeof object(item).url === "string" ? String(object(item).url).trim() : ""))
      .filter((url): url is string => !!url)
      .map(url => ({ mediaType: "image" as const, type: "url" as const, url }));
    if (!assets.length) throw new Error("任务成功但未返回图片地址");
    return assets;
  }
  if (status === "failed") {
    throw new Error((typeof data.error === "string" && data.error) || context.tool.errorMessage?.(data) || "图片生成失败");
  }
  return null;
}

async function generateImageTask(context: ProviderContext, body: unknown) {
  // ACT: Z-Image 出图通常数十秒，仍按 30 分钟兜底等待。
  const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(context.signal ? [context.signal] : [])]);
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) throw new Error("请填写 Safillu API Key");
  const submitResponse = await context.tool.fetch(`${imageApiUrl}/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!submitResponse.ok) throw new Error(`提交任务失败：HTTP ${submitResponse.status}`);
  const submitData = object(await submitResponse.json());
  const taskId = typeof submitData.task_id === "string" && submitData.task_id.trim() ? submitData.task_id.trim() : "";
  if (!taskId) throw new Error("提交任务未返回任务 ID");
  try { context.tool.reportTask?.({ mediaType: "image", taskICode: taskId }); } catch { /* ACT: 上报失败不影响生成本身。 */ }
  while (true) {
    const files = await imageTaskState(context, taskId, signal);
    if (files) return files;
    await wait(signal);
  }
}

/** 查询一次音频任务（音色设计 / BGM 共用）：成功返回音频地址，失败抛错，null 表示仍在进行中。 */
async function audioTaskState(context: ProviderContext, taskICode: string, signal?: AbortSignal): Promise<MediaAsset[] | null> {
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) throw new Error("请填写 Safillu API Key");
  signal?.throwIfAborted();
  const response = await context.tool.fetch(`${audioApiUrl}/tasks/${encodeURIComponent(taskICode)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new Error(`查询任务失败：HTTP ${response.status}`);
  const data = object(await response.json());
  const status = typeof data.status === "string" ? data.status : "";
  if (status === "success") {
    const url = typeof data.audio_url === "string" && data.audio_url.trim() ? data.audio_url.trim() : "";
    if (!url) throw new Error("任务成功但未返回音频地址");
    return [{ mediaType: "audio", type: "url", url }];
  }
  if (status === "failed") {
    throw new Error((typeof data.error === "string" && data.error) || context.tool.errorMessage?.(data) || "音频生成失败");
  }
  return null;
}

async function generateAudioTask(context: ProviderContext, path: string, body: unknown) {
  // ACT: 音频任务按 30 分钟兜底等待；任务 ID 提交后上报宿主落盘，中断后可按 ID 恢复。
  const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(context.signal ? [context.signal] : [])]);
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) throw new Error("请填写 Safillu API Key");
  const submitResponse = await context.tool.fetch(`${audioApiUrl}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!submitResponse.ok) throw new Error(`提交任务失败：HTTP ${submitResponse.status}`);
  const submitData = object(await submitResponse.json());
  const taskId = typeof submitData.task_id === "string" && submitData.task_id.trim() ? submitData.task_id.trim() : "";
  if (!taskId) throw new Error("提交任务未返回任务 ID");
  try { context.tool.reportTask?.({ mediaType: "audio", taskICode: taskId }); } catch { /* ACT: 上报失败不影响生成本身。 */ }
  while (true) {
    const files = await audioTaskState(context, taskId, signal);
    if (files) return files;
    await wait(signal);
  }
}

export default {
  id: "safillu",
  label: "Safillu",
  version: "2.1.0",
  readme: "Safillu（api.safillu.com）：MiniMax-H3 视频生成，4–15 秒、480p/768p/1080p/2k 四档，生成音轨；混合参考图 ≤9、音频 ≤3、视频 ≤1，合计 ≤13；首尾帧模式需同时提供首帧与尾帧（不能混用参考媒体），四档分辨率均可用，画幅默认 adaptive。Z-Image 纯文生图，1K/2K 同价，不支持参考图。参考文件解码后单个 ≤30 MiB、合计 ≤64 MiB。生成结果为公开直链，非永久存储，请及时使用。",
  rules,
  models: [
    {
      id: "MiniMax-H3",
      label: "MiniMax-H3",
      type: "video",
      mode: ["text", "startEndRequired", ["imageReference:9", "audioReference:3", "videoReference:1"]],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "768p", "1080p", "2k"] }],
      audio: true,
    },
    {
      id: "Z-Image-Base",
      label: "Z-Image 文生图",
      type: "image",
      mode: ["text"],
      imageSizes: ["1K", "2K"],
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
    },
    {
      id: "Qwen3-TTS-VoiceDesign",
      label: "音色设计语音",
      type: "audio",
    },
    {
      id: "YuE2-BGM",
      label: "BGM 纯音乐",
      type: "audio",
    },
  ] satisfies ProviderModel[],
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    checkReferences([request.firstFrame, request.lastFrame, ...(request.images ?? []), ...(request.videos ?? []), ...(request.audios ?? [])].filter((item): item is MediaInput => !!item));
    const images = (request.images ?? []).map(mediaUrl);
    const videos = (request.videos ?? []).map(mediaUrl);
    const audios = (request.audios ?? []).map(mediaUrl);
    const frames = [
      ...(request.firstFrame ? [{ url: mediaUrl(request.firstFrame), role: "first_frame" }] : []),
      ...(request.lastFrame ? [{ url: mediaUrl(request.lastFrame), role: "last_frame" }] : []),
    ];
    const mode = request.mode ?? (frames.length ? "startEndRequired" : audios.length ? [] : images.length ? "singleImage" : "text");
    const isFrames = mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional";
    // 首尾帧默认 adaptive 跟随首帧比例；文生/参考模式固定 16:9 且服务端拒收 adaptive。
    const ratio = request.ratio ?? (isFrames ? "adaptive" : "16:9");
    if (!isFrames && ratio === "adaptive") throw new Error("Safillu 文生/参考模式不支持 adaptive 画幅");
    const frameImages = frames.length ? frames : images.map((url, index) => ({ url, role: index === 0 ? "first_frame" : "last_frame" }));
    // 首尾帧必须恰好一首一尾共 2 张，不能只传一帧，也不能混入参考媒体。
    if (isFrames && frameImages.length !== 2) throw new Error("Safillu 首尾帧模式需要同时提供首帧与尾帧");
    const references: Record<string, unknown>[] = [];
    if (Array.isArray(mode)) {
      references.push(...images.map((url) => ({ role: "reference_image", type: "image_url", image_url: { url } })));
      references.push(...videos.map((url) => ({ role: "reference_video", type: "video_url", video_url: { url } })));
      references.push(...audios.map((url) => ({ role: "reference_audio", type: "audio_url", audio_url: { url } })));
    } else if (isFrames) {
      references.push(...frameImages.map(({ url, role }) => ({ role, type: "image_url", image_url: { url } })));
    } else if (mode === "singleImage") {
      references.push(...images.map((url) => ({ role: "reference_image", type: "image_url", image_url: { url } })));
    }
    return generateTask(this, {
      model: request.model,
      prompt: request.prompt,
      duration: request.duration,
      resolution: request.resolution,
      metadata: {
        // generate_audio 只能传 true 或省略，不支持 false。
        ...(request.generateAudio === true ? { generate_audio: true } : {}),
        ratio,
        references,
        resolution: request.resolution,
      },
    });
  },
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = typeof this.config.apiKey === "string" && this.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim()
      ? this.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim()
      : "";
    if (!apiKey) throw new Error("请填写 Safillu API Key");
    const resolution = String(request.size ?? "1K").toUpperCase();
    if (resolution !== "1K" && resolution !== "2K") throw new Error(`Z-Image 仅支持 1K / 2K 档位，收到：${request.size}`);
    const ratio = request.ratio ?? "1:1";
    return generateImageTask(this, {
      model: request.model,
      prompt: request.prompt,
      ratio,
      resolution,
    });
  },
  async generateAudio(request: AudioRequest): Promise<MediaAsset[]> {
    const isVoice = request.model.toLowerCase().includes("voicedesign");
    const text = request.text.trim();
    if (isVoice) {
      const voicePrompt = request.voice?.trim() ?? "";
      if (!voicePrompt) throw new Error("音色设计需要填写音色描述（角色声线、语气与风格）");
      return generateAudioTask(this, "voice-design", {
        model: request.model,
        text,
        voice_prompt: voicePrompt,
        ...(typeof request.speed === "number" ? { speed: request.speed } : {}),
      });
    }
    return generateAudioTask(this, "bgm", {
      model: request.model,
      prompt: text,
      ...(typeof request.duration === "number" ? { duration: request.duration } : {}),
    });
  },
  async getPendingTask(request: { mediaType: "image" | "video" | "audio"; taskICode: string }): Promise<MediaAsset[]> {
    if (request.mediaType === "video") {
      const files = await taskState(this, request.taskICode);
      return files ?? [];
    }
    if (request.mediaType === "image") {
      const files = await imageTaskState(this, request.taskICode);
      return files ?? [];
    }
    if (request.mediaType === "audio") {
      const files = await audioTaskState(this, request.taskICode);
      return files ?? [];
    }
    throw new Error("Safillu 暂不支持此媒体类型的任务恢复");
  },
} satisfies ProviderDefinition<typeof rules>;
