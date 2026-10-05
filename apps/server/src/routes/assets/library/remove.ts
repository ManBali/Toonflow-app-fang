import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.delete("/", validateFields({
  id: z.string().uuid(),
  file: z.string().max(255).regex(/^[^\/]+$/).optional(),
}), async (req, res) => {
  const root = await u.assets.getLibraryDirectory();
  const record = await u.assets.readAssetRecord(root, req.body.id);
  if (req.body.file) {
    const { path } = await u.workspaceFile.resolveWorkspacePath(u.assets.assetDirectory(root, record.id), req.body.file);
    const release = u.workspaceFile.lockWorkspaceFiles([path, u.assets.assetDirectory(root, record.id)]);
    try {
      await u.assets.removeAssetFile(path);
      record.files = record.files.filter(entry => entry.name !== req.body.file);
      record.updatedAt = new Date().toISOString();
      await u.assets.writeAssetRecord(root, record);
    } finally { release(); }
  } else {
    await u.assets.removeAssetDirectory(root, record.id);
  }
  res.json(success());
});
