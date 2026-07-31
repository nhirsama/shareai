<template>
  <BaseDialog
    :show="show"
    :title="t('admin.accounts.batchImportTitle')"
    width="normal"
    close-on-click-outside
    @close="handleClose"
  >
    <form id="batch-import-form" class="space-y-4" @submit.prevent="handleImport">
      <div class="text-sm text-gray-600 dark:text-dark-300">
        {{ t('admin.accounts.batchImportHint') }}
      </div>

      <!-- Platform Selection -->
      <div>
        <label class="input-label">{{ t('admin.accounts.platform') }}</label>
        <div class="mt-2 flex rounded-lg bg-gray-100 p-1 dark:bg-dark-700">
          <button
            v-for="p in platforms"
            :key="p.value"
            type="button"
            @click="platform = p.value"
            :class="[
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all',
              platform === p.value
                ? 'bg-white shadow-sm dark:bg-dark-600 ' + p.activeClass
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            ]"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <!-- Account Type Selection -->
      <div>
        <label class="input-label">{{ t('admin.accounts.accountType') }}</label>
        <select v-model="accountType" class="input mt-1">
          <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <!-- File Picker -->
      <div>
        <label class="input-label">{{ t('admin.accounts.batchImportFiles') }}</label>
        <div
          class="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 dark:border-dark-600 dark:bg-dark-800"
        >
          <div class="min-w-0">
            <div class="truncate text-sm text-gray-700 dark:text-dark-200">
              {{ filesLabel }}
            </div>
            <div class="text-xs text-gray-500 dark:text-dark-400">JSON / JSONL</div>
          </div>
          <button type="button" class="btn btn-secondary shrink-0" @click="openFilePicker">
            {{ t('common.chooseFile') }}
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept=".json,.jsonl"
          multiple
          @change="handleFileChange"
        />
      </div>

      <!-- Parse Errors -->
      <div
        v-if="parseErrors.length"
        class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-600 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
      >
        <div class="max-h-32 overflow-auto">
          <div v-for="(err, idx) in displayErrors" :key="idx">{{ err.filename }}: {{ err.message }}</div>
        </div>
        <div v-if="parseTotalErrors > parseErrors.length" class="mt-1 font-medium">
          ... {{ t('admin.accounts.batchImportErrorsTruncated', { total: parseTotalErrors }) }}
        </div>
      </div>

      <!-- Result -->
      <div
        v-if="result"
        class="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-dark-700"
      >
        <div class="text-sm font-medium text-gray-900 dark:text-white">
          {{ t('admin.accounts.batchImportResult') }}
        </div>
        <div class="text-sm text-gray-700 dark:text-dark-300">
          {{ t('admin.accounts.batchImportResultSummary', { created: result.account_created, skipped: result.account_skipped, failed: result.account_failed }) }}
        </div>
        <div v-if="result.errors?.length" class="mt-2">
          <div class="text-sm font-medium text-red-600 dark:text-red-400">
            {{ t('admin.accounts.batchImportErrors') }}
          </div>
          <div class="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-50 p-3 font-mono text-xs dark:bg-dark-800">
            <div v-for="(item, idx) in result.errors" :key="idx" class="whitespace-pre-wrap">
              {{ item.name || '-' }} — {{ item.message }}
            </div>
          </div>
        </div>
        <div v-if="result.warnings?.length" class="mt-2">
          <div class="text-sm font-medium text-amber-600 dark:text-amber-400">
            {{ t('admin.accounts.batchImportWarnings') }}
          </div>
          <div class="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-50 p-3 font-mono text-xs dark:bg-dark-800">
            <div v-for="(item, idx) in result.warnings" :key="idx" class="whitespace-pre-wrap">
              {{ item.name || '-' }} — {{ item.message }}
            </div>
          </div>
        </div>
      </div>
    </form>

    <template #footer>
      <div class="flex justify-end gap-3">
        <button class="btn btn-secondary" type="button" :disabled="importing" @click="handleClose">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn btn-primary"
          type="submit"
          form="batch-import-form"
          :disabled="importing || files.length === 0"
        >
          {{ importing ? t('admin.accounts.batchImporting') : t('admin.accounts.batchImportButton') }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { adminAPI } from '@/api/admin'
import { useAppStore } from '@/stores/app'
import { parseImportFiles } from '@/utils/accountImportParser'
import { extractApiErrorMessage } from '@/utils/apiError'
import type { CredentialImportPlatform } from '@/utils/accountImportParser'
import type { AccountType, AdminDataImportResult } from '@/types'

interface Props {
  show: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'imported'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()
const appStore = useAppStore()

const platform = ref<CredentialImportPlatform>('anthropic')
const accountType = ref<AccountType>('oauth')
const files = ref<File[]>([])
const importing = ref(false)
const result = ref<AdminDataImportResult | null>(null)
const parseErrors = ref<{ filename: string; message: string }[]>([])
const parseTotalErrors = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)

const platforms = [
  { value: 'anthropic' as const, label: 'Anthropic', activeClass: 'text-orange-600 dark:text-orange-400' },
  { value: 'gemini' as const, label: 'Gemini', activeClass: 'text-blue-600 dark:text-blue-400' },
  { value: 'antigravity' as const, label: 'Antigravity', activeClass: 'text-purple-600 dark:text-purple-400' }
]

const typeOptions = computed(() => {
  switch (platform.value) {
    case 'anthropic':
      return [
        { value: 'oauth', label: 'OAuth' },
        { value: 'setup-token', label: 'Setup Token' }
      ]
    case 'gemini':
      return [{ value: 'oauth', label: 'OAuth' }]
    case 'antigravity':
      return [{ value: 'oauth', label: 'OAuth' }]
    default:
      return [{ value: 'oauth', label: 'OAuth' }]
  }
})

const filesLabel = computed(() => {
  if (files.value.length === 0) return t('admin.accounts.batchImportSelectFiles')
  return t('admin.accounts.batchImportFilesSelected', { count: files.value.length })
})

const displayErrors = computed(() => parseErrors.value.slice(0, 100))

watch(
  () => props.show,
  (open) => {
    if (open) {
      files.value = []
      result.value = null
      parseErrors.value = []
      parseTotalErrors.value = 0
      if (fileInput.value) fileInput.value.value = ''
    }
  }
)

watch(platform, () => {
  const validTypes = typeOptions.value.map((o) => o.value)
  if (!validTypes.includes(accountType.value)) {
    accountType.value = validTypes[0] as AccountType
  }
})

const openFilePicker = () => fileInput.value?.click()

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  files.value = target.files ? Array.from(target.files) : []
}

