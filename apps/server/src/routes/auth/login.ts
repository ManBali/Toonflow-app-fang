import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { sessionCookieName } from "@/utils/users";

const router = Router();

export default router.post("/", validateFields({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  code: z.string().min(1).max(8),
}), async (req, res) => {
  const { username, password, code } = req.body as { username: string; password: string; code: string };
  const record = await u.users.findUserByUsername(username);
  if (!record || !u.users.verifyPassword(password, record)) return res.status(400).json(error("用户名或密码错误"));
  if (!u.feishu.consumeLoginCode(username, code)) return res.status(400).json(error("验证码错误或已过期，请重新获取"));
  const { token, maxAgeSeconds } = u.users.createSession(record.id);
  await u.users.touchLastLogin(record.id);
  // 登录通知失败不影响登录结果。
  void u.feishu.notifyLogin(record, req.get("user-agent") ?? "").catch((notifyError) => console.error("发送登录通知失败：", notifyError));
  res.setHeader("Set-Cookie", `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
  res.json(success({ user: u.users.toPublicUser(record) }));
});
