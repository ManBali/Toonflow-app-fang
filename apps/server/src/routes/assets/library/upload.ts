import { mkdir } from "@toonflow/file";
import { join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.put("/", validateFields({
  asset: z.string().uuid(),
  name: z.string().min(1).max(255).regex(/^[^\/]+$/),
  mimeType: z.string().max(100).optional(),
  label: z.string().max(100).optional(),
}, "query"), async (req, res) => {
  if (!req.is("application/octet-stream") || (req.body !== undefined && !Buffer.isBuffer(req.body))) {
    throw Object.assign(new Error("请发送文件原始内容"), { status: 400 });
  }
  const root = await u.assets.getLibraryDirectory();
  await u.assets.readAssetRecord(root, req.query.asset as string);
  const directory = u.assets.assetDirectory(root, req.query.asset as string);
  const { path } = await u.workspaceFile.resolveWorkspacePath(directory, req.query.name as string, true);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  const release = u.workspaceFile.lockWorkspaceFiles([path, join(directory, "record.json")]);
  try {
    await mkdir(directory, { recursive: true });
    await u.workspaceFile.writeWorkspaceFile(path, req.body ?? Buffer.alloc(0));
    const record = await u.assets.readAssetRecord(root, req.query.asset as string);
    const entry = { name: req.query.name as string, mimeType: (req.query.mimeType as string | undefined) ?? u.assets.guessMimeType(req.query.name as string) };
    const existing = record.files.findIndex(file => file.name === entry.name);
    if (existing >= 0) {
      record.files[existing] = { ...record.files[existing], ...entry, ...(req.query.label !== undefined ? { label: req.query.label as string } : {}) };
    } else {
      record.files.push({ ...entry, ...(req.query.label !== undefined ? { label: req.query.label as string } : {}) });
    }
    record.updatedAt = new Date().toISOString();
    await u.assets.writeAssetRecord(root, record);
    res.json(success(record));
  } finally { release(); }
});
