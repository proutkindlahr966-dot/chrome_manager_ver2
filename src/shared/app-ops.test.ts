import { describe, expect, it } from 'vitest'
import { clampStepSpeed, paceDelay, sliderToStepSpeed, stepSpeedToSlider } from './step-speed'
import { formatBytes, isLowDisk } from './disk'
import {
  collectProfilesRoots,
  resolveCreateProfilesRoot,
  uniqueRootPaths
} from './profile-roots'
import { hasProxy, parseProxyString } from './proxy'
import { hasAttachedEmail, parseGmailLine } from './gmail'

describe('step-speed', () => {
  it('kẹp tốc độ trong khoảng cho phép', () => {
    expect(clampStepSpeed(0)).toBe(0.4)
    expect(clampStepSpeed(9)).toBe(3)
    expect(clampStepSpeed('x')).toBe(1)
  })

  it('nhanh hơn thì chờ ngắn hơn', () => {
    expect(paceDelay(1000, 2)).toBe(500)
    expect(paceDelay(10, 3)).toBe(20)
  })

  it('slider round-trip gần đúng', () => {
    const speed = sliderToStepSpeed(50)
    expect(speed).toBe(1)
    expect(Math.round(stepSpeedToSlider(speed))).toBe(50)
  })
})

describe('disk', () => {
  it('định dạng byte', () => {
    expect(formatBytes(500)).toMatch(/MB|—/)
    expect(formatBytes(3 * 1024 ** 3)).toContain('GB')
  })

  it('cảnh báo dưới 2GB', () => {
    expect(
      isLowDisk({ path: 'C:\\', exists: true, freeBytes: 1024 ** 3, totalBytes: 100 * 1024 ** 3 })
    ).toBe(true)
    expect(
      isLowDisk({ path: 'C:\\', exists: true, freeBytes: 10 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 })
    ).toBe(false)
  })
})

describe('profile-roots', () => {
  it('gộp thư mục không trùng', () => {
    const roots = collectProfilesRoots({
      profilesRoot: 'E:\\data\\chrome-profiles',
      additionalProfilesRoots: ['F:\\CODE\\chrome_manager_new', 'F:\\CODE\\chrome_manager_new\\'],
      createProfilesRoot: 'F:\\CODE\\chrome_manager_new'
    })
    expect(roots).toHaveLength(2)
    expect(resolveCreateProfilesRoot({
      profilesRoot: 'E:\\a',
      additionalProfilesRoots: ['C:\\b'],
      createProfilesRoot: 'C:\\b'
    })).toBe('C:\\b')
  })

  it('uniqueRootPaths bỏ trống', () => {
    expect(uniqueRootPaths(['  ', 'D:\\x', 'd:\\x\\'])).toEqual(['D:\\x'])
  })
})

describe('proxy', () => {
  it('parse host:port:user:pass', () => {
    const p = parseProxyString('1.2.3.4:8080:u:p')
    expect(p.host).toBe('1.2.3.4')
    expect(p.port).toBe(8080)
    expect(p.username).toBe('u')
    expect(hasProxy(p)).toBe(true)
  })

  it('none khi thiếu host', () => {
    expect(hasProxy(parseProxyString(''))).toBe(false)
  })
})

describe('gmail', () => {
  it('parse mail|pass|2fa', () => {
    const g = parseGmailLine('a@gmail.com|secret|123456')
    expect(g.email).toBe('a@gmail.com')
    expect(hasAttachedEmail(g)).toBe(true)
  })
})
