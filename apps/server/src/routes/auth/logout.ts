import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { sessionCookieName } from "@/utils/users";

const router = Router();

export default router.post("/", (req, res) => {
  u.users.destroySession(req);
  res.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json(success(null, "已退出登录"));
});
