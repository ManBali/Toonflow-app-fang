<template>
  <div class="usersPanel">
    <div class="panelActions">
      <el-button type="primary" :icon="IconUserPlus" @click="openCreate">新增用户</el-button>
    </div>
    <el-table v-loading="loading" :data="users" aria-label="用户列表">
      <el-table-column prop="username" label="用户名" minWidth="140" />
      <el-table-column prop="displayName" label="显示名" minWidth="140" />
      <el-table-column label="角色" width="110">
        <template #default="{ row }">
          <el-tag :type="row.role === 'admin' ? 'warning' : 'info'" size="small">{{ row.role === "admin" ? "管理员" : "普通用户" }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" minWidth="170">
        <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString(locale, { hour12: false }) }}</template>
      </el-table-column>
      <el-table-column label="最近登录" minWidth="170">
        <template #default="{ row }">{{ row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString(locale, { hour12: false }) : "从未登录" }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button text :icon="IconEdit" :aria-label="`编辑用户 ${row.username}`" @click="openEdit(row as authUser)">编辑</el-button>
          <el-button text type="danger" :icon="IconTrash" :disabled="row.id === authStore.user?.id" :aria-label="`删除用户 ${row.username}`" @click="confirmRemove(row as authUser)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="editorVisible" :title="editingId ? '编辑用户' : '新增用户'" width="min(440px, calc(100vw - 32px))" appendToBody :closeOnClickModal="false" @closed="resetEditor">
      <el-form :model="editorForm" labelWidth="80px">
        <el-form-item label="用户名">
          <el-input v-model="editorForm.username" :disabled="!!editingId" maxlength="32" placeholder="3-32 位字母、数字或下划线" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="editorForm.displayName" maxlength="40" placeholder="留空时与用户名相同" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="editorForm.role">
            <el-radio value="user">普通用户</el-radio>
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="editingId ? '重置密码' : '密码'">
          <el-input v-model="editorForm.password" type="password" showPassword maxlength="64" :placeholder="editingId ? '留空则不修改密码' : '至少 6 位'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconEdit, IconTrash, IconUserPlus } from "@tabler/icons-vue";
import { locale } from "@toonflow/i18n/vue";
import { useAuthStore, type authUser } from "@/stores/auth";

const authStore = useAuthStore();
const users = ref<authUser[]>([]);
const loading = ref(false);
const saving = ref(false);
const editorVisible = ref(false);
const editingId = ref("");
const editorForm = reactive({ username: "", displayName: "", role: "user" as "admin" | "user", password: "" });

onMounted(loadUsers);

async function loadUsers() {
  loading.value = true;
  try {
    const { data } = await axios.get("/api/users/list");
    if (data.code !== 200) throw new Error(data.message || "读取用户列表失败");
    users.value = data.data.users;
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "读取用户列表失败"
      : error instanceof Error ? error.message : "读取用户列表失败");
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = "";
  Object.assign(editorForm, { username: "", displayName: "", role: "user", password: "" });
  editorVisible.value = true;
}

function openEdit(record: authUser) {
  editingId.value = record.id;
  Object.assign(editorForm, { username: record.username, displayName: record.displayName, role: record.role, password: "" });
  editorVisible.value = true;
}

function resetEditor() {
  editingId.value = "";
  Object.assign(editorForm, { username: "", displayName: "", role: "user", password: "" });
}

async function saveUser() {
  if (saving.value) return;
  if (!editingId.value && !/^[a-zA-Z0-9_]{3,32}$/.test(editorForm.username)) return ElMessage.warning("用户名只能是 3-32 位字母、数字或下划线");
  if (!editingId.value && editorForm.password.length < 6) return ElMessage.warning("密码至少 6 位");
  if (editingId.value && editorForm.password && editorForm.password.length < 6) return ElMessage.warning("新密码至少 6 位");
  saving.value = true;
  try {
    const payload = editingId.value
      ? { id: editingId.value, displayName: editorForm.displayName, role: editorForm.role, password: editorForm.password || undefined }
      : { username: editorForm.username, displayName: editorForm.displayName || undefined, role: editorForm.role, password: editorForm.password };
    const { data } = await axios[editingId.value ? "put" : "post"](editingId.value ? "/api/users/update" : "/api/users/create", payload);
    if (data.code !== 200) throw new Error(data.message || "保存用户失败");
    ElMessage.success("用户已保存");
    editorVisible.value = false;
    await loadUsers();
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "保存用户失败"
      : error instanceof Error ? error.message : "保存用户失败");
  } finally {
    saving.value = false;
  }
}

async function confirmRemove(record: authUser) {
  const confirmed = await ElMessageBox.confirm(`确定删除用户“${record.displayName || record.username}”吗？删除后该账号无法登录。`, "删除用户", {
    confirmButtonText: "删除", cancelButtonText: "取消", type: "warning",
  }).then(() => true, () => false);
  if (!confirmed) return;
  try {
    const { data } = await axios.delete("/api/users/remove", { data: { id: record.id } });
    if (data.code !== 200) throw new Error(data.message || "删除用户失败");
    ElMessage.success("用户已删除");
    await loadUsers();
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data.message || "删除用户失败"
      : error instanceof Error ? error.message : "删除用户失败");
  }
}
</script>

<style lang="scss" scoped>
.usersPanel {
  display: flex;
  flex-direction: column;
  gap: 14px;

  .panelActions {
    display: flex;
    justify-content: flex-end;
  }
}
</style>
