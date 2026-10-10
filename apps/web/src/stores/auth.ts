import axios from "axios";
import { computed, ref } from "vue";
import { defineStore } from "pinia";

export interface authUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<authUser | null>(null);
  // ready 标记首次探测完成，路由守卫只探测一次。
  const ready = ref(false);
  const isAdmin = computed(() => user.value?.role === "admin");

  async function fetchMe() {
    try {
      const { data } = await axios.get("/api/auth/me");
      user.value = data.code === 200 ? data.data.user : null;
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
    return user.value;
  }

  async function login(payload: { username: string; password: string; code: string }) {
    const { data } = await axios.post("/api/auth/login", payload);
    if (data.code !== 200) throw new Error(data.message || "登录失败");
    user.value = data.data.user;
    return data.data.user as authUser;
  }

  async function logout() {
    try { await axios.post("/api/auth/logout"); } catch { /* 会话已失效也继续清理本地状态。 */ }
    user.value = null;
  }

  return { user, ready, isAdmin, fetchMe, login, logout };
});