const handleClose = () => {
  if (importing.value) return
  emit('close')
}

const readFileAsText = async (file: File): Promise<string> => {
  if (typeof file.text === 'function') return file.text()
  const buffer = await file.arrayBuffer()
  return new TextDecoder().decode(buffer)
}

const handleImport = async () => {
  if (files.value.length === 0) {
    appStore.showError(t('admin.accounts.batchImportNoFiles'))
    return
  }

  importing.value = true
  result.value = null
  parseErrors.value = []
  parseTotalErrors.value = 0

  try {
    const MAX_TOTAL_SIZE = 50 * 1024 * 1024
    const totalSize = files.value.reduce((sum, f) => sum + f.size, 0)
    if (totalSize > MAX_TOTAL_SIZE) {
      appStore.showError(t('admin.accounts.batchImportTotalTooLarge'))
      return
    }

    const fileInputs = await Promise.all(
      files.value.map(async (f) => ({
        filename: f.name,
        content: await readFileAsText(f)
      }))
    )

    const parsed = parseImportFiles(fileInputs, platform.value, accountType.value)
    parseErrors.value = parsed.errors
    parseTotalErrors.value = parsed.totalErrors

    if (parsed.accounts.length === 0) {
      appStore.showError(t('admin.accounts.batchImportNoAccounts'))
      return
    }

    const res = await adminAPI.accounts.importData({
      data: {
        type: 'sub2api-data',
        version: 1,
        exported_at: new Date().toISOString(),
        proxies: [],
        accounts: parsed.accounts
      },
      skip_default_group_bind: true
    })

    result.value = res

    if (res.account_failed > 0) {
      appStore.showError(t('admin.accounts.batchImportCompletedWithErrors', { failed: res.account_failed }))
      if (res.account_created > 0) {
        emit('imported')
      }
    } else if (res.account_created > 0) {
      appStore.showSuccess(t('admin.accounts.batchImportSuccess', { created: res.account_created }))
      emit('imported')
    } else if (res.account_skipped > 0) {
      appStore.showInfo(t('admin.accounts.batchImportAllSkipped', { skipped: res.account_skipped }))
    } else {
      appStore.showError(t('admin.accounts.batchImportNoAccounts'))
    }
  } catch (error: unknown) {
    appStore.showError(extractApiErrorMessage(error, t('admin.accounts.batchImportFailed')))
  } finally {
    importing.value = false
  }
}
</script>
