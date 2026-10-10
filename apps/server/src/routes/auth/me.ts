import { Router } from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", async (req, res) => {
  const user = await u.users.getRequestUser(req);
  if (!user) return res.status(401).json(error("请先登录", null, 401));
  res.set("Cache-Control", "no-store").json(success({ user }));
});
