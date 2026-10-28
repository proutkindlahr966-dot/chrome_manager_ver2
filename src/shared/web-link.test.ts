import { describe, expect, it } from 'vitest'
import {
  applyWebLinkStatuses,
  classifyFormLinkPage,
  classifyWebLinkPage,
  collectUniqueFormUrls,
  collectUniqueWebUrls,
  isPublicHttpUrl,
  isWebLinkHeaderLine,
  mapUrlListResults,
  normalizeWebUrl,
  parseUrlListLines,
  parseWebLinkText,
  summarizeUrlList,
  classifySnapshotToProbe,
  httpStatusNeedsBrowser,
  WEB_LINK_STATUS_ACTIVE,
  WEB_LINK_STATUS_INACTIVE
} from './web-link'

const NETLIFY_HTML = `
  <h1>Site not found</h1>
  <p>Looks like you followed a broken link or entered a URL that doesn't exist on Netlify.</p>
  <p>Netlify Internal ID: 01M3X9PZ53KGSVKH2FCRB6PWY1</p>
`

const TOS_HTML = `
  <div>Google Drive</div>
  <h1>We're sorry. You can't access this item because it is in violation of our Terms of Service.</h1>
  <p>Find out more about this topic at the Google Drive Help Center.</p>
`

const DANGER_HTML = `
  <h1>Trang web nguy hiểm</h1>
  <p>Những kẻ tấn công trên trang web bạn đang cố gắng truy cập có thể lừa đảo bạn.</p>
  <button>Quay lại trang an toàn</button>
`

describe('web-link parse', () => {
  it('nhận dòng header', () => {
    expect(isWebLinkHeaderLine('Link_form|Nhóm|Link_web|Status_link')).toBe(true)
    expect(isWebLinkHeaderLine('https://a.com|G1|https://b.com|')).toBe(false)
  })

  it('tách 4 cột, giữ cột thừa', () => {
    const rows = parseWebLinkText(
      'Link_form|Nhóm|Link_web|Status_link\nhttps://form|Nhóm A|https://web.app|cũ|ghi chú'
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].isHeader).toBe(true)
    expect(rows[1].linkForm).toBe('https://form')
    expect(rows[1].group).toBe('Nhóm A')
    expect(rows[1].linkWeb).toBe('https://web.app')
    expect(rows[1].status).toBe('cũ')
    expect(rows[1].extra).toEqual(['ghi chú'])
  })

  it('lọc trùng Link_form', () => {
    const rows = parseWebLinkText(
      [
        'https://docs.google.com/forms/d/e/AAA/viewform|G1|https://a.app|',
        'https://docs.google.com/forms/d/e/AAA/viewform/|G2|https://b.app|',
        'https://docs.google.com/forms/d/e/BBB/viewform|G3|https://c.app|'
      ].join('\n')
    )
    expect(collectUniqueFormUrls(rows)).toHaveLength(2)
  })

  it('lọc trùng Link_web', () => {
    const rows = parseWebLinkText(
      [
        'https://f1|G1|https://Same.Netlify.app/path/|',
        'https://f2|G2|https://same.netlify.app/path|x',
        'https://f3|G3|https://other.app|'
      ].join('\n')
    )
    expect(collectUniqueWebUrls(rows)).toHaveLength(2)
  })
})

describe('web-link apply status', () => {
  it('chỉ ghi Status_link, không đụng cột khác', () => {
    const input = [
      'Link_form|Nhóm|Link_web|Status_link',
      'https://form/a|Nhóm 1|https://web.app/x|',
      'https://form/b|Nhóm 1|https://web.app/x|cũ',
      'https://form/c|Nhóm 2|https://keep.app|giữ',
      'https://form/d|Nhóm 3|https://new.app'
    ].join('\n')
    const map = new Map([
      [normalizeWebUrl('https://web.app/x'), WEB_LINK_STATUS_INACTIVE],
      [normalizeWebUrl('https://new.app'), WEB_LINK_STATUS_ACTIVE]
    ])
    const out = applyWebLinkStatuses(input, map).split('\n')
    expect(out[0]).toBe('Link_form|Nhóm|Link_web|Status_link')
    expect(out[1]).toBe(`https://form/a|Nhóm 1|https://web.app/x|${WEB_LINK_STATUS_INACTIVE}`)
    expect(out[2]).toBe(`https://form/b|Nhóm 1|https://web.app/x|${WEB_LINK_STATUS_INACTIVE}`)
    expect(out[3]).toBe('https://form/c|Nhóm 2|https://keep.app|giữ')
    expect(out[4]).toBe(`https://form/d|Nhóm 3|https://new.app|${WEB_LINK_STATUS_ACTIVE}`)
  })
})

