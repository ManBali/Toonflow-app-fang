import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { error } from "./responseFormat";
import { getRequestRecord, verifyInternalRequest } from "@/utils/users";
import type { userRecord } from "@/utils/users";

// 无需登录的接口：发送飞书登录验证码、登录本身，以及已有同源与桌面壳校验的桌面接口。
const openPathPrefixes = ["/auth/code", "/auth/login", "/desktop"];

// 当前登录用户贯穿整个请求异步链，文本与媒体生成据此解析该用户自己的 API Key。
const requestUser = new AsyncLocalStorage<userRecord>();

export function getCurrentRequestUser() {
  return requestUser.getStore();
}

export function runWithRequestUser<T>(user: userRecord, operation: () => T): T {
  return requestUser.run(user, operation);
}

export async function authRequest(req: Request, res: Response, next: NextFunction) {
  if (openPathPrefixes.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next();
  if (verifyInternalRequest(req)) return next();
  const record = await getRequestRecord(req);
  if (!record) return res.status(401).json(error("请先登录", null, 401));
  // 内部凭证仅放行请求，不带用户上下文（MCP 通道沿用全局 Key）。
  return runWithRequestUser(record, next);
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await getRequestRecord(req);
  if (!user) return res.status(401).json(error("请先登录", null, 401));
  if (user.role !== "admin") return res.status(403).json(error("只有管理员可以管理用户", null, 403));
  next();
}
