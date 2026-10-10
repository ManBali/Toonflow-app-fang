import { Router } from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { getRequestUser } from "@/utils/users";

const router = Router();

export default router.get("/", async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json(error("请先登录", null, 401));
  res.set("Cache-Control", "no-store").json(success({ projects: await u.projects.listProjects(user) }));
});
