<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    :style="{ width: '320px' }">
    <div v-loading="generating" class="audioGenContent nopan" :aria-busy="generating">
      <audio v-if="previewUrl" class="audioPreview nodrag nowheel" :src="previewUrl" controls />
      <div v-else class="audioEmpty" role="img" aria-label="暂无生成音频">
        <icon-music :size="48" stroke="1.25" aria-hidden="true" />
      </div>
    </div>
    <template #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <referenceItem v-if="refList.length" v-model="refList" @remove="removeReference" />
        <promptInput v-model="data.promptModel" v-model:text="data.prompt" :references="referenceMentions" expandable />
        <el-input
          v-if="isVoice"
          v-model="data.voice"
          class="voiceInput"
          type="textarea"
          :rows="2"
          resize="none"
          maxlength="4000"
          placeholder="音色描述：角色声线、语气与风格，如「温柔自然的成年女声，标准普通话，语气亲切」"
          aria-label="音色描述" />
        <div class="promptFooter">
          <el-select
            v-model="data.model"
            class="modelSelect"
            filterable
            :loading="modelsLoading"
            :disabled="generating || deleting"
            placeholder="选择模型"
            aria-label="生成模型"
            noDataText="请先在设置中添加音频模型"
            placement="top-start"
            @visible-change="(visible) => visible && loadModels().catch((error) => showNodeError(error, '模型读取失败'))">
            <template #prefix><icon-sparkles :size="17" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option
                v-for="item in provider.models"
                :key="item.modelId"
                :label="item.label"
                :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <label v-if="isVoice" class="paramLabel">
            语速
            <el-input-number v-model="data.speed" :min="0.5" :max="2" :step="0.1" :precision="1" controlsPosition="right" :disabled="generating || deleting" aria-label="语速" />
          </label>
          <label v-else class="paramLabel">
            时长(秒)
            <el-input-number v-model="data.duration" :min="1" :max="120" :step="1" :precision="0" controlsPosition="right" :disabled="generating || deleting" aria-label="时长秒数" />
          </label>
          <el-button
            class="sendButton"
            :icon="generating ? IconPlayerStop : IconArrowUp"
            :disabled="deleting || (!generating && (!generationPrompt || !selectedModel))"
            :title="generating ? '停止生成' : '生成音频'"
            :aria-label="generating ? '停止生成' : '生成音频'"
            @click="generating ? generationController?.abort() : startGeneration().catch((error) => showNodeError(error, '音频生成失败'))" />
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import { ElButton, ElCard, ElSelect, ElOption, ElOptionGroup, ElInput, ElInputNumber, ElLoading } from "element-plus";
import { IconMusic, IconSparkles, IconArrowUp, IconPlayerStop } from "@tabler/icons-vue";
import { groupNodeModels, nodeSkeleton, showNodeError, useNode, useNodeGeneration, useNodeReferences, type NodeAudioRequest, type NodeHandle, type NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import promptInput from "@toonflow/nodes-scaffold/promptInput";
import referenceItem from "@toonflow/nodes-scaffold/referenceItem";

defineOptions({
  inheritAttrs: false,
  icon: IconMusic,
  handles: [
    { id: "in", type: "target", dataType: ["STRING"], label: "文本输入" },
    { id: "audio", type: "source", dataType: "AUDIO", label: "音频输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, outputs, files, ai } = useNode({
  label: "音频生成",
});
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { prompt: string; promptModel: PromptModel; model: string; voice: string; speed: number; duration: number });
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.model ??= "";
data.value.voice ??= "";
data.value.speed ??= 0.9;
data.value.duration ??= 10;
const { refList, referenceMentions, removeReference } = useNodeReferences();
const models = ref<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const deleting = ref(false);
let generationController: AbortController | undefined;
const generationState = useNodeGeneration(outputs, () => generationController?.abort());
const { generating } = generationState;
let modelsRequest: Promise<void> | undefined;
const selectedModel = computed(() => models.value.find((item) => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
const isVoice = computed(() => (selectedModel.value?.modelId ?? "").toLowerCase().includes("voicedesign"));
const modelGroups = computed(() => groupNodeModels(models.value));
const generationPrompt = computed(() =>
  [
    data.value.prompt.trim(),
    ...refList.value.flatMap((item, index) => (item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])),
  ]
    .filter(Boolean)
    .join("\n\n")
);
const outputFile = computed(() => outputs.value.audio?.dataType === "AUDIO" ? outputs.value.audio.value : undefined);
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showNodeError(error, "音频读取失败")
);

onMounted(() => loadModels().catch((error) => showNodeError(error, "模型读取失败")));
onScopeDispose(() => generationController?.abort());

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then((items) => {
    models.value = items.filter((item) => item.type === "audio");
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择及其参数。
    if (!data.value.model) {
      const first = models.value[0];
      data.value.model = first ? JSON.stringify([first.providerId, first.modelId]) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

async function startGeneration() {
  const choice = selectedModel.value;
  if (generating.value) throw new Error("音频正在生成，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (!choice) throw new Error("请先选择音频模型");
  if (!generationPrompt.value) throw new Error("请输入生成提示词");
  if (isVoice.value && !data.value.voice.trim()) throw new Error("请填写音色描述");
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  generationController = controller;
  // ACT: 工具立即返回，任务由节点持有，停止或卸载时取消。
  generationState.run(() => workspace
    .list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      return ai.generateAudio({
        directory,
        providerId: choice.providerId,
        modelId: choice.modelId,
        prompt: generationPrompt.value,
        outputDirectory: `assets/${id}`,
        ...(isVoice.value ? { voice: data.value.voice.trim(), speed: data.value.speed } : { duration: data.value.duration }),
      } satisfies NodeAudioRequest, controller.signal);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回音频");
      outputs.value.audio = { dataType: "AUDIO", value: { url: result.path, mimeType: result.mimeType } };
    }))
    .catch((error) => showNodeError(error, "音频生成失败"))
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating" };
}
</script>

<style scoped lang="scss">
.audioGenContent {
  display: flex;
  min-height: 96px;
  align-items: center;
  justify-content: center;

  .audioPreview {
    display: block;
    width: 100%;
  }

  .audioEmpty {
    padding: 20px 0;
    color: var(--el-text-color-placeholder);
  }
}

.promptCard {
  .voiceInput {
    margin-top: 8px;
  }

  .promptFooter {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;

    .modelSelect {
      flex: 1;
      min-width: 0;
    }

    .paramLabel {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      gap: 4px;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      .el-input-number {
        width: 104px;
      }
    }

    .sendButton {
      flex-shrink: 0;
    }
  }
}
</style>
