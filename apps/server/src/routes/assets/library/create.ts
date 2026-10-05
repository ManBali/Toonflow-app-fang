import { mkdir } from "@toonflow/file";
import { join } from "node:path";
import { Router } from "express";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import type { AssetLibraryRecord } from "@/utils/assets/library";

const router = Router();

export default router.post("/", validateFields(u.assets.assetLibraryRecordSchema.shape), async (req, res) => {
  // validateFields 只校验不回写，这里显式 parse 以剥掉多余字段。
  const input = u.assets.assetLibraryRecordSchema.parse(req.body);
  const root = await u.assets.getLibraryDirectory();
  const record: AssetLibraryRecord = {
    id: crypto.randomUUID(),
    ...input,
    tags: input.tags ?? [],
    files: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(join(root, record.id), { recursive: true });
  await u.assets.writeAssetRecord(root, record);
  res.json(success(record));
});
