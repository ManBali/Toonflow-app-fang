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
  captchaId: z.string().min(1).max(64),
  captcha: z.string().min(1).max(8),
}), async (req, res) => {
  const { username, password, captchaId, captcha } = req.body as { username: string; password: string; captchaId: string; captcha: string };
  if (!u.users.verifyCaptcha(captchaId, captcha)) return res.status(400).json(error("验证码错误或已过期"));
  const record = await u.users.findUserByUsername(username);
  if (!record || !u.users.verifyPassword(password, record)) return res.status(400).json(error("用户名或密码错误"));
  const { token, maxAgeSeconds } = u.users.createSession(record.id);
  await u.users.touchLastLogin(record.id);
  res.setHeader("Set-Cookie", `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
  res.json(success({ user: u.users.toPublicUser(record) }));
});
