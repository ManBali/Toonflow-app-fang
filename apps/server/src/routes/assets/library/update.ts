import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

const updateSchema = u.assets.assetLibraryRecordSchema.partial().extend({
  id: z.string().uuid(),
  files: z.array(u.assets.assetLibraryFileSchema).max(200).optional(),
});

export default router.put("/", validateFields(updateSchema.shape), async (req, res) => {
  // validateFields 只校验不回写，这里显式 parse 以剥掉多余字段并拿到完整的 files 校验规则。
  const input = updateSchema.parse(req.body);
  const root = await u.assets.getLibraryDirectory();
  const record = await u.assets.readAssetRecord(root, input.id);
  const release = u.workspaceFile.lockWorkspaceFiles([u.assets.assetDirectory(root, input.id)]);
  try {
    for (const key of ["name", "category", "tags", "description", "prompt", "provider", "model", "params", "voiceId", "sourceProject", "files"] as const) {
      if (input[key] !== undefined) (record as unknown as Record<string, unknown>)[key] = input[key];
    }
    record.updatedAt = new Date().toISOString();
    await u.assets.writeAssetRecord(root, record);
  } finally { release(); }
  res.json(success(record));
});
