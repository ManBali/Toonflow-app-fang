<template>
  <div v-loading="loading" class="keysPanel">
    <p class="panelHint">API Key 按用户隔离保存，生成时只使用你自己的 Key，其他用户无法使用或看到。未配置的供应商会在生成时提示补充。</p>
    <section v-for="group in groups" :key="group.kind" class="keyGroup" :aria-label="group.title">
      <h3 class="groupTitle">{{ group.title }}</h3>
      <div v-for="provider in group.items" :key="provider.providerId" class="keyRow">
        <span class="providerLabel" :title="provider.providerId">{{ provider.label }}</span>
        <el-input
          v-model="provider.key"
          type="password"
          showPassword
          :placeholder="provider.globalKeyRequired ? '必填，生成时使用你的 Key' : '可留空'"
          autocomplete="off" />
      </div>
      <p v-if="!group.items.length" class="emptyHint">暂无供应商，请联系管理员添加。</p>
    </section>
    <div class="panelActions">
      <el-button type="primary" :loading="saving" @click="save">保存密钥</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";

interface providerKeyItem {
  providerId: string;
  label: string;
  key: string;
  globalKeyRequired: boolean;
}

const loading = ref(false);
const saving = ref(false);
const form = reactive<{ language: providerKeyItem[]; media: providerKeyItem[] }>({ language: [], media: [] });

const groups = computed(() => [
  { kind: "languageProviderKeys" as const, title: "文本模型 Key", items: form.language },
  { kind: "mediaProviderKeys" as const, title: "媒体模型 Key", items: form.media },
]);

onMounted(async () => {
  loading.value = true;
  try {
    const { data } = await axios.get("/api/profile/keys/get");
    if (data.code !== 200) throw new Error(data.message || "读取 API 密钥失败");
    form.language = data.data.language;
    form.media = data.data.media;
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "读取 API 密钥失败"
      : error instanceof Error ? error.message : "读取 API 密钥失败");
  } finally {
    loading.value = false;
  }
});

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    const payload = {
      languageProviderKeys: Object.fromEntries(form.language.map(item => [item.providerId, item.key])),
      mediaProviderKeys: Object.fromEntries(form.media.map(item => [item.providerId, item.key])),
    };
    const { data } = await axios.put("/api/profile/keys/save", payload);
    if (data.code !== 200) throw new Error(data.message || "保存 API 密钥失败");
    ElMessage.success("API 密钥已保存");
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "保存 API 密钥失败"
      : error instanceof Error ? error.message : "保存 API 密钥失败");
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.keysPanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;

  .panelHint {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    line-height: 1.7;
  }

  .keyGroup {
    display: flex;
    flex-direction: column;
    gap: 10px;

    .groupTitle {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }

    .keyRow {
      display: flex;
      align-items: center;
      gap: 12px;

      .providerLabel {
        flex: 0 0 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--el-text-color-regular);
        font-size: 13px;
      }
    }

    .emptyHint {
      margin: 0;
      color: var(--el-text-color-secondary);
      font-size: 13px;
    }
  }

  .panelActions {
    display: flex;
    justify-content: flex-end;
  }
}
</style>
