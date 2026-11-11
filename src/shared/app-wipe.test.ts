import { describe, expect, it } from 'vitest'
import { planAppWipe, wipeFolderRejectReason } from './app-wipe'

const project = 'F:\\Project\\Code\\chrome_manager'

describe('planAppWipe', () => {
  it('xoá data, userData, ổ hồ sơ và shortcut; giữ mã nguồn', () => {
    const plan = planAppWipe(
      project,
      [
        'F:\\Project\\Code\\chrome_manager\\data',
        'F:\\Project\\Code\\chrome_manager\\data\\chrome-profiles\\abc',
        'C:\\Users\\vboyh\\AppData\\Roaming\\chrome-manager',
        'F:\\CODE\\chrome_manager_new',
        'F:\\CODE\\chrome_manager_new\\profile-1',
        'F:\\Project\\Code\\chrome_manager',
        'F:\\Project\\Code\\chrome_manager\\src',
        'F:\\Project\\Code\\chrome_manager\\node_modules',
        'D:\\',
        'C:\\Users\\vboyh',
        'C:\\Users\\vboyh\\Desktop',
        'C:\\Program Files',
        'C:\\Program Files\\Chrome Manager',
        'C:\\Users\\vboyh\\AppData\\Local\\Programs\\Chrome Manager'
      ],
      [
        'F:\\Project\\Code\\chrome_manager\\Chrome Manager.lnk',
        'C:\\Users\\vboyh\\Desktop\\Chrome Manager.lnk',
        'F:\\Project\\Code\\chrome_manager\\package.json'
      ]
    )

    expect(plan.folders.map((item) => item.toLowerCase())).toEqual(
      expect.arrayContaining([
        'f:\\project\\code\\chrome_manager\\data',
        'c:\\users\\vboyh\\appdata\\roaming\\chrome-manager',
        'f:\\code\\chrome_manager_new',
        'c:\\program files\\chrome manager',
        'c:\\users\\vboyh\\appdata\\local\\programs\\chrome manager'
      ])
    )
    expect(plan.folders.some((item) => item.toLowerCase().includes('profile-1'))).toBe(false)
    expect(plan.folders.some((item) => item.toLowerCase().endsWith('\\src'))).toBe(false)
    expect(plan.folders.some((item) => item.toLowerCase() === project.toLowerCase())).toBe(false)
    expect(plan.files).toHaveLength(2)
    expect(plan.skipped.map((item) => item.path.toLowerCase())).toEqual(
      expect.arrayContaining([
        project.toLowerCase(),
        'f:\\project\\code\\chrome_manager\\src',
        'd:\\',
        'c:\\users\\vboyh'
      ])
    )
  })

  it('từ chối thư mục cha của mã nguồn và gốc ổ đĩa', () => {
    expect(wipeFolderRejectReason('F:\\Project\\Code', project)).toMatch(/mã nguồn/)
    expect(wipeFolderRejectReason('F:\\', project)).toMatch(/ổ đĩa/)
    expect(wipeFolderRejectReason('F:\\Project\\Code\\chrome_manager\\data\\chrome-profiles', project)).toBe(
      null
    )
  })
})
