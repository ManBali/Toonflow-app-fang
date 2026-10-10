import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({ asset: z.string().uuid() }, "query"), async (req, res) => {
  const root = await u.assets.getLibraryDirectory();
  res.set("Cache-Control", "no-store").json(success(await u.assets.readAssetRecord(root, req.query.asset as string)));
});
