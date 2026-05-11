import { describe, expect, it } from 'vitest'
import { parseImportFiles } from '../accountImportParser'

describe('parseImportFiles', () => {
  describe('JSON parsing', () => {
    it('parses a single JSON object', () => {
      const result = parseImportFiles(
        [{ filename: 'test.json', content: '{"access_token": "tok_123", "name": "alice"}' }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(1)
      expect(result.accounts[0].credentials).toEqual({ access_token: 'tok_123' })
      expect(result.accounts[0].name).toBe('alice')
    })

    it('parses a JSON array', () => {
      const content = JSON.stringify([
        { access_token: 'tok_1', name: 'user1' },
        { access_token: 'tok_2', name: 'user2' }
      ])
      const result = parseImportFiles(
        [{ filename: 'batch.json', content }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(2)
      expect(result.accounts[0].name).toBe('user1')
      expect(result.accounts[1].name).toBe('user2')
    })

    it('parses JSONL format', () => {
      const content = '{"access_token":"a","name":"u1"}\n{"access_token":"b","name":"u2"}'
      const result = parseImportFiles(
        [{ filename: 'data.jsonl', content }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(2)
    })

    it('reports skipped lines in JSONL', () => {
      const content = '{"access_token":"a"}\nnot json\n{"access_token":"b"}'
      const result = parseImportFiles(
        [{ filename: 'mixed.jsonl', content }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(2)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toContain('1 line(s) skipped')
    })

    it('reports empty file', () => {
      const result = parseImportFiles(
        [{ filename: 'empty.json', content: '  ' }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
      expect(result.errors[0].message).toContain('Empty')
    })

    it('reports invalid JSON', () => {
      const result = parseImportFiles(
        [{ filename: 'bad.json', content: '[{broken' }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
    })
  })

  describe('data type: sub2api-data', () => {
    it('uses correct type string for backend', () => {
      const result = parseImportFiles(
        [{ filename: 'test.json', content: '{"access_token":"tok"}' }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].platform).toBe('openai')
      expect(result.accounts[0].type).toBe('oauth')
    })
  })

  describe('name extraction', () => {
    it('prefers name over email', () => {
      const result = parseImportFiles(
        [{ filename: 'f.json', content: '{"access_token":"t","name":"Alice","email":"a@b.com"}' }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].name).toBe('Alice')
    })

    it('falls back to email', () => {
      const result = parseImportFiles(
        [{ filename: 'f.json', content: '{"access_token":"t","email":"a@b.com"}' }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].name).toBe('a@b.com')
    })

    it('falls back to filename without extension', () => {
      const result = parseImportFiles(
        [{ filename: 'myaccount.json', content: '{"access_token":"t"}' }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].name).toBe('myaccount')
    })

    it('truncates name to 100 chars', () => {
      const longName = 'a'.repeat(150)
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify({ access_token: 't', name: longName }) }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].name).toHaveLength(100)
    })
  })

  describe('OpenAI credentials', () => {
    it('extracts nested tokens format', () => {
      const content = JSON.stringify({
        tokens: { access_token: 'at', refresh_token: 'rt', id_token: 'it' },
        name: 'user'
      })
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].credentials).toEqual({
        access_token: 'at',
        refresh_token: 'rt',
        id_token: 'it'
      })
    })

    it('extracts flat format', () => {
      const content = JSON.stringify({ access_token: 'at', refresh_token: 'rt' })
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].credentials).toEqual({
        access_token: 'at',
        refresh_token: 'rt'
      })
    })

    it('skips entry without access_token', () => {
      const result = parseImportFiles(
        [{ filename: 'f.json', content: '{"refresh_token":"rt","name":"x"}' }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
      expect(result.skipped).toBe(1)
    })
  })

  describe('Anthropic credentials', () => {
    it('extracts sessionKey as access_token', () => {
      const content = JSON.stringify({ sessionKey: 'sk-ant-xxx', name: 'claude-user' })
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'anthropic',
        'oauth'
      )
      expect(result.accounts[0].credentials).toEqual({ access_token: 'sk-ant-xxx' })
    })

    it('extracts organization_id', () => {
      const content = JSON.stringify({ access_token: 'at', organization_id: 'org-1' })
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'anthropic',
        'oauth'
      )
      expect(result.accounts[0].credentials.organization_id).toBe('org-1')
    })

    it('setup-token stores as access_token', () => {
      const content = JSON.stringify({ setup_token: 'st-123' })
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'anthropic',
        'setup-token'
      )
      expect(result.accounts[0].credentials).toEqual({ access_token: 'st-123' })
    })
  })

  describe('credentials sub-object support', () => {
    it('reads from credentials.access_token (own export format)', () => {
      const content = JSON.stringify({
        name: 'exported-account',
        credentials: { access_token: 'at-from-creds', refresh_token: 'rt-from-creds' }
      })
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].credentials.access_token).toBe('at-from-creds')
      expect(result.accounts[0].credentials.refresh_token).toBe('rt-from-creds')
    })
  })

  describe('DataAccount passthrough normalization', () => {
    it('passes through complete AdminDataAccount format with valid values', () => {
      const account = {
        name: 'full-account',
        platform: 'openai',
        type: 'oauth',
        credentials: { access_token: 'tok' },
        concurrency: 5,
        priority: 80
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].name).toBe('full-account')
      expect(result.accounts[0].concurrency).toBe(5)
      expect(result.accounts[0].priority).toBe(80)
    })

    it('clamps concurrency=0 to minimum 1', () => {
      const account = {
        name: 'zero-conc',
        platform: 'openai',
        type: 'oauth',
        credentials: { access_token: 'tok' },
        concurrency: 0,
        priority: 50
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].concurrency).toBe(1)
    })

    it('clamps negative concurrency to 1', () => {
      const account = {
        name: 'neg-conc',
        platform: 'openai',
        type: 'oauth',
        credentials: { access_token: 'tok' },
        concurrency: -5,
        priority: 50
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].concurrency).toBe(1)
    })

    it('defaults concurrency when missing', () => {
      const account = {
        name: 'no-conc',
        platform: 'openai',
        type: 'oauth',
        credentials: { access_token: 'tok' }
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].concurrency).toBe(3)
    })

    it('rejects invalid platform', () => {
      const account = {
        name: 'bad-plat',
        platform: 'invalid',
        type: 'oauth',
        credentials: { access_token: 'tok' }
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
      expect(result.skipped).toBe(1)
    })

    it('rejects invalid type', () => {
      const account = {
        name: 'bad-type',
        platform: 'openai',
        type: 'invalid',
        credentials: { access_token: 'tok' }
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
      expect(result.skipped).toBe(1)
    })

    it('truncates long name in passthrough', () => {
      const account = {
        name: 'a'.repeat(150),
        platform: 'openai',
        type: 'oauth',
        credentials: { access_token: 'tok' },
        concurrency: 3,
        priority: 50
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].name).toHaveLength(100)
    })

    it('does not treat array credentials as DataAccount format', () => {
      const account = {
        name: 'arr-creds',
        platform: 'openai',
        type: 'oauth',
        credentials: ['not', 'valid']
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
    })

    it('does not treat empty credentials as DataAccount format', () => {
      const account = {
        name: 'empty-creds',
        platform: 'openai',
        type: 'oauth',
        credentials: {}
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
    })

    it('strips proxy_key from passthrough accounts', () => {
      const account = {
        name: 'with-proxy',
        platform: 'openai',
        type: 'oauth',
        credentials: { access_token: 'tok' },
        concurrency: 3,
        priority: 50,
        proxy_key: 'some-proxy'
      }
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify(account) }],
        'openai',
        'oauth'
      )
      expect(result.accounts[0].proxy_key).toBeUndefined()
    })
  })

  describe('AdminDataPayload wrapper', () => {
    it('expands accounts from payload wrapper', () => {
      const payload = {
        type: 'sub2api-data',
        version: 1,
        exported_at: '2026-01-01T00:00:00Z',
        proxies: [],
        accounts: [
          { name: 'acc1', platform: 'openai', type: 'oauth', credentials: { access_token: 'a' }, concurrency: 3, priority: 50 },
          { name: 'acc2', platform: 'openai', type: 'oauth', credentials: { access_token: 'b' }, concurrency: 3, priority: 50 }
        ]
      }
      const result = parseImportFiles(
        [{ filename: 'export.json', content: JSON.stringify(payload) }],
        'openai',
        'oauth'
      )
      expect(result.accounts).toHaveLength(2)
      expect(result.accounts[0].name).toBe('acc1')
      expect(result.accounts[1].name).toBe('acc2')
    })
  })

  describe('error limiting', () => {
    it('caps errors at 100 but reports totalErrors', () => {
      const entries = Array.from({ length: 200 }, (_, i) => ({ bad_field: i }))
      const content = JSON.stringify(entries)
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'openai',
        'oauth'
      )
      expect(result.errors.length).toBeLessThanOrEqual(100)
      expect(result.totalErrors).toBe(200)
      expect(result.skipped).toBe(200)
    })
  })
})
