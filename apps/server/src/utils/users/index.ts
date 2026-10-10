import { readFile, writeAtomic } from "@toonflow/file";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { join, resolve } from "node:path";
import type { Request } from "express";

export type userRole = "admin" | "user";

export interface userRecord {
  id: string;
  username: string;
  displayName: string;
  role: userRole;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  // 每个用户独立的模型 API Key，按 providerId 隔离，与全局供应商配置分开存储。
  languageProviderKeys?: Record<string, string>;
  mediaProviderKeys?: Record<string, string>;
}

export type publicUser = Omit<userRecord, "passwordHash" | "salt" | "languageProviderKeys" | "mediaProviderKeys">;

export const sessionCookieName = "toonflow_session";
const sessionTtl = 7 * 24 * 60 * 60 * 1000;
// MCP 工具在服务端内部回调 /api 接口，用启动期随机 token 放行，避免引入登录态。
export const internalRequestToken = randomBytes(24).toString("hex");

const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data");
const usersFilePath = join(dataDirectory, "users.json");
// 用户记录与登录会话都是进程内单例状态，不支持多进程并发写同一数据目录。
const sessions = new Map<string, { userId: string; expiresAt: number }>();

let usersCache: { users: userRecord[] } | undefined;

async function loadUsers(): Promise<{ users: userRecord[] }> {
  if (usersCache) return usersCache;
  const raw = await readFile(usersFilePath, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
    return "";
  });
  const file = raw ? (JSON.parse(raw) as { users: userRecord[] }) : { users: [] };
  if (!file.users.length) {
    // ACT: 首次启动自动创建内置管理员 admin/admin123，部署后请在用户管理中修改密码。
    // 升级时把全局供应商 Key 继承给管理员作为自己的 Key，普通用户必须各自配置。
    const { default: conf } = await import("@/utils/conf");
    const settings = conf.get("settings", {}) as { customProviders?: { id: string; apiKey: string }[]; mediaProviderConfigs?: Record<string, { apiKey?: string }> };
    const now = new Date().toISOString();
    const admin: userRecord = { id: randomUUID(), username: "admin", displayName: "管理员", role: "admin", ...hashPassword("admin123"), createdAt: now, updatedAt: now };
    for (const provider of Array.isArray(settings.customProviders) ? settings.customProviders : []) {
      if (provider?.id && typeof provider.apiKey === "string" && provider.apiKey.trim()) (admin.languageProviderKeys ??= {})[provider.id] = provider.apiKey.trim();
    }
    for (const [providerId, config] of Object.entries(settings.mediaProviderConfigs ?? {})) {
      if (config && typeof config.apiKey === "string" && config.apiKey.trim()) (admin.mediaProviderKeys ??= {})[providerId] = config.apiKey.trim();
    }
    file.users = [admin];
    await writeAtomic(usersFilePath, JSON.stringify(file, null, 2));
  }
  usersCache = file;
  return file;
}

async function saveUsers(file: { users: userRecord[] }) {
  usersCache = file;
  await writeAtomic(usersFilePath, JSON.stringify(file, null, 2));
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
}

export function verifyPassword(password: string, record: userRecord) {
  const { passwordHash } = hashPassword(password, record.salt);
  return timingSafeEqual(Buffer.from(passwordHash, "hex"), Buffer.from(record.passwordHash, "hex"));
}

export function toPublicUser(record: userRecord): publicUser {
  const { passwordHash, salt, languageProviderKeys, mediaProviderKeys, ...rest } = record;
  void passwordHash;
  void salt;
  void languageProviderKeys;
  void mediaProviderKeys;
  return rest;
}

export async function listUsers() {
  return (await loadUsers()).users.map(toPublicUser);
}

export async function findUserByUsername(username: string) {
  return (await loadUsers()).users.find(user => user.username === username);
}

async function findUserRecordById(id: string) {
  return (await loadUsers()).users.find(user => user.id === id);
}

