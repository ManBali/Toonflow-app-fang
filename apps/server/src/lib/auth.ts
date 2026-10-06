import type { NextFunction, Request, Response } from "express";
import { error } from "./responseFormat";
import { getRequestUser, verifyInternalRequest } from "@/utils/users";

// 无需登录的接口：验证码、登录本身，以及已有同源与桌面壳校验的桌面接口。
const openPathPrefixes = ["/auth/captcha", "/auth/login", "/desktop"];

export async function authRequest(req: Request, res: Response, next: NextFunction) {
  if (openPathPrefixes.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next();
  if (verifyInternalRequest(req)) return next();
  if (await getRequestUser(req)) return next();
  return res.status(401).json(error("请先登录", null, 401));
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json(error("请先登录", null, 401));
  if (user.role !== "admin") return res.status(403).json(error("只有管理员可以管理用户", null, 403));
  next();
}
