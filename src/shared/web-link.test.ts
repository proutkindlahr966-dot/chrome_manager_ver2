import { describe, expect, it } from 'vitest'
import {
  applyWebLinkStatuses,
  classifyFormLinkPage,
  classifyWebLinkPage,
  collectUniqueCheckItems,
  collectUniqueFormUrls,
  collectUniqueWebUrls,
  isPublicHttpUrl,
  isWebLinkHeaderLine,
  mapUrlListResults,
  normalizeWebUrl,
  omitMatchingRawLines,
  parseUrlListLines,
  parseWebLinkText,
  summarizeUrlList,
  classifySnapshotToProbe,
  httpStatusNeedsBrowser,
  isRenderHost,
  pageLooksRenderWaking,
  clampRenderKeepAliveMinutes,
  RENDER_KEEPALIVE_INTERVAL_MS,
  shouldWaitForRenderWake,
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

  it('Chrome chặn Render bằng trang đỏ Trang web nguy hiểm', () => {
    const html = `
      <h1>Trang web nguy hiểm</h1>
      <p>Những kẻ tấn công trên trang web bạn đã cố truy cập có thể lừa bạn cài đặt phần mềm hoặc tiết lộ các thông tin như mật khẩu, số điện thoại hoặc số thẻ tín dụng.</p>
      <p>Bật chế độ bảo vệ nâng cao để có được cấp độ bảo mật cao nhất của Chrome</p>
      <button>Chi tiết</button>
      <button>Quay lại trang an toàn</button>
    `
    const result = classifyWebLinkPage({
      finalUrl: 'chrome-error://chromewebdata/',
      statusCode: 0,
      title: 'Lỗi bảo mật',
      bodyText: 'Trang web nguy hiểm. Quay lại trang an toàn',
      html
    })
    expect(result).toEqual({ verdict: 'inactive', reason: 'dangerous_site' })
    expect(
      classifySnapshotToProbe(
        {
          finalUrl: 'chrome-error://chromewebdata/',
          statusCode: 0,
          title: 'Lỗi bảo mật',
          bodyText: 'Trang web nguy hiểm. Quay lại trang an toàn',
          html
        },
        'web'
      ).errorCode
    ).toBe('dangerous_site')
  })

  it('trang lỗi mạng của Chrome không bị tính là trang nguy hiểm', () => {
    const result = classifyWebLinkPage({
      finalUrl: 'chrome-error://chromewebdata/',
      statusCode: 0,
      title: 'Không thể truy cập trang web này',
      bodyText: 'Không thể truy cập trang web này. ERR_CONNECTION_REFUSED',
      html: ''
    })
    expect(result).toEqual({ verdict: 'active', reason: null })
  })

  it('Trang web nguy hiểm (Safe Browsing)', () => {
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

  it('Render Service Suspended là lỗi, không phải server đang thức dậy', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Service Suspended</title>
</head>
<body>
This service has been suspended by its owner.
</body>
</html>`
    const snapshot = {
      finalUrl: 'https://bluecheck-accountverification.onrender.com/recaptcha',
      statusCode: 503,
      title: 'Service Suspended',
      bodyText: 'This service has been suspended by its owner.',
      html
    }
    expect(pageLooksRenderWaking(snapshot)).toBe(false)
    expect(shouldWaitForRenderWake(snapshot, 'render')).toBe(false)
    expect(classifyWebLinkPage(snapshot)).toEqual({ verdict: 'inactive', reason: 'render_suspended' })
    expect(classifySnapshotToProbe(snapshot, 'web').errorCode).toBe('render_suspended')
  })

  it('câu bảo vệ nâng cao trên trang thường không phải cảnh báo trình duyệt', () => {
    const result = classifyWebLinkPage({
      finalUrl: 'https://contentstandardsreview.onrender.com/help',
      statusCode: 200,
      title: 'Meta | Community Standards Violation',
      bodyText: 'Chúng tôi đã kích hoạt các biện pháp bảo vệ nâng cao để bỏ chặn Trang của bạn.',
      html: '<p>Chúng tôi đã kích hoạt các biện pháp bảo vệ nâng cao để bỏ chặn Trang của bạn.</p>'
    })
    expect(result).toEqual({ verdict: 'active', reason: null })
  })

  it('nhận màn hình Render đang thức dậy và bỏ qua khi loại Netlify', () => {
    const waking = {
      finalUrl: 'https://bluebadge-ownershipvalidation.onrender.com/recaptcha',
      statusCode: 200,
      title: 'Render',
      bodyText: '19:55:23 INCOMING HTTP REQUEST DETECTED\n19:55:26 SERVICE WAKING UP\nAPPLICATION LOADING',
      html: '<html><body>START BUILDING ON RENDER TODAY</body></html>'
    }
    expect(isRenderHost(waking.finalUrl)).toBe(true)
    expect(pageLooksRenderWaking(waking)).toBe(true)
    expect(shouldWaitForRenderWake(waking, 'render')).toBe(true)
    expect(shouldWaitForRenderWake(waking, 'netlify')).toBe(false)
    expect(pageLooksRenderWaking({
      finalUrl: 'https://bluebadge-ownershipvalidation.onrender.com/recaptcha',
      statusCode: 502,
      title: '',
      bodyText: '',
      html: ''
    })).toBe(true)
    expect(pageLooksRenderWaking({
      finalUrl: 'https://site.netlify.app/recaptcha',
      statusCode: 200,
      title: 'Recaptcha',
      bodyText: 'Verify you are human',
      html: '<html><body>ok</body></html>'
    })).toBe(false)
    expect(RENDER_KEEPALIVE_INTERVAL_MS).toBe(14 * 60 * 1000)
    expect(clampRenderKeepAliveMinutes(14)).toBe(14)
    expect(clampRenderKeepAliveMinutes(1.4)).toBe(1)
    expect(clampRenderKeepAliveMinutes(0)).toBe(1)
    expect(clampRenderKeepAliveMinutes(30)).toBe(14)
    expect(clampRenderKeepAliveMinutes(Number.NaN)).toBe(14)
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
    expect(out.map((r) => r.verdict)).toEqual(['valid', 'skipped', 'error', 'valid', 'skipped'])
    expect(out[2].errorCode).toBe('netlify_not_found')
    expect(out[2].webError).toBe(true)
    expect(out[2].formError).toBe(false)
    expect(out[3].url).toBe('https://a.com')
    expect(out[4].verdict).toBe('skipped')
    const summary = summarizeUrlList(out)
    expect(summary).toEqual({ valid: 2, error: 1, skipped: 2, formError: 0, webError: 1 })
  })

  it('bỏ qua tiêu đề, tên nhóm và ký tự phân cách, chỉ kiểm tra URL', () => {
    const text = [
      'TỐI 10.30 (TEST LINK)',
      '———',
      'IT',
      'https://accountsecurity-verification.onrender.com/recaptcha',
      'https://bluebadge-trustcredentials.onrender.com/recaptcha',
      '——-',
      'MX',
      'https://bluebadge-ownershipvalidation.onrender.com/recaptcha',
      'https://bluebadge-digitalidentityhub-k71y.onrender.com/recaptcha'
    ].join('\n')
    const lines = parseUrlListLines(text)
    expect(lines.map((row) => row.urls.map((item) => item.url))).toEqual([
      [],
      [],
      [],
      ['https://accountsecurity-verification.onrender.com/recaptcha'],
      ['https://bluebadge-trustcredentials.onrender.com/recaptcha'],
      [],
      [],
      ['https://bluebadge-ownershipvalidation.onrender.com/recaptcha'],
      ['https://bluebadge-digitalidentityhub-k71y.onrender.com/recaptcha']
    ])
    const unique = collectUniqueCheckItems(lines, 'web')
    expect(unique).toHaveLength(4)
    const out = mapUrlListResults(lines, new Map())
    expect(out.filter((row) => row.verdict === 'skipped')).toHaveLength(5)
    expect(out.filter((row) => row.verdict === 'error').every((row) => row.errorCode !== 'invalid_url')).toBe(true)
  })

  it('gỡ dòng lỗi khỏi danh sách và giữ tiêu đề, nhóm', () => {
    const text = [
      'TỐI 10.30 (TEST LINK)',
      '———',
      'https://bluecheck-accountverification.onrender.com/recaptcha',
      'IT',
      'https://bluebadge-ownershipvalidation.onrender.com/recaptcha'
    ].join('\n')
    const { text: next, removed } = omitMatchingRawLines(text, [
      'https://bluecheck-accountverification.onrender.com/recaptcha'
    ])
    expect(removed).toBe(1)
    expect(next.split('\n')).toEqual([
      'TỐI 10.30 (TEST LINK)',
      '———',
      'IT',
      'https://bluebadge-ownershipvalidation.onrender.com/recaptcha'
    ])
  })

  it('gỡ từng lần xuất hiện khi cùng một dòng lỗi lặp lại', () => {
    const text = 'https://a.onrender.com/recaptcha\nhttps://a.onrender.com/recaptcha\nMX'
    const { text: next, removed } = omitMatchingRawLines(text, [
      'https://a.onrender.com/recaptcha',
      'https://a.onrender.com/recaptcha'
    ])
    expect(removed).toBe(2)
    expect(next).toBe('MX')
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
