<template>
  <el-card v-if="visible" class="assetPanel" shadow="never" :bodyStyle="{ padding: '8px' }" role="region" aria-label="资产库" @dblclick.stop>
    <div class="panelToolbar">
      <el-select v-model="category" class="categorySelect" aria-label="资产分类" :disabled="loading">
        <el-option label="全部" value="" />
        <el-option v-for="(label, value) in assetCategoryLabels" :key="value" :label="label" :value="value" />
      </el-select>
      <el-input v-model="search" class="searchInput" :prefixIcon="IconSearch" placeholder="搜索资产" aria-label="搜索资产" clearable @keydown.esc.stop="search = ''" />
      <el-button class="toolbarButton" text :icon="IconX" title="关闭资产库" aria-label="关闭资产库" @click="visible = false" />
    </div>
    <el-scrollbar class="panelScroll" maxHeight="min(440px, calc(100dvh - 198px))">
      <div v-if="loading" class="panelHint"><icon-loader-2 class="spinIcon" :size="20" /></div>
      <div v-else-if="!filteredRecords.length" class="panelHint">暂无资产，生成节点菜单里选"存为资产"即可入库</div>
      <div v-else class="assetGrid">
        <div v-for="record in filteredRecords" :key="record.id" class="assetCard" :title="record.name" draggable="true"
          @dragstart.stop="startAssetRecordDrag($event, record)" @click="openPreview(record)">
          <span class="categoryBadge">{{ assetCategoryLabels[record.category] }}</span>
          <el-image v-if="thumbnail(record)" class="assetThumb" :src="thumbnail(record)" fit="cover" loading="lazy" draggable="false">
            <template #error><icon-photo :size="22" /></template>
          </el-image>
          <span v-else class="thumbIcon">
            <icon-music v-if="audioFile(record)" :size="24" />
            <icon-video v-else-if="videoFile(record)" :size="24" />
            <icon-user v-else-if="record.category === 'character'" :size="24" />
            <icon-photo v-else :size="24" />
          </span>
          <span class="assetName">{{ record.name }}</span>
          <span v-if="record.tags.length" class="assetTags">{{ record.tags.slice(0, 3).join(" / ") }}</span>
        </div>
      </div>
    </el-scrollbar>
    <div v-if="previewRecord && (audioFile(previewRecord) || (previewRecord.category === 'voice' && !imageFile(previewRecord) && !videoFile(previewRecord)))" class="audioPreview">
      <div class="audioHeader">
        <span :title="previewRecord.name">{{ previewRecord.name }}</span>
        <el-button text :icon="IconX" aria-label="关闭音频预览" @click="previewRecord = undefined" />
      </div>
      <audio v-if="audioFile(previewRecord)" :key="audioFile(previewRecord)!.name" :src="assetFileUrl(previewRecord.id, audioFile(previewRecord)!.name)" :aria-label="previewRecord.name" controls preload="metadata" />
    </div>
  </el-card>

  <el-image-viewer v-if="previewRecord?.id && imageFile(previewRecord)" :urlList="imageUrls(previewRecord)" teleported @close="previewRecord = undefined" />

  <el-dialog :modelValue="!!previewRecord && !imageFile(previewRecord) && !audioFile(previewRecord) && !!videoFile(previewRecord)"
    :title="previewRecord?.name" width="min(800px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose @update:modelValue="previewRecord = undefined">
    <template v-if="previewRecord && videoFile(previewRecord)">
      <video class="previewVideo" :key="videoFile(previewRecord)!.name" :src="assetFileUrl(previewRecord.id, videoFile(previewRecord)!.name)" :aria-label="previewRecord.name" controls playsinline preload="metadata" />
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { IconMusic, IconPhoto, IconSearch, IconUser, IconVideo, IconX } from "@tabler/icons-vue";
import { assetCategoryLabels, assetFileUrl, listAssets, type AssetRecord } from "@/lib/assetLibrary";
import { startAssetRecordDrag } from "../canvasDrop";

const visible = defineModel<boolean>({ default: false });
const records = ref<AssetRecord[]>([]);
const loading = ref(false);
const category = ref("");
const search = ref("");
const previewRecord = ref<AssetRecord>();
let loadRequest = 0;
onBeforeUnmount(() => { loadRequest++; });

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
  const request = ++loadRequest;
  loading.value = true;
  try {
    const assets = await listAssets();
    if (request === loadRequest) records.value = assets;
  } finally {
    if (request === loadRequest) loading.value = false;
  }
}

function openPreview(record: AssetRecord) {
  if (imageFile(record) || videoFile(record) || audioFile(record)) previewRecord.value = record;
}

watch(visible, opened => {
  if (opened) refresh().catch(() => {});
  else previewRecord.value = undefined;
});

defineExpose({ refresh });
</script>

<style lang="scss" scoped>
.assetPanel {
  width: min(360px, calc(100vw - 30px));
  max-height: calc(100dvh - 140px);

  :deep(.el-card__body) {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    box-sizing: border-box;
  }
}

.panelToolbar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  height: 32px;
  margin-bottom: 8px;

  .categorySelect { width: 88px; flex-shrink: 0; }
  .searchInput { flex: 1; min-width: 0; }

  .toolbarButton {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    margin: 0;
    padding: 0;
  }
}

.panelScroll { min-height: 0; }

.panelHint {
  padding: 24px 8px;
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small);
  text-align: center;
}

.spinIcon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.assetGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;

  .assetCard {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    cursor: grab;
    transition: border-color 0.2s;

    &:hover { border-color: var(--el-color-primary); }

    .categoryBadge {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 1;
      padding: 1px 6px;
      border-radius: var(--el-border-radius-small);
      background: var(--el-mask-color);
      color: var(--el-text-color-primary);
      font-size: 12px;
    }

    .assetThumb,
    .thumbIcon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 78px;
      border-radius: var(--el-border-radius-small);
      color: var(--el-text-color-secondary);
      background: var(--el-fill-color-light);
    }

    .assetName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--el-font-size-small);
    }

    .assetTags {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }
}

.audioPreview {
  flex-shrink: 0;
  margin-top: 8px;

  .audioHeader {
    display: flex;
    align-items: center;
    gap: 8px;

    span {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--el-font-size-small);
    }
  }

  audio { display: block; width: 100%; }
}

.previewVideo {
  display: block;
  width: 100%;
  max-height: 65dvh;
  background: #000;
}
</style>
