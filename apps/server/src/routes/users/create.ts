import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { requireAdmin } from "@/lib/auth";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", requireAdmin, validateFields({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,32}$/, "用户名只能是 3-32 位字母、数字或下划线"),
  password: z.string().min(6).max(64),
  displayName: z.string().trim().min(1).max(40).optional(),
  role: z.enum(["admin", "user"]).optional(),
}), async (req, res) => {
  const { username, password, displayName, role } = req.body;
  res.json(success(await u.users.createUser({ username, password, displayName, role })));
});