export async function getRequestRecord(req: Request) {
  const token = readSessionToken(req);
  const session = token ? sessions.get(token) : undefined;
  if (!token || !session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return findUserRecordById(session.userId);
}

export async function getRequestUser(req: Request) {
  const record = await getRequestRecord(req);
  return record ? toPublicUser(record) : undefined;
}

function readSessionToken(req: Request) {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === sessionCookieName) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  for (const [key, session] of sessions) if (session.expiresAt < now) sessions.delete(key);
  sessions.set(token, { userId, expiresAt: now + sessionTtl });
  return { token, maxAgeSeconds: Math.floor(sessionTtl / 1000) };
}

export function destroySession(req: Request) {
  const token = readSessionToken(req);
  if (token) sessions.delete(token);
}

export function destroyUserSessions(userId: string) {
  for (const [token, session] of sessions) if (session.userId === userId) sessions.delete(token);
}

export function verifyInternalRequest(req: Request) {
  return req.get("x-toonflow-internal") === internalRequestToken;
}

export async function touchLastLogin(id: string) {
  const file = await loadUsers();
  const record = file.users.find(user => user.id === id);
  if (!record) return;
  record.lastLoginAt = new Date().toISOString();
  await saveUsers(file);
}

export async function createUser(input: { username: string; password: string; displayName?: string; role?: userRole }) {
  const file = await loadUsers();
  if (file.users.some(user => user.username.toLowerCase() === input.username.toLowerCase()))
    throw Object.assign(new Error("用户名已存在"), { status: 409 });
  const now = new Date().toISOString();
  const record: userRecord = {
    id: randomUUID(),
    username: input.username,
    displayName: input.displayName?.trim() || input.username,
    role: input.role ?? "user",
    ...hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  };
  await saveUsers({ users: [...file.users, record] });
  return toPublicUser(record);
}

export async function updateUser(id: string, patch: { displayName?: string; role?: userRole; password?: string }) {
  const file = await loadUsers();
  const record = file.users.find(user => user.id === id);
  if (!record) throw Object.assign(new Error("用户不存在"), { status: 404 });
  if (patch.role && patch.role !== record.role && record.role === "admin"
    && !file.users.some(user => user.role === "admin" && user.id !== id))
    throw Object.assign(new Error("系统至少需要保留一个管理员"), { status: 400 });
  if (patch.displayName !== undefined) record.displayName = patch.displayName.trim() || record.username;
  if (patch.role) record.role = patch.role;
  if (patch.password) Object.assign(record, hashPassword(patch.password));
  record.updatedAt = new Date().toISOString();
  await saveUsers(file);
  return toPublicUser(record);
}

export async function removeUser(id: string, currentUserId: string) {
  const file = await loadUsers();
  const record = file.users.find(user => user.id === id);
  if (!record) throw Object.assign(new Error("用户不存在"), { status: 404 });
  if (record.id === currentUserId) throw Object.assign(new Error("不能删除当前登录的账号"), { status: 400 });
  const remaining = file.users.filter(user => user.id !== id);
  if (record.role === "admin" && !remaining.some(user => user.role === "admin"))
    throw Object.assign(new Error("系统至少需要保留一个管理员"), { status: 400 });
  await saveUsers({ users: remaining });
  destroyUserSessions(id);
}

export async function findUserById(id: string) {
  return findUserRecordById(id);
}

export async function findUserProviderKeys(id: string, kind: "language" | "media") {
  const record = await findUserRecordById(id);
  return kind === "language" ? record?.languageProviderKeys ?? {} : record?.mediaProviderKeys ?? {};
}

export async function setProviderKeys(id: string, patch: { languageProviderKeys?: Record<string, string>; mediaProviderKeys?: Record<string, string> }) {
  const file = await loadUsers();
  const record = file.users.find(user => user.id === id);
  if (!record) throw Object.assign(new Error("用户不存在"), { status: 404 });
  if (patch.languageProviderKeys) record.languageProviderKeys = patch.languageProviderKeys;
  if (patch.mediaProviderKeys) record.mediaProviderKeys = patch.mediaProviderKeys;
  record.updatedAt = new Date().toISOString();
  await saveUsers(file);
}
