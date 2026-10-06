import { createRouter, createWebHashHistory } from "vue-router";
import { useHelloStore } from "@/stores/hello";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/hello",
    },
    {
      path: "/login",
      component: () => import("@/pages/login/index.vue"),
    },
    {
      path: "/hello",
      beforeEnter: async () => await useHelloStore().load() ? { path: "/home", replace: true } : true,
      component: () => import("@/pages/hello/index.vue"),
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
    {
      path: "/assets",
      component: () => import("@/pages/assets/index.vue"),
    },
  ],
});

// 登录守卫：首次导航探测会话，未登录统一进入登录页。
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.path === "/login") return auth.user ? { path: "/", replace: true } : true;
  if (!auth.ready) await auth.fetchMe();
  if (auth.user) return true;
  return { path: "/login", query: to.fullPath !== "/" ? { redirect: to.fullPath } : undefined };
});

export default router;
