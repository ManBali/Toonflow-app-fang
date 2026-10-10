import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { getRequestUser } from "@/utils/users";

const router = Router();

export default router.post("/", validateFields({
  directory: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(80),
}), async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json(error("请先登录", null, 401));
  await u.projects.renameProject(user, req.body.directory, req.body.name);
  res.json(success(null, "项目已重命名"));
});
