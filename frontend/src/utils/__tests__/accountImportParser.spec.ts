import { describe, expect, it } from 'vitest'
import { parseImportFiles } from '../accountImportParser'

describe('parseImportFiles', () => {
  describe('JSON parsing', () => {
    it('parses a single JSON object', () => {
      const result = parseImportFiles(
        [{ filename: 'test.json', content: '{"access_token": "tok_123", "name": "alice"}' }],
        'gemini',
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
        'gemini',
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
        'gemini',
        'oauth'
      )
      expect(result.accounts).toHaveLength(2)
    })

    it('reports skipped lines in JSONL', () => {
      const content = '{"access_token":"a"}\nnot json\n{"access_token":"b"}'
      const result = parseImportFiles(
        [{ filename: 'mixed.jsonl', content }],
        'gemini',
        'oauth'
      )
      expect(result.accounts).toHaveLength(2)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toContain('1 line(s) skipped')
    })

    it('reports empty file', () => {
      const result = parseImportFiles(
        [{ filename: 'empty.json', content: '  ' }],
        'gemini',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
      expect(result.errors[0].message).toContain('Empty')
    })

    it('reports invalid JSON', () => {
      const result = parseImportFiles(
        [{ filename: 'bad.json', content: '[{broken' }],
        'gemini',
        'oauth'
      )
      expect(result.accounts).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
    })
  })

  describe('normalized accounts', () => {
    it('uses correct type string for backend', () => {
      const result = parseImportFiles(
        [{ filename: 'test.json', content: '{"access_token":"tok"}' }],
        'gemini',
        'oauth'
      )
      expect(result.accounts[0].platform).toBe('gemini')
      expect(result.accounts[0].type).toBe('oauth')
    })

    it('leaves Sub2API export bundles to the standard data importer', () => {
      const payload = {
        type: 'sub2api-data',
        version: 1,
        proxies: [],
        accounts: [
          { name: 'account', platform: 'gemini', type: 'oauth', credentials: { access_token: 'tok' } }
        ]
      }
      const result = parseImportFiles(
        [{ filename: 'export.json', content: JSON.stringify(payload) }],
        'gemini',
        'oauth'
      )

      expect(result.accounts).toHaveLength(0)
      expect(result.skipped).toBe(1)
    })
  })

  describe('name extraction', () => {
    it('prefers name over email', () => {
      const result = parseImportFiles(
        [{ filename: 'f.json', content: '{"access_token":"t","name":"Alice","email":"a@b.com"}' }],
        'gemini',
        'oauth'
      )
      expect(result.accounts[0].name).toBe('Alice')
    })

    it('falls back to email', () => {
      const result = parseImportFiles(
        [{ filename: 'f.json', content: '{"access_token":"t","email":"a@b.com"}' }],
        'gemini',
        'oauth'
      )
      expect(result.accounts[0].name).toBe('a@b.com')
    })

    it('falls back to filename without extension', () => {
      const result = parseImportFiles(
        [{ filename: 'myaccount.json', content: '{"access_token":"t"}' }],
        'gemini',
        'oauth'
      )
      expect(result.accounts[0].name).toBe('myaccount')
    })

    it('truncates name to 100 chars', () => {
      const longName = 'a'.repeat(150)
      const result = parseImportFiles(
        [{ filename: 'f.json', content: JSON.stringify({ access_token: 't', name: longName }) }],
        'gemini',
        'oauth'
      )
      expect(result.accounts[0].name).toHaveLength(100)
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
        'gemini',
        'oauth'
      )
      expect(result.accounts[0].credentials.access_token).toBe('at-from-creds')
      expect(result.accounts[0].credentials.refresh_token).toBe('rt-from-creds')
    })
  })

  describe('error limiting', () => {
    it('caps errors at 100 but reports totalErrors', () => {
      const entries = Array.from({ length: 200 }, (_, i) => ({ bad_field: i }))
      const content = JSON.stringify(entries)
      const result = parseImportFiles(
        [{ filename: 'f.json', content }],
        'gemini',
        'oauth'
      )
      expect(result.errors.length).toBeLessThanOrEqual(100)
      expect(result.totalErrors).toBe(200)
      expect(result.skipped).toBe(200)
    })
  })
})
