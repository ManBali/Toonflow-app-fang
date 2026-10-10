import { readFile, writeAtomic } from "@toonflow/file";
import { basename, join, resolve } from "node:path";
import { findUserByUsername, listUsers } from "@/utils/users";

export interface projectRecord {
  directory: string;
  name: string;
  lastOpenedAt: number;
  ownerUserId: string;
}

const projectsFilePath = join(process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data"), "projects.json");
// 项目归属是进程内单例状态，与服务端其他数据目录一致，不支持多进程并发写。
let projectsCache: { projects: projectRecord[] } | undefined;

async function loadProjects(): Promise<{ projects: projectRecord[] }> {
  if (projectsCache) return projectsCache;
  const raw = await readFile(projectsFilePath, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
    return "";
  });
  if (raw) {
    projectsCache = JSON.parse(raw) as { projects: projectRecord[] };
    return projectsCache;
  }
  // ACT: 旧版本把项目列表存在全局 settings（Pinia persist），迁移时统一归给内置管理员；
  // 普通用户从空列表开始，各自登记自己的项目。
  const { default: conf } = await import("@/utils/conf");
  const settings = conf.get("settings", {}) as { stores?: Record<string, { projectList?: { directory: string; name: string; lastOpenedAt: number }[] }> };
  const legacy = settings.stores?.["toonflow.projectList"]?.projectList;
  const admin = await findUserByUsername("admin");
  const now = Date.now();
  const projects = (Array.isArray(legacy) ? legacy : [])
    .filter(project => project && typeof project.directory === "string")
    .map(project => ({
      directory: project.directory,
      name: typeof project.name === "string" && project.name.trim() ? project.name : basename(project.directory),
      lastOpenedAt: typeof project.lastOpenedAt === "number" ? project.lastOpenedAt : now,
      ownerUserId: admin?.id ?? "",
    }));
  projectsCache = { projects };
  await writeAtomic(projectsFilePath, JSON.stringify({ projects }, null, 2));
  return projectsCache;
}

async function saveProjects(file: { projects: projectRecord[] }) {
  projectsCache = file;
  await writeAtomic(projectsFilePath, JSON.stringify(file, null, 2));
}

function findRecord(file: { projects: projectRecord[] }, directory: string) {
  return file.projects.find(project => project.directory === directory);
}

export async function listProjects(user: { id: string; role: string }) {
  const file = await loadProjects();
  const visible = user.role === "admin" ? file.projects : file.projects.filter(project => project.ownerUserId === user.id);
  if (user.role !== "admin") return visible;
  const users = await listUsers();
  const usernames = new Map(users.map(user => [user.id, user.username]));
  return visible.map(project => ({ ...project, ownerUsername: usernames.get(project.ownerUserId) ?? "" }));
}

export async function upsertProject(user: { id: string; role: string }, directory: string, name?: string) {
  const file = await loadProjects();
  const now = Date.now();
  const record = findRecord(file, directory);
  if (record) {
    if (record.ownerUserId !== user.id && user.role !== "admin")
      throw Object.assign(new Error("该工作目录属于其他用户"), { status: 403 });
    record.lastOpenedAt = now;
    if (name?.trim()) record.name = name.trim();
  } else {
    // ACT: 首个登记者即为归属者；服务器部署下打开时还会校验目录范围，内网团队场景可接受。
    file.projects.push({ directory, name: name?.trim() || basename(directory), lastOpenedAt: now, ownerUserId: user.id });
  }
  await saveProjects(file);
}

export async function renameProject(user: { id: string; role: string }, directory: string, name: string) {
  const file = await loadProjects();
  const record = findRecord(file, directory);
  if (!record) throw Object.assign(new Error("项目不存在"), { status: 404 });
  if (record.ownerUserId !== user.id && user.role !== "admin")
    throw Object.assign(new Error("该工作目录属于其他用户"), { status: 403 });
  record.name = name.trim();
  await saveProjects(file);
}

export async function removeProject(user: { id: string; role: string }, directory: string) {
  const file = await loadProjects();
  const record = findRecord(file, directory);
  if (!record) return;
  if (record.ownerUserId !== user.id && user.role !== "admin")
    throw Object.assign(new Error("该工作目录属于其他用户"), { status: 403 });
  await saveProjects({ projects: file.projects.filter(project => project !== record) });
}

export async function assertProjectAccess(userId: string, directory: string) {
  const file = await loadProjects();
  const record = findRecord(file, directory);
  if (!record || record.ownerUserId !== userId)
    throw Object.assign(new Error("该工作目录不属于当前用户"), { status: 403 });
}
