import axios from "axios";

export type AssetCategory = "character" | "scene" | "prop" | "voice";

export interface AssetLibraryFile {
  name: string;
  mimeType: string;
  label?: string;
}

export interface AssetRecord {
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

export const assetCategories: AssetCategory[] = ["character", "scene", "prop", "voice"];
export const assetCategoryLabels: Record<AssetCategory, string> = { character: "角色", scene: "场景", prop: "道具", voice: "声音" };

export function assetFileUrl(assetId: string, name: string) {
  return `/api/assets/library/files/${assetId}/${encodeURIComponent(name)}`;
}

export function isImageFile(file: { mimeType: string }) {
  return file.mimeType.startsWith("image/");
}

export async function listAssets(params: { category?: string; search?: string; tags?: string } = {}) {
  const { data } = await axios.get<{ data: { assets: AssetRecord[] } }>("/api/assets/library/list", { params });
  return data.data.assets;
}

export async function readAsset(assetId: string) {
  const { data } = await axios.get<{ data: AssetRecord }>("/api/assets/library/read", { params: { asset: assetId } });
  return data.data;
}

export async function createAsset(record: Partial<AssetRecord>) {
  const { data } = await axios.post<{ data: AssetRecord }>("/api/assets/library/create", record);
  return data.data;
}

export async function updateAsset(assetId: string, patch: Partial<Omit<AssetRecord, "id" | "createdAt" | "updatedAt">>) {
  const { data } = await axios.put<{ data: AssetRecord }>("/api/assets/library/update", { id: assetId, ...patch });
  return data.data;
}

export async function uploadAssetFile(assetId: string, content: Blob, name: string, label?: string) {
  const params: Record<string, string> = { asset: assetId, name };
  if (label) params.label = label;
  const { data } = await axios.put<{ data: AssetRecord }>("/api/assets/library/upload", content, {
    params,
    headers: { "Content-Type": "application/octet-stream" },
  });
  return data.data;
}

export async function removeAsset(assetId: string, file?: string) {
  await axios.delete("/api/assets/library/remove", { data: file ? { id: assetId, file } : { id: assetId } });
}

export function assetErrorMessage(error: unknown, fallback = "操作失败") {
  if (axios.isAxiosError<{ message: string }>(error)) return error.response?.data.message || error.message;
  return error instanceof Error ? error.message : fallback;
}

/** 把节点输出或拖拽来的媒体内容包装成待上传的文件。 */
export async function toUploadFile(url: string, name: string, directory?: () => string | undefined) {
  const { default: useWorkspaceFiles } = await import("@/lib/workspaceFiles");
  const files = directory ? useWorkspaceFiles(directory) : useWorkspaceFiles();
  const content = await files.read(url);
  return new File([content], name);
}
