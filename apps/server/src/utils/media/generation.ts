import { t, translateMessage } from "@/lib/i18n";
import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, stat, unlink, writeFile } from "@toonflow/file";
import { dirname, join, relative } from "node:path";
import { mediaProviders, type Provider } from "@toonflow/providers";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel, MediaReference } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { getMediaProvider, listMediaProviders, loadMediaProviderSource } from "@/utils/media/provider";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";

const maxMediaSize = 100 * 1024 * 1024;
const mediaExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "audio/flac": "flac", "audio/aac": "aac", "audio/mp4": "m4a", "audio/opus": "opus", "audio/pcm": "pcm",
};

/** 已提交到供应商但尚未取回结果的异步任务；进程中断后由后台恢复流程按 ID 取回，避免已计费任务作废。 */
interface PendingMediaTask {
  taskICode: string;
  providerId: string;
  mediaType: "image" | "video" | "audio";
  cwd: string;
  outputDirectory: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "done" | "failed";
  error?: string;
}

const activeTaskCodes = new Set<string>();
let resuming = false;
let journalQueue: Promise<unknown> = Promise.resolve();

function journalFile() {
  return join(dirname(conf.path), "media-generation-tasks.json");
}

function readJournal(): PendingMediaTask[] {
  try {
    const parsed = JSON.parse(readFileSync(journalFile(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((item: unknown): item is PendingMediaTask =>
      !!item && typeof item === "object" && typeof (item as PendingMediaTask).taskICode === "string") : [];
  } catch { return []; }
}

function writeJournal(entries: PendingMediaTask[]) {
  // ACT: 串行化写盘，避免并发恢复与生成请求互相覆盖；写入失败只影响恢复能力，不阻断生成。
  journalQueue = journalQueue.then(() =>
    writeFile(journalFile(), JSON.stringify(entries, null, 2)).catch(() => {})).catch(() => {});
}

function updateJournalEntry(taskICode: string, patch: Partial<PendingMediaTask>, remove = false) {
  const entries = readJournal();
  const index = entries.findIndex(item => item.taskICode === taskICode);
  if (index < 0) return;
  if (remove) entries.splice(index, 1);
  else entries[index] = { ...entries[index], ...patch, updatedAt: new Date().toISOString() };
  writeJournal(entries);
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function imageOptions(value: unknown, pattern: RegExp) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 64 && item === item.trim() && pattern.test(item)))] : undefined;
}

export async function listMediaModels(): Promise<MediaModel[]> {
  const installedProviders = await listMediaProviders();
  return installedProviders.flatMap(provider => provider.models.flatMap(model => {
    if (model.type !== "image" && model.type !== "video" && model.type !== "audio") return [];
    const builtIn = (mediaProviders as readonly Provider[]).find(item => item.id === provider.id)?.models.find(item => item.id === model.id);
    return [{
      providerId: provider.id, providerLabel: provider.label, modelId: model.id, label: model.label, type: model.type,
      mode: model.mode, durationResolutionMap: model.durationResolutionMap, audio: model.audio,
      ...(model.type === "audio" ? { voices: model.voices } : {}),
      ...(model.type === "image" ? {
        imageSizes: imageOptions(Array.isArray(model.imageSizes) ? model.imageSizes : builtIn?.imageSizes, /^[^\u0000-\u001f\u007f]+$/),
        imageRatios: imageOptions(Array.isArray(model.imageRatios) ? model.imageRatios : builtIn?.imageRatios, /^[1-9]\d{0,3}:[1-9]\d{0,3}$/),
      } : {}),
    } as MediaModel];
  }));
}

