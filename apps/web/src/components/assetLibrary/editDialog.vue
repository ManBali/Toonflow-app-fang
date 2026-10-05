<template>
  <el-dialog v-model="visible" title="编辑资产" width="520px" alignCenter appendToBody :closeOnClickModal="false" @opened="nameInput?.select()">
    <el-form class="editForm" labelPosition="top" @submit.prevent="confirm">
      <el-form-item label="资产名称">
        <el-input ref="nameInput" v-model="name" aria-label="资产名称" :disabled="saving" @keydown.enter.prevent="confirm" />
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
        <el-input v-model="voiceId" aria-label="音色 ID" :disabled="saving" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="description" type="textarea" :rows="3" aria-label="描述" :disabled="saving" />
      </el-form-item>
    </el-form>
    <div class="fileManage">
      <div class="fileManageHeader">
        <span>资产文件</span>
        <el-button text :icon="IconPlus" :disabled="saving" aria-label="添加文件" @click="fileInput?.click()">添加文件</el-button>
        <input ref="fileInput" type="file" multiple hidden accept="image/*,audio/*,video/*" @change="addFiles" />
      </div>
      <div v-for="file in draftFiles" :key="file.name" class="fileRow">
        <span class="fileName" :title="file.name">{{ file.name }}</span>
        <el-input v-model="file.label" class="fileLabel" size="small" placeholder="用途标注" :disabled="saving" @click.stop />
        <el-button text type="danger" :icon="IconTrash" :disabled="saving" :aria-label="`删除 ${file.name}`" @click="removeFile(file)" />
      </div>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!name.trim()" @click="confirm">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import { IconPlus, IconTrash } from "@tabler/icons-vue";
import { assetCategoryLabels, removeAsset, updateAsset, uploadAssetFile, type AssetLibraryFile, type AssetRecord } from "@/lib/assetLibrary";

const visible = ref(false);
const saving = ref(false);
const name = ref("");
const category = ref<AssetRecord["category"]>("character");
const tags = ref<string[]>([]);
const voiceId = ref("");
const description = ref("");
const record = ref<AssetRecord>();
const draftFiles = ref<(AssetLibraryFile & { label?: string })[]>([]);
const pendingFiles = ref<File[]>([]);
const nameInput = ref<InputInstance>();
const fileInput = ref<HTMLInputElement>();
const emit = defineEmits<{ saved: [record: AssetRecord] }>();

function open(source: AssetRecord) {
  record.value = source;
  name.value = source.name;
  category.value = source.category;
  tags.value = [...source.tags];
  voiceId.value = source.voiceId ?? "";
  description.value = source.description ?? "";
  draftFiles.value = source.files.map(file => ({ ...file }));
  pendingFiles.value = [];
  saving.value = false;
  visible.value = true;
}

function addFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files ?? [])) {
    if (!draftFiles.value.some(entry => entry.name === file.name)) {
      draftFiles.value.push({ name: file.name, mimeType: file.type || "application/octet-stream" });
      pendingFiles.value.push(file);
    }
  }
  input.value = "";
}

async function removeFile(file: { name: string }) {
  if (!record.value) return;
  try {
    await ElMessageBox.confirm(`确定删除资产文件「${file.name}」？`, "删除文件", { type: "warning" });
  } catch { return; }
  try {
    await removeAsset(record.value.id, file.name);
    draftFiles.value = draftFiles.value.filter(entry => entry.name !== file.name);
    pendingFiles.value = pendingFiles.value.filter(entry => entry.name !== file.name);
    ElMessage.success("文件已删除");
    emit("saved", { ...record.value, files: draftFiles.value });
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message: string }>(error) ? error.response?.data.message || error.message : "删除失败");
  }
}

async function confirm() {
  const assetName = name.value.trim();
  if (!assetName || !record.value || saving.value) return;
  saving.value = true;
  try {
    const uploaded: AssetLibraryFile[] = [];
    for (const file of pendingFiles.value) {
      const saved = await uploadAssetFile(record.value.id, file, file.name);
      uploaded.push(...saved.files.filter(entry => entry.name === file.name));
    }
    const files = draftFiles.value.map(file => ({ name: file.name, mimeType: file.mimeType, ...(file.label?.trim() ? { label: file.label.trim() } : {}) }));
    const updated = await updateAsset(record.value.id, {
      name: assetName,
      category: category.value,
      tags: tags.value,
      description: description.value.trim(),
      ...(category.value === "voice" && voiceId.value.trim() ? { voiceId: voiceId.value.trim() } : { voiceId: undefined }),
      files,
    });
    visible.value = false;
    ElMessage.success("资产已更新");
    emit("saved", updated);
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message: string }>(error) ? error.response?.data.message || error.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<style lang="scss" scoped>
.editForm {
  .tagSelect { width: 100%; }
}

.fileManage {
  .fileManageHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
    color: var(--el-text-color-regular);
  }

  .fileRow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;

    .fileName {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--el-font-size-small);
    }

    .fileLabel {
      width: 120px;
      flex-shrink: 0;
    }
  }
}
</style>
