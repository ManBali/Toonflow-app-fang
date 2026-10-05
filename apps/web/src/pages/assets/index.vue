<template>
  <el-container class="assetPage">
    <el-header class="pageHeader">
      <div class="headerLeft">
        <el-button :icon="IconArrowLeft" text aria-label="返回" @click="router.push('/home')">返回</el-button>
        <h2 class="pageTitle">资产库</h2>
        <span class="pageTip">共享的项目资产：角色、场景、道具与声音，可在画布中拖拽复用</span>
      </div>
      <el-button type="primary" :icon="IconPlus" :disabled="busy" @click="pickFiles">新增资产</el-button>
      <input ref="fileInput" type="file" multiple hidden accept="image/*,audio/*,video/*" @change="addFiles" />
    </el-header>
    <el-main class="pageContent">
      <div class="assetToolbar">
        <el-radio-group v-model="category" aria-label="资产分类">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button v-for="(label, value) in assetCategoryLabels" :key="value" :value="value">{{ label }}</el-radio-button>
        </el-radio-group>
        <el-input v-model="search" class="searchInput" :prefixIcon="IconSearch" placeholder="搜索名称、描述或标签" aria-label="搜索资产" clearable @keydown.esc.stop="search = ''" />
      </div>
      <div v-if="loading" class="pageHint"><icon-loader-2 class="spinIcon" :size="22" /></div>
      <el-empty v-else-if="!filteredRecords.length" description="还没有资产。可以在画布生成节点菜单里「存为资产」，或在这里上传文件新增。" />
      <div v-else class="assetGrid">
        <div v-for="record in filteredRecords" :key="record.id" class="assetCard" :title="record.name">
          <span class="categoryBadge">{{ assetCategoryLabels[record.category] }}</span>
          <div class="cardMedia" @click="openPreview(record)">
            <el-image v-if="thumbnail(record)" class="assetThumb" :src="thumbnail(record)" fit="cover" loading="lazy">
              <template #error><icon-photo :size="26" /></template>
            </el-image>
            <span v-else class="thumbIcon">
              <icon-music v-if="audioFile(record)" :size="28" />
              <icon-video v-else-if="videoFile(record)" :size="28" />
              <icon-user v-else-if="record.category === 'character'" :size="28" />
              <icon-photo v-else :size="28" />
            </span>
          </div>
          <div class="cardBody">
            <span class="assetName" :title="record.name">{{ record.name }}</span>
            <span v-if="record.tags.length" class="assetTags" :title="record.tags.join(' / ')">{{ record.tags.join(" / ") }}</span>
          </div>
          <div class="cardActions">
            <el-button text size="small" :icon="IconPencil" :aria-label="`编辑 ${record.name}`" @click.stop="editRecord(record)">编辑</el-button>
            <el-button text size="small" type="danger" :icon="IconTrash" :aria-label="`删除 ${record.name}`" @click.stop="deleteRecord(record)">删除</el-button>
          </div>
        </div>
      </div>
    </el-main>
  </el-container>

  <saveDialog ref="saveRef" @saved="refresh" />
  <editDialog ref="editRef" @saved="refresh" />
  <el-image-viewer v-if="previewRecord?.id && imageFile(previewRecord)" :urlList="imageUrls(previewRecord)" teleported @close="previewRecord = undefined" />
  <el-dialog :modelValue="audioVisible" :title="previewRecord?.name" width="480px" alignCenter appendToBody destroyOnClose @update:modelValue="previewRecord = undefined">
    <template v-if="previewRecord && audioFile(previewRecord)">
      <audio style="display: block; width: 100%" :key="audioFile(previewRecord)!.name" :src="assetFileUrl(previewRecord.id, audioFile(previewRecord)!.name)" :aria-label="previewRecord.name" controls preload="metadata" />
    </template>
  </el-dialog>
  <el-dialog :modelValue="!!previewRecord && !!videoFile(previewRecord)" :title="previewRecord?.name" width="min(800px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose @update:modelValue="previewRecord = undefined">
    <template v-if="previewRecord && videoFile(previewRecord)">
      <video class="previewVideo" :key="videoFile(previewRecord)!.name" :src="assetFileUrl(previewRecord.id, videoFile(previewRecord)!.name)" :aria-label="previewRecord.name" controls playsinline preload="metadata" />
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconArrowLeft, IconMusic, IconPencil, IconPhoto, IconPlus, IconSearch, IconTrash, IconUser, IconVideo } from "@tabler/icons-vue";
import { assetCategoryLabels, assetFileUrl, assetErrorMessage, listAssets, removeAsset, type AssetRecord } from "@/lib/assetLibrary";
import saveDialog from "@/components/assetLibrary/saveDialog.vue";
import editDialog from "@/components/assetLibrary/editDialog.vue";

