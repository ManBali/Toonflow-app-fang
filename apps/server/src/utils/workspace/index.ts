import type { Request } from "express";
import { realpath, stat } from "@toonflow/file";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import conf from "@/utils/conf";
import { getCurrentRequestUser } from "@/lib/auth";
import { assertProjectAccess } from "@/utils/projects";

export function isLocalWorkspaceRequest(req: Request) {
  const localAddress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") && req.get("x-toonflow-local-client") !== "0";
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(req.hostname);
  const origin = req.get("origin");
  const localOrigin = `${req.protocol}://${req.get("host")}`;
  const sameOrigin = origin === undefined ? req.get("referer")?.startsWith(`${localOrigin}/`) : origin === localOrigin;
  return localAddress && localHost && sameOrigin && req.get("x-toonflow-workspace") === "1";
}

export async function resolveWorkspace(req: Request, path: string) {
  if (!isAbsolute(path)) throw Object.assign(new Error("工作目录必须是绝对路径"), { status: 400 });
  const directory = await realpath(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") throw Object.assign(new Error("工作目录不存在，请重新选择文件夹"), { status: 404 });
    throw err;
  });
  if (!(await stat(directory)).isDirectory()) throw Object.assign(new Error("工作目录不是文件夹，请重新选择"), { status: 404 });
  const localWorkspace = ["win32", "darwin"].includes(process.platform) && (process.env.NODE_ENV === "dev" || process.env.toonflowDesktop === "1");
  if (localWorkspace && isLocalWorkspaceRequest(req)) return directory;

  // 服务器部署下，普通用户只能访问自己登记的工作目录；本地桌面是单机单人场景，不做归属限制。
  const requester = getCurrentRequestUser();
  if (requester && requester.role !== "admin") await assertProjectAccess(requester.id, directory);

  const root = await realpath(resolve(dirname(conf.path), "workspaces")).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (root) {
    const offset = relative(root, directory);
    if (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) return directory;
  }
  throw Object.assign(new Error("服务器部署只能使用服务器工作区"), { status: 403 });
}
