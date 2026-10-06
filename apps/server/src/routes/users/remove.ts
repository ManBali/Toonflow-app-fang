import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { requireAdmin } from "@/lib/auth";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { getRequestUser } from "@/utils/users";

const router = Router();

export default router.delete("/", requireAdmin, validateFields({ id: z.string().min(1).max(64) }), async (req, res) => {
  const current = await getRequestUser(req);
  if (!current) return res.status(401).json(error("请先登录", null, 401));
  await u.users.removeUser(req.body.id, current.id);
  res.json(success(null, "用户已删除"));
});