describe('web-link classify', () => {
  it('Netlify site not found', () => {
    const result = classifyWebLinkPage({
      finalUrl: 'https://old-site.netlify.app/',
      statusCode: 404,
      title: 'Site not found',
      bodyText: '',
      html: NETLIFY_HTML
    })
    expect(result).toEqual({ verdict: 'inactive', reason: 'netlify_not_found' })
  })

  it('Trang web nguy hiểm (Cốc Cốc / Safe Browsing)', () => {
    const result = classifyWebLinkPage({
      finalUrl: 'https://phish.example/',
      statusCode: 200,
      title: 'Trang web nguy hiểm',
      bodyText: 'Quay lại trang an toàn',
      html: DANGER_HTML
    })
    expect(result).toEqual({ verdict: 'inactive', reason: 'dangerous_site' })
  })

  it('Google Drive/Form vi phạm Terms of Service', () => {
    const result = classifyFormLinkPage({
      finalUrl: 'https://docs.google.com/forms/d/e/xxx/viewform',
      statusCode: 200,
      title: 'Google Drive',
      bodyText: '',
      html: TOS_HTML
    })
    expect(result).toEqual({ verdict: 'inactive', reason: 'google_tos_violation' })
  })

  it('link dài viewform bị Google chặn vì vi phạm Điều khoản', () => {
    const html = `<title>Lỗi</title><p class="errorMessage"><b>Chúng tôi rất tiếc. Bạn không thể truy cập vào mục này vì mục này vi phạm <a href="http://www.google.com/google-d-s/intl/vi/terms.html">Điều khoản dịch vụ</a> của chúng tôi.</b></p>`
    const result = classifyFormLinkPage({
      finalUrl:
        'https://docs.google.com/forms/d/e/1FAIpQLSdBY2NSYtUrOvGn-TmvpS7Q-ap2G1bcrPWfQ6YCRGWX8uv_rA/viewform',
      statusCode: 403,
      title: 'Lỗi',
      bodyText: '',
      html
    })
    expect(result).toEqual({ verdict: 'inactive', reason: 'google_tos_violation' })
    expect(
      classifySnapshotToProbe(
        {
          finalUrl:
            'https://docs.google.com/forms/d/e/1FAIpQLSdBY2NSYtUrOvGn-TmvpS7Q-ap2G1bcrPWfQ6YCRGWX8uv_rA/viewform',
          statusCode: 403,
          title: 'Lỗi',
          bodyText: '',
          html
        },
        'form'
      ).errorCode
    ).toBe('google_tos_violation')
  })

  it('form bình thường không cảnh báo ToS', () => {
    const result = classifyFormLinkPage({
      finalUrl: 'https://docs.google.com/forms/d/e/xxx/viewform',
      statusCode: 200,
      title: 'Khảo sát',
      bodyText: 'Submit',
      html: '<html><body>OK</body></html>'
    })
    expect(result).toEqual({ verdict: 'active', reason: null })
  })

  it('trang bình thường là đang hoạt động', () => {
    const result = classifyWebLinkPage({
      finalUrl: 'https://docs.google.com/forms/d/e/xxx/viewform',
      statusCode: 200,
      title: 'Khảo sát',
      bodyText: 'Submit',
      html: '<html><body>OK</body></html>'
    })
    expect(result).toEqual({ verdict: 'active', reason: null })
  })
})

describe('web-link url guard', () => {
  it('chặn localhost / IP nội bộ', () => {
    expect(isPublicHttpUrl('http://127.0.0.1/x')).toBe(false)
    expect(isPublicHttpUrl('http://192.168.0.5')).toBe(false)
    expect(isPublicHttpUrl('https://example.com')).toBe(true)
  })
})

