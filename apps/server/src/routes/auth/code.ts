import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", validateFields({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
}), async (req, res) => {
  const { username, password } = req.body;
  const record = await u.users.findUserByUsername(username);
  // 先校验用户名与密码，通过后验证码才会发往飞书，避免任何人向群里滥发消息。
  if (!record || !u.users.verifyPassword(password, record)) return res.status(400).json(error("用户名或密码错误"));
  await u.feishu.createLoginCode(username);
  res.json(success(null, "验证码已发送至飞书，请在飞书中查看后输入"));
});
