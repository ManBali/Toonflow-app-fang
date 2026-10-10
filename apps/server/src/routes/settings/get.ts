import u from "@/utils";
import { Router } from "express";
import { success } from "@/lib/responseFormat";
import { getCurrentRequestUser } from "@/lib/auth";

const router = Router();

type providerSettings = { customProviders?: { apiKey?: string }[]; mediaProviderConfigs?: Record<string, { apiKey?: string }> };

export default router.get("/", (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  const settings = u.conf.get("settings", {}) as Record<string, unknown> & providerSettings;
  const requester = getCurrentRequestUser();
  if (requester && requester.role !== "admin") {
    // 普通用户看不到全局供应商 Key；自己的 Key 在"API 密钥"面板单独管理。
    const masked = structuredClone(settings) as providerSettings;
    for (const provider of Array.isArray(masked.customProviders) ? masked.customProviders : []) {
      if (provider && typeof provider === "object") provider.apiKey = "";
    }
    for (const config of Object.values(masked.mediaProviderConfigs ?? {})) {
      if (config && typeof config === "object") config.apiKey = "";
    }
    return res.json(success(masked));
  }
  res.json(success(settings));
});
