import { Router } from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { findUserProviderKeys, getRequestUser } from "@/utils/users";

const router = Router();

export default router.get("/", async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json(error("请先登录", null, 401));
  const settings = u.conf.get("settings", {}) as { customProviders?: { id: string; label?: string; apiKey?: string }[] };
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  const languageKeys = await findUserProviderKeys(user.id, "language");
  const mediaKeys = await findUserProviderKeys(user.id, "media");
  const language = providers.map(provider => ({
    providerId: provider.id,
    label: provider.label || provider.id,
    key: languageKeys[provider.id] ?? "",
    globalKeyRequired: !!provider.apiKey?.trim(),
  }));
  const media = (await u.mediaProvider.listMediaProviders()).map(provider => ({
    providerId: provider.id,
    label: provider.label || provider.id,
    key: mediaKeys[provider.id] ?? "",
    globalKeyRequired: !!u.mediaProvider.getMediaProviderApiKey(provider.id),
  }));
  res.set("Cache-Control", "no-store").json(success({ language, media }));
});
