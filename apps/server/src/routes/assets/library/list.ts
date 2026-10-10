import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({
  category: z.enum(u.assets.assetCategories).optional(),
  search: z.string().max(200).optional(),
  tags: z.string().max(2000).optional(),
}, "query"), async (req, res) => {
  const root = await u.assets.getLibraryDirectory();
  let records = await u.assets.listAssetRecords(root);
  const { category, search, tags } = req.query as { category?: string; search?: string; tags?: string };
  if (category) records = records.filter(record => record.category === category);
  if (tags) {
    const wanted = tags.split(",").filter(Boolean);
    if (wanted.length) records = records.filter(record => wanted.every(tag => record.tags.includes(tag)));
  }
  if (search) {
    const keyword = search.toLowerCase();
    records = records.filter(record => record.name.toLowerCase().includes(keyword)
      || record.description?.toLowerCase().includes(keyword)
      || record.tags.some(tag => tag.toLowerCase().includes(keyword)));
  }
  res.set("Cache-Control", "no-store").json(success({ assets: records }));
});
