import { defineStore } from "pinia";
import { ref } from "vue";
import axios from "axios";
import type { AgentAttachment } from "@/components/agent/types";

export type Project = {
  directory: string;
  name: string;
  lastOpenedAt: number;
  ownerUsername?: string;
};

const workspaceHeaders = { "x-toonflow-workspace": "1" };

export const useWorkspaceStore = defineStore("workspace", () => {
  const project = ref<Project | null>(null);
  // 项目列表保存在服务端并按用户隔离；管理员能拿到全部项目（带 ownerUsername）。
  const projectList = ref<Project[]>([]);
  const pendingAgentMessage = ref<{ directory: string; prompt: string; attachments?: AgentAttachment[]; model: string; reasoningEffort: string } | null>(null);

  async function loadProjects() {
    const { data } = await axios.get<{ code: number; data?: { projects: Project[] } }>("/api/projects/list", { headers: workspaceHeaders });
    if (data.code === 200 && data.data) projectList.value = data.data.projects;
  }

  async function openProject(path: string, previousDirectory = path, signal?: AbortSignal) {
    const { data } = await axios.get<{ code: number; data?: { directory: string }; message?: string }>("/api/workspaces/check", {
      params: { directory: path }, headers: workspaceHeaders, signal,
    });
    signal?.throwIfAborted();
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "工作目录校验失败");
    const checkedDirectory = data.data.directory;
    pendingAgentMessage.value = null;
    const existing = projectList.value.find(project => project.directory === previousDirectory)
      ?? projectList.value.find(project => project.directory === checkedDirectory);
    project.value = { directory: checkedDirectory, name: existing?.name || checkedDirectory.split(/[\\/]/).filter(Boolean).at(-1) || checkedDirectory, lastOpenedAt: Date.now() };
    projectList.value = [
      project.value,
      ...projectList.value.filter(item => item.directory !== previousDirectory && item.directory !== checkedDirectory),
    ];
    // 服务端登记归属与最近打开时间；失败不影响本次打开。
    await axios.post("/api/projects/upsert", { directory: checkedDirectory, name: project.value.name }, { headers: workspaceHeaders }).catch(() => {});
  }

  function renameProject(path: string, name: string) {
    const target = projectList.value.find(item => item.directory === path);
    if (!target || !name.trim()) return;
    target.name = name.trim();
    if (project.value?.directory === path) project.value = target;
    void axios.post("/api/projects/rename", { directory: path, name: name.trim() }, { headers: workspaceHeaders }).catch(() => {});
  }

  function removeProject(path: string) {
    projectList.value = projectList.value.filter(item => item.directory !== path);
    if (project.value?.directory === path) project.value = null;
    void axios.post("/api/projects/remove", { directory: path }, { headers: workspaceHeaders }).catch(() => {});
  }

  return { project, projectList, pendingAgentMessage, loadProjects, openProject, renameProject, removeProject };
}, {
  persist: {
    key: "toonflow.projectList",
    pick: ["project"],
  },
});