function detectMimeType(bytes: Uint8Array, fallback: string) {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 16));
  const text = header.toString("ascii");
  const mimeType = fallback.split(";")[0].trim().toLowerCase();
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(text)) return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WAVE") return "audio/wav";
  if (text.startsWith("fLaC")) return "audio/flac";
  if (text.startsWith("OggS")) return mimeType.startsWith("video/") ? "video/ogg" : mimeType === "audio/opus" ? "audio/opus" : "audio/ogg";
  if (header[0] === 0xff && (header[1]! & 0xf6) === 0xf0) return "audio/aac";
  if (text.startsWith("ID3") || (header[0] === 0xff && (header[1]! & 0xe0) === 0xe0 && (header[1]! & 0x06) !== 0)) return "audio/mpeg";
  if (text.slice(4, 8) === "ftyp") {
    if (/avif|avis/.test(text.slice(8))) return "image/avif";
    if (/^M4[AB] $/.test(text.slice(8, 12)) || mimeType.startsWith("audio/")) return "audio/mp4";
    return text.slice(8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return mimeType.startsWith("audio/") ? "audio/webm" : "video/webm";
  return ({ "image/jpg": "image/jpeg", "audio/mp3": "audio/mpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-flac": "audio/flac" } as Record<string, string>)[mimeType] ?? mimeType;
}

export async function readReference(cwd: string, reference: MediaReference, mediaType: string, signal?: AbortSignal): Promise<Extract<MediaInput, { type: "base64" }>> {
  signal?.throwIfAborted();
  const { path } = await resolveWorkspacePath(cwd, reference.path);
  const info = await stat(path);
  if (!info.isFile() || info.size > maxMediaSize) invalid("参考媒体须为不超过 100 MB 的文件");
  const bytes = await readFile(path, { signal });
  if (!bytes.length || bytes.length > maxMediaSize) invalid("参考媒体为空或超过 100 MB");
  const mimeType = detectMimeType(bytes, reference.mimeType);
  if (!mimeType.startsWith(`${mediaType}/`)) invalid(t`参考媒体类型须为 ${mediaType}`);
  return { type: "base64", data: bytes.toString("base64"), mimeType };
}

async function downloadAsset(url: string, signal?: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) invalid("生成结果必须使用 HTTP 或 HTTPS 地址");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(t`下载生成结果失败（HTTP ${response.status}）`);
  if (Number(response.headers.get("content-length")) > maxMediaSize) {
    await response.body?.cancel();
    invalid("生成文件不能超过 100 MB");
  }
  const reader = response.body?.getReader();
  if (!reader) invalid("生成结果为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxMediaSize) invalid("生成文件不能超过 100 MB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { bytes: Buffer.concat(chunks, size), mimeType: response.headers.get("content-type") ?? "" };
}

async function assetBytes(asset: MediaAsset, mediaType: "image" | "video" | "audio", signal?: AbortSignal) {
  if (!asset || asset.mediaType !== mediaType) invalid("供应商返回的媒体类型不正确");
  let bytes: Uint8Array;
  let mimeType = asset.mimeType ?? "";
  if (asset.type === "url") {
    const result = await downloadAsset(asset.url, signal);
    bytes = result.bytes;
    mimeType = result.mimeType || mimeType;
  } else if (asset.type === "base64") {
    const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(asset.data);
    const content = (data?.[2] ?? asset.data).replace(/\s/g, "");
    if (content.length > Math.ceil(maxMediaSize / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) invalid("生成结果的 base64 内容无效或超过 100 MB");
    bytes = Buffer.from(content, "base64");
    mimeType = data?.[1] ?? mimeType;
  } else if (asset.type === "binary" && ArrayBuffer.isView(asset.data) && asset.data.BYTES_PER_ELEMENT === 1) {
    bytes = asset.data;
  } else { return invalid("供应商返回了无效的媒体结果"); }
  if (!bytes.byteLength || bytes.byteLength > maxMediaSize) invalid("生成文件为空或超过 100 MB");
  mimeType = detectMimeType(bytes, mimeType);
  if (!mimeType.startsWith(`${mediaType}/`) || !mediaExtensions[mimeType]) invalid("生成结果不是支持的图片、视频或音频格式");
  return { bytes, mimeType };
}

async function writeGeneratedAssets(
  cwd: string,
  mediaType: "image" | "video" | "audio",
  assets: MediaAsset[],
  outputDirectory: string,
  signal?: AbortSignal,
): Promise<GeneratedMedia[]> {
  const written: string[] = [];
  const result: GeneratedMedia[] = [];
  try {
    for (const asset of assets) {
      signal?.throwIfAborted();
      const { bytes, mimeType } = await assetBytes(asset, mediaType, signal);
      signal?.throwIfAborted();
      const output = await resolveWorkspacePath(cwd, outputDirectory, true);
      const release = lockWorkspaceFiles([output.path]);
      try {
        await mkdir(output.path, { recursive: true });
        const file = join(outputDirectory, `${mediaType}${crypto.randomUUID()}.${mediaExtensions[mimeType]}`);
        const { path } = await resolveWorkspacePath(cwd, file);
        signal?.throwIfAborted();
        await writeWorkspaceFile(path, bytes, true);
        written.push(path);
        result.push({ path: relative(cwd, path).replace(/\\/g, "/"), mimeType, mediaType });
      } finally { release(); }
    }
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    // ACT: 只回滚本次创建的文件，保留目录中已有的节点资源。
    await Promise.all(written.map(path => unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; })));
    throw err;
  }
}

