import { mkdir, readdir, readFile, realpath, rm, stat, unlink, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import { z } from "zod";
import conf from "@/utils/conf";

export const assetCategories = ["character", "scene", "prop", "voice"] as const;
export type AssetCategory = (typeof assetCategories)[number];

export interface AssetLibraryFile {
  name: string;
  mimeType: string;
  label?: string;
}

export interface AssetLibraryRecord {
  id: string;
  name: string;
  category: AssetCategory;
  tags: string[];
  description?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  params?: Record<string, unknown>;
  voiceId?: string;
  files: AssetLibraryFile[];
  sourceProject?: string;
  createdAt: string;
  updatedAt: string;
}

/** 资产元数据中允许调用方写入的业务字段；id 和时间戳由接口自己生成。 */
export const assetLibraryRecordSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(assetCategories),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  description: z.string().max(10000).optional(),
  prompt: z.string().max(100000).optional(),
  provider: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  params: z.record(z.string(), z.json()).optional(),
  voiceId: z.string().max(500).optional(),
  sourceProject: z.string().max(4096).optional(),
});

export const assetLibraryFileSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().max(100),
  label: z.string().max(100).optional(),
});

const mimeByExtension: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".opus": "audio/opus",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
};

export function guessMimeType(name: string) {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return mimeByExtension[extension] ?? "application/octet-stream";
}

export async function getLibraryDirectory() {
  const directory = join(dirname(conf.path), "assets-library");
  await mkdir(directory, { recursive: true });
  return realpath(directory);
}

/** record.json 缺失或结构损坏的资产目录跳过，不让单个坏记录拖垮整个列表。 */
function parseRecord(raw: unknown, id: string): AssetLibraryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<AssetLibraryRecord>;
  if (record.id !== id || !assetCategories.includes(record.category as AssetCategory) || typeof record.name !== "string") return null;
  return {
    id,
    name: record.name,
    category: record.category as AssetCategory,
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    description: typeof record.description === "string" ? record.description : undefined,
    prompt: typeof record.prompt === "string" ? record.prompt : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    params: record.params && typeof record.params === "object" ? (record.params as Record<string, unknown>) : undefined,
    voiceId: typeof record.voiceId === "string" ? record.voiceId : undefined,
    files: Array.isArray(record.files) ? record.files.filter(file => file && typeof file.name === "string" && typeof file.mimeType === "string") : [],
    sourceProject: typeof record.sourceProject === "string" ? record.sourceProject : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

export function assetDirectory(root: string, assetId: string) {
  return join(root, assetId);
}

export async function readAssetRecord(root: string, assetId: string): Promise<AssetLibraryRecord> {
  const raw = await readFile(join(assetDirectory(root, assetId), "record.json"), "utf8");
  const record = parseRecord(JSON.parse(raw), assetId);
  if (!record) throw Object.assign(new Error("资产记录损坏"), { status: 500 });
  return record;
}

export async function writeAssetRecord(root: string, record: AssetLibraryRecord) {
  await writeAtomic(join(assetDirectory(root, record.id), "record.json"), JSON.stringify(record, null, 2));
}

export async function listAssetRecords(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const records = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    try { return parseRecord(JSON.parse(await readFile(join(root, entry.name, "record.json"), "utf8")), entry.name); }
    catch { return null; }
  }));
  return records.filter((record): record is AssetLibraryRecord => !!record);
}

export async function removeAssetDirectory(root: string, assetId: string) {
  await stat(assetDirectory(root, assetId));
  await rm(assetDirectory(root, assetId), { recursive: true });
}

export async function removeAssetFile(path: string) {
  await unlink(path);
}
