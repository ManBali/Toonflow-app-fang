<template>
  <div class="login">
    <bg class="pageBackground" />
    <form class="loginCard" aria-label="登录 Toonflow" @submit.prevent="submit">
      <div class="brand">
        <el-image class="brandLogo" :src="logoUrl" fit="contain" alt="Toonflow" />
        <h1>Toonflow</h1>
      </div>
      <el-input v-model="form.username" size="large" placeholder="用户名" autocomplete="username" aria-label="用户名" />
      <el-input v-model="form.password" size="large" type="password" showPassword placeholder="密码" autocomplete="current-password" aria-label="密码" />
      <div class="captchaRow">
        <el-input v-model="form.captcha" size="large" maxlength="4" placeholder="验证码" aria-label="验证码" @keyup.enter="submit" />
        <span
          class="captchaImage"
          title="点击刷新验证码"
          aria-label="验证码图片，点击刷新"
          @click="refreshCaptcha"
          v-html="captchaSvg" />
      </div>
      <el-button class="submitButton" type="primary" size="large" nativeType="submit" :loading="submitting">登 录</el-button>
    </form>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import logoUrl from "@toonflow/assets/logo.svg";
import bg from "@/pages/home/bg.vue";

const authStore = useAuthStore();
const route = useRoute();
const form = reactive({ username: "", password: "", captcha: "" });
const captchaId = ref("");
const captchaSvg = ref("");
const submitting = ref(false);

async function refreshCaptcha() {
  try {
    const { data } = await axios.get("/api/auth/captcha");
    captchaId.value = data.data.id;
    captchaSvg.value = data.data.svg;
    form.captcha = "";
  } catch {
    ElMessage.error("获取验证码失败，请刷新页面重试");
  }
}
onMounted(refreshCaptcha);

async function submit() {
  if (submitting.value) return;
  if (!form.username || !form.password || !form.captcha) return ElMessage.warning("请填写用户名、密码和验证码");
  submitting.value = true;
  try {
    await authStore.login({ ...form, captchaId: captchaId.value });
    const redirect = route.query.redirect;
    if (typeof redirect === "string" && redirect.startsWith("/")) window.location.hash = `#${redirect}`;
    // 登录后整页重载，让设置、工作区等启动流程在已登录状态下重新执行。
    window.location.reload();
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "登录失败，请重试"
      : error instanceof Error ? error.message : "登录失败，请重试");
    await refreshCaptcha();
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.login {
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-primary);

  .pageBackground {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }

  .loginCard {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: min(400px, calc(100vw - 32px));
    padding: 36px 32px;
    border-radius: calc(var(--ui-radius) * 2.5);
    background: var(--el-bg-color-overlay);
    border: 1px solid var(--el-border-color-lighter);
    box-shadow: var(--el-box-shadow-lighter);

    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 8px;

      .brandLogo {
        width: 40px;
        height: 40px;

        .dark & { filter: invert(1); }
      }

      h1 {
        margin: 0;
        font-size: 26px;
        font-weight: 600;
        letter-spacing: -1px;
      }
    }

    .captchaRow {
      display: flex;
      align-items: stretch;
      gap: 12px;

      .el-input { flex: 1; }

      .captchaImage {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        border-radius: var(--ui-radius);
        overflow: hidden;
        cursor: pointer;
        line-height: 0;

        svg { height: 40px; width: 120px; }
      }
    }

    .submitButton { margin-top: 4px; }
  }
}
</style>