async function recoverPendingTask(entry: PendingMediaTask): Promise<MediaAsset[]> {
  const providerInfo = await getMediaProvider(entry.providerId);
  const configurations = record(conf.get("settings", {}).mediaProviderConfigs);
  const provider = await loadMediaProviderSource(providerInfo.source, record(configurations[providerInfo.id]), undefined, fetch, entry.cwd);
  if (typeof provider.getPendingTask !== "function") throw new Error("供应商不支持任务恢复");
  return provider.getPendingTask({ mediaType: entry.mediaType, taskICode: entry.taskICode });
}

/**
 * 后台恢复已提交但未取回结果的供应商任务（进程崩溃或客户端断开导致请求中断时）。
 * 只按任务 ID 查询结果，绝不重新提交，避免重复计费；成功后把媒体写入原工作区目录。
 */
export async function resumePendingMediaTasks() {
  if (resuming) return;
  resuming = true;
  try {
    const entries = readJournal().filter(item => item.status === "running" && !activeTaskCodes.has(item.taskICode));
    for (const entry of entries) {
      const age = Date.now() - Date.parse(entry.createdAt);
      if (age < 60_000) continue;
      if (age > 48 * 3600_000) {
        updateJournalEntry(entry.taskICode, { status: "failed", error: "超过 48 小时未能取回结果，停止重试" });
        continue;
      }
      try {
        const assets = await recoverPendingTask(entry);
        if (!assets.length) continue;
        await writeGeneratedAssets(entry.cwd, entry.mediaType, assets, entry.outputDirectory);
        updateJournalEntry(entry.taskICode, { status: "done" });
      } catch (error) {
        updateJournalEntry(entry.taskICode, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    const current = readJournal();
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    const kept = current.filter(item => item.status === "running" || Date.parse(item.updatedAt) >= cutoff);
    if (kept.length !== current.length) writeJournal(kept);
  } finally { resuming = false; }
}

/** 服务启动时开启后台恢复扫描。 */
export function startMediaTaskResume() {
  const timer = setTimeout(() => { void resumePendingMediaTasks(); }, 20_000);
  const interval = setInterval(() => { void resumePendingMediaTasks(); }, 120_000);
  timer.unref?.();
  interval.unref?.();
}

export async function generateMedia(
  cwd: string,
  mediaType: "image" | "video" | "audio",
  request: MediaGenerationRequest,
  signal?: AbortSignal,
): Promise<GeneratedMedia[]> {
  signal?.throwIfAborted();
  if (!request.prompt.trim()) invalid("请输入生成提示词");
  const directory = await realpath(cwd);
  const outputDirectory = request.outputDirectory ?? "assets/generated";
  await resolveWorkspacePath(directory, outputDirectory, true);
  const providerInfo = await getMediaProvider(request.providerId);
  const model = providerInfo.models.find(model => model.id === request.modelId && model.type === mediaType);
  if (!model) invalid("所选媒体模型不存在或类型不匹配，请重新选择");
  const configurations = record(conf.get("settings", {}).mediaProviderConfigs);
  const reportedTasks: PendingMediaTask[] = [];
  const onTask = (task: { mediaType: "image" | "video" | "audio"; taskICode: string }) => {
    if (reportedTasks.some(item => item.taskICode === task.taskICode)) return;
    const now = new Date().toISOString();
    const entry: PendingMediaTask = {
      taskICode: task.taskICode, providerId: providerInfo.id, mediaType,
      cwd: directory, outputDirectory, createdAt: now, updatedAt: now, status: "running",
    };
    reportedTasks.push(entry);
    activeTaskCodes.add(task.taskICode);
    writeJournal([...readJournal().filter(item => item.taskICode !== task.taskICode), entry]);
  };
  const provider = await loadMediaProviderSource(providerInfo.source, record(configurations[providerInfo.id]), signal, undefined, directory, onTask);
  const generate = mediaType === "image" ? provider.generateImage : mediaType === "video" ? provider.generateVideo : provider.generateAudio;
  if (typeof generate !== "function") invalid(t`此供应商不支持${translateMessage({ image: "图片", video: "视频", audio: "音频" }[mediaType])}生成`);
  const rules = Array.isArray(provider.rules) ? provider.rules : [];
  if (rules.some(rule => rule.field === "apiKey") && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) invalid("请先在媒体模型设置中配置供应商 API Key");
  const references = async (items: MediaReference[] | undefined, type: string) => items ? Promise.all(items.map(item => readReference(directory, item, type, signal))) : undefined;
  const images = await references(request.images, "image");
  signal?.throwIfAborted();
  const assets = mediaType === "audio"
    ? await provider.generateAudio!({
      model: request.modelId, text: request.prompt, audios: await references(request.audios, "audio"),
      voice: request.voice, speed: request.speed, volume: request.volume, format: request.format, sampleRate: request.sampleRate,
    })
    : mediaType === "image"
    ? await provider.generateImage!({ model: request.modelId, prompt: request.prompt, images, ratio: request.ratio, size: request.size })
    : await provider.generateVideo!({
      model: request.modelId, prompt: request.prompt, images,
      videos: await references(request.videos, "video"), audios: await references(request.audios, "audio"),
      firstFrame: request.firstFrame ? await readReference(directory, request.firstFrame, "image", signal) : undefined,
      lastFrame: request.lastFrame ? await readReference(directory, request.lastFrame, "image", signal) : undefined,
      ratio: request.ratio, resolution: request.resolution, duration: request.duration,
      generateAudio: request.generateAudio, mode: request.mode,
    });
  if (!Array.isArray(assets) || !assets.length) invalid("供应商未返回生成结果");
  try {
    const result = await writeGeneratedAssets(directory, mediaType, assets, outputDirectory, signal);
    // 成功取回并落盘，任务记录完成使命，移除。
    for (const entry of reportedTasks) {
      activeTaskCodes.delete(entry.taskICode);
      updateJournalEntry(entry.taskICode, {}, true);
    }
    return result;
  } catch (error) {
    // ACT: 中断（客户端断开/进程退出）或失败时保留 running 记录；恢复流程会向供应商确认最终状态——
    // 明确失败只多一次状态查询，而轮询中的瞬时网络错误若在此删除记录会让已计费任务永久丢失。
    for (const entry of reportedTasks) activeTaskCodes.delete(entry.taskICode);
    throw error;
  }
}
