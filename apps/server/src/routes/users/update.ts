import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { requireAdmin } from "@/lib/auth";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { getRequestUser } from "@/utils/users";

const router = Router();

export default router.put("/", requireAdmin, validateFields({
  id: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(40).optional(),
  role: z.enum(["admin", "user"]).optional(),
  password: z.string().min(6).max(64).optional(),
}), async (req, res) => {
  const current = await getRequestUser(req);
  const { id, displayName, role, password } = req.body;
  const record = await u.users.updateUser(id, { displayName, role, password });
  // 重置自己的密码后所有会话（含当前会话）立即失效，需要重新登录。
  if (current?.id === id && password) u.users.destroyUserSessions(id);
  res.json(success(record));
});
