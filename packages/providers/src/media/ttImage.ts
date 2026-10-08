const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

const baseUrl = "https://api.lk888.ai";

// TT 平台 size 只接受「宽x高」像素值，不接受比例写法；按清晰度档位 × 比例映射到官方枚举。
const ratioSizes: Record<string, Record<string, string>> = {
  "1K": { "1:1": "1024x1024", "16:9": "1920x1088", "9:16": "1088x1920", "3:2": "1536x1024", "2:3": "1024x1536", "4:3": "1280x960", "3:4": "960x1280" },
  "2K": { "1:1": "2048x2048", "16:9": "2560x1440", "9:16": "1440x2560", "3:2": "3072x2048", "2:3": "2048x3072", "4:3": "2560x1920", "3:4": "1920x2560" },
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TT Image 2 响应格式错误");
  return value as Record<string, unknown>;
}

function mediaUrl(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

/** TT 响应可能是 {code, data, msg} 包裹或平铺结构，任务字段所在层做兼容。 */
function unwrap(response: Record<string, unknown>): Record<string, unknown> {
  const data = response.data;
  if (data && typeof data === "object" && !Array.isArray(data) && ("task_id" in data || "state" in data || "is_final" in data)) {
    return data as Record<string, unknown>;
  }
  return response;
}

function wait(signal: AbortSignal, ms: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** 查询一次任务状态：成功返回地址，失败返回错误文案，null 表示仍在进行中。 */
async function fetchTaskResult(context: ProviderContext, apiKey: string, taskId: string, signal?: AbortSignal): Promise<{ url: string } | { error: string } | null> {
  const response = await context.tool.fetch(`${baseUrl}/v1/media/status?task_id=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`查询任务失败：HTTP ${response.status}`);
  const data = unwrap(object(await response.json()));
  const state = typeof data.state === "string" ? data.state : "";
  if (state === "success") {
    const urls = typeof data.result_url === "string" ? [data.result_url] : Array.isArray(data.result_url) ? data.result_url : [];
    const url = urls.find((item): item is string => typeof item === "string" && item.trim() !== "");
    if (!url) throw new Error("任务成功但未返回结果地址");
    return { url };
  }
  if (state === "failed") {
    const reason = (typeof data.error === "string" && data.error) || context.tool.errorMessage?.(data) || "图片生成失败";
    return { error: reason };
  }
  return null;
}

export default {
  id: "ttImage",
  label: "TT Image 2",
  version: "2.0.0",
  readme: "TT Image 2 图片生成（api.lk888.ai）：文生图、图生图、多图参考合成，参考图最多 14 张；不支持透明底，实际输出像素以平台为准。",
  rules,
  models: [
    {
      id: "tt-image-2",
      label: "TT Image 2",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K"],
      imageRatios: ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"],
    },
  ] satisfies ProviderModel[],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const ratio = request.ratio ?? "16:9";
    const size = ratioSizes[(request.size ?? "2K").toUpperCase()]?.[ratio];
    if (!size) throw new Error(`TT Image 2 不支持此尺寸与比例组合：${request.size ?? "2K"} / ${ratio}`);

    const images = (request.images ?? []).map(mediaUrl);
    if (images.length > 14) throw new Error("TT Image 2 参考图最多 14 张");

    // ACT: 单次生成最多等待 30 分钟，TT 图片任务一般 20 秒到 2 分钟。
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const params: Record<string, unknown> = { size, quality: "auto", n: 1 };
    if (images.length) params.images = images;
    const submitResponse = await this.tool.fetch(`${baseUrl}/v1/media/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: request.model, prompt: request.prompt, params }),
      signal,
    });
    if (!submitResponse.ok) throw new Error(`提交任务失败：HTTP ${submitResponse.status}`);
    const submitData = unwrap(object(await submitResponse.json()));
    const taskId = submitData.task_id === undefined || submitData.task_id === null ? "" : String(submitData.task_id).trim();
    if (!taskId) throw new Error("提交任务未返回任务 ID");
    try { this.tool.reportTask?.({ mediaType: "image", taskICode: taskId }); } catch { /* ACT: 上报失败不影响生成本身。 */ }

    while (true) {
      const result = await fetchTaskResult(this, apiKey, taskId, signal);
      if (result) {
        if ("error" in result) throw new Error(result.error);
        return [{ mediaType: "image", type: "url", url: result.url }];
      }
      await wait(signal, 3000);
    }
  },
  async getPendingTask(request: { mediaType: "image" | "video" | "audio"; taskICode: string }): Promise<MediaAsset[]> {
    if (request.mediaType !== "image") throw new Error("TT Image 2 暂不支持此媒体类型的任务恢复");
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const result = await fetchTaskResult(this, apiKey, request.taskICode);
    if (!result) return [];
    if ("error" in result) throw new Error(result.error);
    return [{ mediaType: "image", type: "url", url: result.url }];
  },
} satisfies ProviderDefinition<typeof rules>;
