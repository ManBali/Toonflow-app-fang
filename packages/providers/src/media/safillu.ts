const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

const apiUrl = "https://api.safillu.com/tfrouter-frames/v1";

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
  const response = await context.tool.fetch(`${apiUrl}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Safillu 请求失败（HTTP ${response.status}）`);
  return object(await response.json());
}

function mediaUrl(input: MediaInput) {
  if (input.type === "url") {
    if (!/^https?:\/\//i.test(input.url)) throw new Error("参考媒体需要 HTTP 或 HTTPS 地址");
    return input.url;
  }
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

// ACT: Safillu 接口限制——参考文件解码后单个 30 MiB、合计 64 MiB、合计 4 个；提交前本地拦截，避免无意义请求。
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
  if (inputs.length > 4) throw new Error("Safillu 参考文件合计不能超过 4 个");
}

function mediaAsset(value: unknown): MediaAsset[] {
  if (typeof value !== "string" || !value.trim()) throw new Error("Safillu 未返回生成结果");
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) return [{ mediaType: "video", type: "url", url }];
  const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!data || !data[1].startsWith("video/")) throw new Error("Safillu 返回的媒体地址无效");
  return [{ mediaType: "video", type: "base64", mimeType: data[1], data: data[2] }];
}

function wait(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 3000);
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
    await wait(signal);
  }
}

export default {
  id: "safillu",
  label: "Safillu",
  version: "2.0.0",
  readme: "Safillu 视频生成（api.safillu.com）：当前提供 MiniMax-H3，4–15 秒、768p/2k，生成音轨。混合参考：图 ≤3、音频 ≤1、视频 ≤1，合计 ≤4；首尾帧模式需同时提供首帧与尾帧。参考文件解码后单个 ≤30 MiB、合计 ≤64 MiB。生成结果为上游地址，非永久存储，请及时使用。",
  rules,
  models: [
    {
      id: "MiniMax-H3",
      label: "MiniMax-H3",
      type: "video",
      mode: ["text", "startEndRequired", ["imageReference:3", "audioReference:1", "videoReference:1"]],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["768p", "2k"] }],
      audio: true,
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
    const frameImages = frames.length ? frames : images.map((url, index) => ({ url, role: index === 0 ? "first_frame" : "last_frame" }));
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
        ...(typeof request.generateAudio === "boolean" ? { generate_audio: request.generateAudio } : {}),
        ratio: request.ratio ?? "16:9",
        references,
        resolution: request.resolution,
      },
    });
  },
  async getPendingTask(request: { mediaType: "image" | "video" | "audio"; taskICode: string }): Promise<MediaAsset[]> {
    if (request.mediaType !== "video") throw new Error("Safillu 暂不支持此媒体类型的任务恢复");
    const files = await taskState(this, request.taskICode);
    return files ?? [];
  },
} satisfies ProviderDefinition<typeof rules>;
