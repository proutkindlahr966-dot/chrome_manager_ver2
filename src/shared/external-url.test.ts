import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './external-url'

describe('isSafeExternalUrl', () => {
  it('cho phép http, https và mailto', () => {
    expect(isSafeExternalUrl('https://example.com/a')).toBe(true)
    expect(isSafeExternalUrl('http://127.0.0.1:9222')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true)
  })

  it('chặn giao thức khác và chuỗi hỏng', () => {
    expect(isSafeExternalUrl('file:///C:/secret.txt')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,hi')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})
