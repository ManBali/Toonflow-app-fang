<template>
  <el-dialog v-model="visible" title="存为资产" width="480px" alignCenter appendToBody :closeOnClickModal="false" @opened="nameInput?.select()">
    <el-form class="saveForm" labelPosition="top" @submit.prevent="confirm">
      <el-form-item label="资产名称">
        <el-input ref="nameInput" v-model="name" aria-label="资产名称" placeholder="给这份资产起个名字" :disabled="saving" @keydown.enter.prevent="confirm" />
      </el-form-item>
      <el-form-item label="分类">
        <el-radio-group v-model="category" :disabled="saving">
          <el-radio-button v-for="(label, value) in assetCategoryLabels" :key="value" :value="value">{{ label }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="标签">
        <el-select v-model="tags" class="tagSelect" multiple filterable allowCreate defaultFirstOption placeholder="回车添加标签" :disabled="saving" />
      </el-form-item>
      <el-form-item v-if="category === 'voice'" label="音色 ID">
        <el-input v-model="voiceId" aria-label="音色 ID" placeholder="供应商的音色标识，供语音生成使用" :disabled="saving" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="description" type="textarea" :rows="2" aria-label="描述" placeholder="描述这份资产的用途与特征" :disabled="saving" />
      </el-form-item>
    </el-form>
    <div v-if="generationSummary" class="generationSummary">{{ generationSummary }}</div>
    <div class="fileList">
      <div v-for="file in files" :key="file.name" class="fileRow">
        <span class="fileName" :title="file.name">{{ file.name }}</span>
        <span class="fileSize">{{ formatSize(file.size) }}</span>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!name.trim() || !files.length" @click="confirm">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import axios from "axios";
import { ElMessage, type InputInstance } from "element-plus";
import { assetCategoryLabels, createAsset, uploadAssetFile, type AssetCategory, type AssetRecord } from "@/lib/assetLibrary";

const visible = ref(false);
const saving = ref(false);
const name = ref("");
const category = ref<AssetCategory>("character");
const tags = ref<string[]>([]);
const voiceId = ref("");
const description = ref("");
const files = ref<File[]>([]);
const meta = ref<Record<string, unknown>>({});
const nameInput = ref<InputInstance>();
const emit = defineEmits<{ saved: [record: AssetRecord] }>();

/** meta 里带出的生成信息只作展示并拼进描述，业务人员无需重复填写。 */
const generationSummary = computed(() => {
  const lines: string[] = [];
  if (typeof meta.value.prompt === "string" && meta.value.prompt.trim()) lines.push(`提示词：${meta.value.prompt.trim()}`);
  const model = parseModel(meta.value.model);
  if (model) lines.push(`生成参数：${model}`);
  const params = meta.value.params;
  if (params && typeof params === "object") {
    const { size, ratio } = params as Record<string, unknown>;
    if (typeof size === "string" && size) lines.push(`尺寸：${size}`);
    if (typeof ratio === "string" && ratio) lines.push(`比例：${ratio}`);
  }
  return lines.join("\n");
});

function parseModel(model: unknown) {
  if (typeof model !== "string" || !model.trim()) return "";
  try {
    const [provider, id] = JSON.parse(model) as unknown[];
    return [provider, id].filter(part => typeof part === "string" && part).join(" / ") || model;
  } catch { return model; }
}

function formatSize(size: number) {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 打开对话框：files 为待上传内容，meta 为节点数据（提示词、模型等自动带出）。 */
function open(payload: { name?: string; category?: AssetCategory; files?: File[]; meta?: Record<string, unknown> }) {
  name.value = payload.name ?? "";
  category.value = payload.category ?? "character";
  tags.value = [];
  voiceId.value = "";
  description.value = "";
  files.value = payload.files ?? [];
  meta.value = payload.meta ?? {};
  saving.value = false;
  visible.value = true;
}

async function confirm() {
  const assetName = name.value.trim();
  if (!assetName || !files.value.length || saving.value) return;
  saving.value = true;
  try {
    const summary = generationSummary.value;
    const fullDescription = [description.value.trim(), summary].filter(Boolean).join("\n");
    let record = await createAsset({
      name: assetName,
      category: category.value,
      tags: tags.value,
      ...(category.value === "voice" && voiceId.value.trim() ? { voiceId: voiceId.value.trim() } : {}),
      ...(fullDescription ? { description: fullDescription } : {}),
    });
    for (const file of files.value) record = await uploadAssetFile(record.id, file, file.name);
    visible.value = false;
    ElMessage.success("已存为资产");
    emit("saved", record);
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message: string }>(error) ? error.response?.data.message || error.message : error instanceof Error ? error.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<style lang="scss" scoped>
.saveForm {
  .tagSelect { width: 100%; }
}

.generationSummary {
  white-space: pre-wrap;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small);
}

.fileList {
  .fileRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0;

    .fileName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--el-font-size-small);
    }

    .fileSize {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
      font-size: var(--el-font-size-small);
    }
  }
}
</style>
