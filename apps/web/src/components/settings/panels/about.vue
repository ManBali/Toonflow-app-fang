<template>
  <div class="about">
    <div class="brand">
      <div class="brandMark"><img class="brandLogo" :src="logoUrl" alt="Catflow Logo" /></div>
      <div class="brandInfo">
        <h3>Catflow</h3>
        <div class="brandMeta">
          <span>v{{ currentVersion }}</span>
          <el-tag v-if="snapshot?.channel" type="info" size="small" round>{{ snapshot.channel }}</el-tag>
        </div>
      </div>
    </div>

    <el-card class="visionCard" shadow="never">
      <div class="visionLabel">
        <icon-sparkles :size="18" aria-hidden="true" />
        <span>Catflow 的愿望</span>
      </div>
      <p class="visionLead">Catflow 专为短视频与短剧团队打造，是一体化的 AI 视频创作平台。</p>
      <p class="visionBody">
        从一段故事灵感开始：AI 帮你拆解剧本、生成分镜、沉淀角色与场景资产，再批量生成画面与视频，最后在剪辑台上一键成片。
        创作像流水线一样在同一块画布上流转，编剧、美术、剪辑不必在多个工具之间来回切换，把时间还给创作本身。
      </p>
      <p class="visionSlogan">让每一个好故事，都能被更快地拍出来。</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { IconSparkles } from "@tabler/icons-vue";
import logoUrl from "@toonflow/assets/logo.svg";
import { desktopUpdateSnapshot as snapshot } from "@/stores/desktopUpdate";

const currentVersion = computed(() => snapshot.value?.version || import.meta.env.appVersion);
</script>

<style lang="scss" scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0 12px;

    .brandMark {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 60px;
      height: 60px;
      border-radius: calc(var(--ui-radius) * 1.5);
      background: var(--el-fill-color-light);

      .brandLogo {
        width: 42px;
        height: 42px;
        object-fit: contain;

        .dark & {
          filter: invert(1);
        }
      }
    }

    .brandInfo {
      min-width: 0;

      h3 {
        margin: 0 0 8px;
        color: var(--el-text-color-primary);
        font-size: 20px;
        font-weight: 600;
      }

      .brandMeta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }
    }
  }

  .visionCard {
    border-radius: calc(var(--ui-radius) * 1);

    :deep(.el-card__body) {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 18px;
    }

    .visionLabel {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--el-color-primary);
      font-size: 14px;
      font-weight: 600;
    }

    p {
      margin: 0;
      color: var(--el-text-color-regular);
      font-size: 13px;
      line-height: 1.8;
    }

    .visionLead {
      color: var(--el-text-color-primary);
      font-weight: 500;
    }

    .visionSlogan {
      padding-top: 4px;
      color: var(--el-color-primary);
      font-weight: 600;
    }
  }
}
</style>