describe('url list output', () => {
  it('giữ đúng thứ tự, kể cả URL trùng', () => {
    const lines = parseUrlListLines(
      ['https://a.com', '', 'https://b.com', 'https://a.com', 'not a url'].join('\n')
    )
    const byKey = new Map([
      [
        normalizeWebUrl('https://a.com'),
        { verdict: 'valid' as const }
      ],
      [
        normalizeWebUrl('https://b.com'),
        {
          verdict: 'error' as const,
          errorCode: 'netlify_not_found' as const,
          errorLabel: 'Site not found (Netlify) — site đã gỡ hoặc sai URL'
        }
      ]
    ])
    const out = mapUrlListResults(lines, byKey)
    expect(out.map((r) => r.verdict)).toEqual(['valid', 'skipped', 'error', 'valid', 'error'])
    expect(out[2].errorCode).toBe('netlify_not_found')
    expect(out[2].webError).toBe(true)
    expect(out[2].formError).toBe(false)
    expect(out[3].url).toBe('https://a.com')
    expect(out[4].errorCode).toBe('invalid_url')
    const summary = summarizeUrlList(out)
    expect(summary).toEqual({ valid: 2, error: 2, skipped: 1, formError: 0, webError: 1 })
  })

  it('giữ nguyên dòng Link_form|Nhóm|Link_web, tách lỗi form/web', () => {
    const raw =
      'https://forms.gle/xxY5uU431CBhw7cc6|10.01_KR|https://badgeinformationreferencehub.netlify.app/recaptcha'
    const lines = parseUrlListLines(raw)
    expect(lines).toHaveLength(1)
    expect(lines[0].raw).toBe(raw)
    expect(lines[0].urls).toEqual([
      { url: 'https://forms.gle/xxY5uU431CBhw7cc6', role: 'form' },
      { url: 'https://badgeinformationreferencehub.netlify.app/recaptcha', role: 'web' }
    ])
    const out = mapUrlListResults(
      lines,
      new Map([
        [normalizeWebUrl('https://forms.gle/xxY5uU431CBhw7cc6'), { verdict: 'valid' }],
        [
          normalizeWebUrl('https://badgeinformationreferencehub.netlify.app/recaptcha'),
          {
            verdict: 'error',
            errorCode: 'netlify_not_found',
            errorLabel: 'Site not found (Netlify) — site đã gỡ hoặc sai URL'
          }
        ]
      ])
    )
    expect(out).toHaveLength(1)
    expect(out[0].raw).toBe(raw)
    expect(out[0].verdict).toBe('error')
    expect(out[0].formError).toBe(false)
    expect(out[0].webError).toBe(true)
  })

  it('nhận link dài viewform làm Link_form', () => {
    const raw =
      'https://docs.google.com/forms/d/e/1FAIpQLSdBY2NSYtUrOvGn-TmvpS7Q-ap2G1bcrPWfQ6YCRGWX8uv_rA/viewform|10.01_KR|https://site.netlify.app/recaptcha'
    const lines = parseUrlListLines(raw)
    expect(lines[0].urls).toEqual([
      {
        url: 'https://docs.google.com/forms/d/e/1FAIpQLSdBY2NSYtUrOvGn-TmvpS7Q-ap2G1bcrPWfQ6YCRGWX8uv_rA/viewform',
        role: 'form'
      },
      { url: 'https://site.netlify.app/recaptcha', role: 'web' }
    ])
    const alone = parseUrlListLines(
      'https://docs.google.com/forms/d/e/1FAIpQLSdBY2NSYtUrOvGn-TmvpS7Q-ap2G1bcrPWfQ6YCRGWX8uv_rA/viewform'
    )
    expect(alone[0].urls).toEqual([
      {
        url: 'https://docs.google.com/forms/d/e/1FAIpQLSdBY2NSYtUrOvGn-TmvpS7Q-ap2G1bcrPWfQ6YCRGWX8uv_rA/viewform',
        role: 'form'
      }
    ])
  })

  it('chỉ kiểm tra Link_form thì bỏ qua Link_web', () => {
    const raw =
      'https://forms.gle/xxY5uU431CBhw7cc6|10.01_KR|https://dead.netlify.app/recaptcha'
    const lines = parseUrlListLines(raw)
    const out = mapUrlListResults(
      lines,
      new Map([[normalizeWebUrl('https://forms.gle/xxY5uU431CBhw7cc6'), { verdict: 'valid' }]]),
      'form'
    )
    expect(out[0].verdict).toBe('valid')
    expect(out[0].webError).toBe(false)
  })

  it('không coi HTTP 400 là link chết, nhưng cần Chrome để xác nhận Form', () => {
    expect(
      classifySnapshotToProbe({
        finalUrl: 'https://forms.gle/xxY5uU431CBhw7cc6',
        statusCode: 400,
        title: '',
        bodyText: '',
        html: '<html></html>'
      }).verdict
    ).toBe('valid')
    expect(httpStatusNeedsBrowser(400)).toBe(true)
    expect(httpStatusNeedsBrowser(200)).toBe(false)
  })

  it('dừng giữa chừng không tô lỗi dòng chưa kiểm tra', () => {
    const lines = parseUrlListLines(['https://a.com', 'https://b.com'].join('\n'))
    const out = mapUrlListResults(
      lines,
      new Map([
        [
          normalizeWebUrl('https://a.com'),
          {
            verdict: 'error' as const,
            errorCode: 'netlify_not_found' as const,
            errorLabel: 'Site not found'
          }
        ]
      ]),
      'all',
      { cancelled: true }
    )
    expect(out[0].verdict).toBe('error')
    expect(out[1].verdict).toBe('skipped')
    expect(out[1].webError).toBe(false)
  })
})