const router = useRouter();
const records = ref<AssetRecord[]>([]);
const loading = ref(false);
const category = ref("");
const search = ref("");
const previewRecord = ref<AssetRecord>();
const saveRef = ref<InstanceType<typeof saveDialog>>();
const editRef = ref<InstanceType<typeof editDialog>>();
const fileInput = ref<HTMLInputElement>();
const busy = ref(false);

const audioVisible = computed(() => !!previewRecord.value?.id && !imageFile(previewRecord.value) && !!audioFile(previewRecord.value) && !videoFile(previewRecord.value));

const filteredRecords = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return records.value.filter(record => (!category.value || record.category === category.value)
    && (!keyword || record.name.toLowerCase().includes(keyword) || record.description?.toLowerCase().includes(keyword)
      || record.tags.some(tag => tag.toLowerCase().includes(keyword))));
});

function imageFile(record: AssetRecord) {
  return record.files.find(file => file.mimeType.startsWith("image/"));
}
function audioFile(record?: AssetRecord) {
  return record?.files.find(file => file.mimeType.startsWith("audio/"));
}
function videoFile(record?: AssetRecord) {
  return record?.files.find(file => file.mimeType.startsWith("video/"));
}
function thumbnail(record: AssetRecord) {
  const file = imageFile(record);
  return file ? assetFileUrl(record.id, file.name) : "";
}
function imageUrls(record: AssetRecord) {
  return record.files.filter(file => file.mimeType.startsWith("image/")).map(file => assetFileUrl(record.id, file.name));
}

async function refresh() {
  loading.value = true;
  try { records.value = await listAssets(); }
  catch (error) { ElMessage.error(assetErrorMessage(error, "资产列表加载失败")); }
  finally { loading.value = false; }
}

function openPreview(record: AssetRecord) {
  previewRecord.value = record;
}

function pickFiles() {
  fileInput.value?.click();
}

function addFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length) return;
  const baseName = files[0]!.name.replace(/\.[^.]+$/, "");
  saveRef.value?.open({ name: files.length > 1 ? baseName : baseName, files });
}

function editRecord(record: AssetRecord) {
  editRef.value?.open(record);
}

async function deleteRecord(record: AssetRecord) {
  try {
    await ElMessageBox.confirm(`确定删除资产「${record.name}」？删除后无法恢复。`, "删除资产", { type: "warning" });
  } catch { return; }
  busy.value = true;
  try {
    await removeAsset(record.id);
    ElMessage.success("资产已删除");
    await refresh();
  } catch (error) {
    ElMessage.error(assetErrorMessage(error, "删除失败"));
  } finally {
    busy.value = false;
  }
}

onMounted(refresh);
</script>

<style lang="scss" scoped>
.assetPage {
  height: 100dvh;

  .pageHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;

    .headerLeft {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;

      .pageTitle { margin: 0; font-size: var(--el-font-size-large); }

      .pageTip {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--el-text-color-secondary);
        font-size: var(--el-font-size-small);
      }
    }
  }

  .pageContent {
    display: flex;
    flex-direction: column;
    gap: 16px;

    .assetToolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;

      .searchInput { width: min(320px, 100%); }
    }

    .pageHint {
      padding: 48px 0;
      text-align: center;
      color: var(--el-text-color-secondary);
    }

    .assetGrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }
  }
}

.assetCard {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  transition: border-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: var(--el-color-primary);
    box-shadow: var(--el-box-shadow-light);

    .cardActions { opacity: 1; }
  }

  .categoryBadge {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 1;
    padding: 1px 8px;
    border-radius: var(--el-border-radius-small);
    background: var(--el-mask-color);
    font-size: 12px;
  }

  .cardMedia {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 150px;
    cursor: pointer;
    background: var(--el-fill-color-light);

    .assetThumb { width: 100%; height: 100%; }

    .thumbIcon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--el-text-color-secondary);
    }
  }

  .cardBody {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px 4px;

    .assetName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--el-font-size-base);
    }

    .assetTags {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      min-height: 16px;
    }
  }

  .cardActions {
    display: flex;
    justify-content: flex-end;
    padding: 0 6px 6px;
    opacity: 0;
    transition: opacity 0.2s;

    .el-button { margin-left: 0; }
  }
}

.previewVideo {
  display: block;
  width: 100%;
  max-height: 65dvh;
  background: #000;
}

.spinIcon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
