import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { getRequestUser } from "@/utils/users";

const keysSchema = z.record(z.string().max(200), z.string().max(8192)).optional();

const router = Router();

export default router.put("/", validateFields({
  languageProviderKeys: keysSchema,
  mediaProviderKeys: keysSchema,
}), async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json(error("请先登录", null, 401));
  const trimKeys = (keys: Record<string, string> | undefined) =>
    Object.fromEntries(Object.entries(keys ?? {}).map(([providerId, key]) => [providerId, key.trim()]));
  await u.users.setProviderKeys(user.id, {
    languageProviderKeys: trimKeys(req.body.languageProviderKeys),
    mediaProviderKeys: trimKeys(req.body.mediaProviderKeys),
  });
  res.json(success(null, "API 密钥已保存"));
});
