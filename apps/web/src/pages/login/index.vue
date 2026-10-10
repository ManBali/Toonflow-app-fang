<template>
  <div class="login">
    <bg class="pageBackground" />
    <form class="loginCard" aria-label="登录 Catflow" @submit.prevent="submit">
      <div class="brand">
        <el-image class="brandLogo" :src="logoUrl" fit="contain" alt="Catflow" />
        <h1>Catflow</h1>
      </div>
      <el-input v-model="form.username" size="large" placeholder="用户名" autocomplete="username" aria-label="用户名" />
      <el-input v-model="form.password" size="large" type="password" showPassword placeholder="密码" autocomplete="current-password" aria-label="密码" />
      <div class="captchaRow">
        <el-input v-model="form.code" size="large" maxlength="6" placeholder="飞书验证码" aria-label="飞书验证码" @keyup.enter="submit" />
        <el-button
          class="sendCodeButton"
          size="large"
          :loading="sending"
          :disabled="countdown > 0"
          @click="sendCode">
          {{ countdown > 0 ? `${countdown}s 后重发` : "发送验证码" }}
        </el-button>
      </div>
      <p class="loginHint">验证码将发送到飞书群，请输入飞书中收到的验证码完成登录。</p>
      <el-button class="submitButton" type="primary" size="large" nativeType="submit" :loading="submitting" :disabled="!form.username || !form.password || !form.code">登 录</el-button>
    </form>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { onBeforeUnmount, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import logoUrl from "@toonflow/assets/logo.svg";
import bg from "@/pages/home/bg.vue";

const authStore = useAuthStore();
const route = useRoute();
const form = reactive({ username: "", password: "", code: "" });
const sending = ref(false);
const submitting = ref(false);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | undefined;

function startCountdown() {
  countdown.value = 60;
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) clearInterval(countdownTimer);
  }, 1000);
}
onBeforeUnmount(() => clearInterval(countdownTimer));

async function sendCode() {
  if (sending.value || countdown.value > 0) return;
  if (!form.username || !form.password) return ElMessage.warning("请先填写用户名和密码，再发送验证码");
  sending.value = true;
  try {
    const { data } = await axios.post("/api/auth/code", { username: form.username, password: form.password });
    if (data.code !== 200) throw new Error(data.message || "验证码发送失败");
    ElMessage.success("验证码已发送至飞书，请查看后输入");
    startCountdown();
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "验证码发送失败，请稍后重试"
      : error instanceof Error ? error.message : "验证码发送失败，请稍后重试");
  } finally {
    sending.value = false;
  }
}

async function submit() {
  if (submitting.value) return;
  if (!form.username || !form.password || !form.code) return ElMessage.warning("请填写用户名、密码和飞书验证码");
  submitting.value = true;
  try {
    await authStore.login({ username: form.username, password: form.password, code: form.code });
    const redirect = route.query.redirect;
    if (typeof redirect === "string" && redirect.startsWith("/")) window.location.hash = `#${redirect}`;
    // 登录后整页重载，让设置、工作区等启动流程在已登录状态下重新执行。
    window.location.reload();
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "登录失败，请重试"
      : error instanceof Error ? error.message : "登录失败，请重试");
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

      .sendCodeButton {
        flex-shrink: 0;
        width: 120px;
      }
    }

    .loginHint {
      margin: -6px 0 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      line-height: 1.6;
    }

    .submitButton { margin-top: 4px; }
  }
}
</style>
