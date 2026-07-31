import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BatchImportModal from '../BatchImportModal.vue'
import { adminAPI } from '@/api/admin'

const showError = vi.fn()
const showSuccess = vi.fn()
const showInfo = vi.fn()

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showError,
    showSuccess,
    showInfo
  })
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      importData: vi.fn()
    }
  }
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)
  })
}))

describe('BatchImportModal', () => {
  beforeEach(() => {
    showError.mockReset()
    showSuccess.mockReset()
    showInfo.mockReset()
    vi.mocked(adminAPI.accounts.importData).mockReset()
  })

  it('shows skipped message instead of success when all imported accounts already exist', async () => {
    vi.mocked(adminAPI.accounts.importData).mockResolvedValue({
      proxy_created: 0,
      proxy_reused: 0,
      proxy_failed: 0,
      account_created: 0,
      account_skipped: 1,
      account_failed: 0,
      warnings: [{ kind: 'account', name: 'existing', message: 'credential already exists, skipped' }]
    })

    const wrapper = mount(BatchImportModal, {
      props: { show: true },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    expect(wrapper.text()).not.toContain('OpenAI')

    const input = wrapper.find('input[type="file"]')
    const file = new File(['{"access_token":"tok","name":"existing"}'], 'account.json', {
      type: 'application/json'
    })
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve('{"access_token":"tok","name":"existing"}')
    })
    Object.defineProperty(input.element, 'files', {
      value: [file]
    })

    await input.trigger('change')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(adminAPI.accounts.importData).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accounts: [expect.objectContaining({ platform: 'anthropic', type: 'oauth' })]
        })
      })
    )
    expect(showInfo).toHaveBeenCalledWith('admin.accounts.batchImportAllSkipped:{"skipped":1}')
    expect(showSuccess).not.toHaveBeenCalled()
  })
})
