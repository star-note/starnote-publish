/**
 * The core SDK's messages in 简体中文: the source dictionary. `zh-TW.ts` and `en.ts` implement the same type
 * (`CoreMessages`), so a key missing there fails to compile.
 *
 * `compliance` and `learned` are plain `{name}` templates (no functions): they are also exported as data in
 * `platforms.json` for the API's Python port of the compliance checks.
 */
const zhCN = {
  common: {
    retry: '重试',
    cancelled: '已取消',
    publishEnded: '发布已结束',
    checkOnPlatform: '去平台确认',
    resendAnyway: '仍要重发',
    relogin: '重新登录',
    viewHelp: '查看帮助',
    retryLater: '稍后重试',
    /** `wait` from `wait.*` */
    retryAfter: (wait: string) => `${wait}后重试`,
    platform: '平台',
  },
  /** Durations: 「30 秒」「2 分钟」「1 小时」. */
  wait: {
    seconds: (n: number) => `${n} 秒`,
    minutes: (n: number) => `${n} 分钟`,
    hours: (n: number) => `${n} 小时`,
    minSec: (m: number, s: number) => `${m} 分 ${s} 秒`,
  },
  runtime: {
    names: { web: '浏览器', electron: '桌面端', server: '服务器' },
    handoff: {
      deeplink: '跳转 App 完成',
      'share-intent': '打开分享页完成',
      'import-url': '用导入链接发布',
      qrcode: '扫码在手机上完成',
      'web-share': '分享到 App 完成',
      copy: '复制文案去发布',
    },
    copyLabel: '复制后手动发',
    copyReason: '复制正文，到平台编辑器粘贴发布',
    unsupportedLabel: '暂不支持',
    kindUnsupported: (platform: string, kinds: string) =>
      `${platform} 不接受这种内容（支持：${kinds}）`,
    disabledLabel: '暂时停用',
    disabledReason: (platform: string) => `${platform} 的自动发布暂时停用（平台改版处理中）`,
    bindFirstLabel: '先绑定账号',
    bindFirstReason: (platform: string) => `还没有绑定${platform}账号`,
    runHereAutomation: '本机自动发布',
    runHereApi: '本机直接发',
    runHereReason: (where: string, platform: string) => `${where}可以直接发布到${platform}`,
    handoffReason: (platform: string) => `在${platform}自己的页面里完成发布`,
    serverLabel: '由服务器代发（支持定时）',
    serverReasonSchedule: '交给服务器，可以定时发布',
    serverReasonCannot: (where: string, platform: string) => `${where}不能直接调用${platform}`,
    desktopScheduled: '桌面端上线后补发（桌面端不开就不能准点发布）',
    desktopNeedsSession: (platform: string) => `${platform} 需要桌面端借登录态发布`,
    desktopNeeds: (platform: string) => `${platform} 需要桌面端发布`,
    desktopOnlineLabel: '交给桌面端',
    downloadDesktopLabel: '下载桌面端',
    desktopOnlyReason: (platform: string) => `${platform} 只能在桌面端发布`,
    desktopQueueLabel: '排队等桌面端上线',
  },
  publisher: {
    unknownPlatform: '该平台适配器尚未接入',
    followUpUnsupported: (platform: string) =>
      `${platform} 还不能自动发评论，原文链接没有发出：可以手动补一条评论`,
    followUpProgress: '发链接评论',
    followUpPosted: '原文链接已作为第一条评论发出',
    followUpFailed: '链接评论没发出去，可以手动补发',
    noCheckStatus: (platform: string) => `${platform} 返回了「处理中」，但适配器没有查询状态的方法`,
    pollTimeout: (platform: string, sec: number) =>
      `${platform} 处理超时（${sec} 秒），结果未知：请到平台确认是否已发出`,
    waitingPublish: '等待平台发布',
    processing: '平台处理中',
    finalizeReplayed: (platform: string) =>
      `${platform} 收尾后仍显示「待发布」，为避免重复发帖不再重试：请到平台确认`,
    publishing: '发布中',
    wrongRuntime: (platform: string, where: string) => `${platform} 不能在${where}发布`,
    kindUnsupported: (platform: string, kind: string) =>
      `${platform} 不支持发布这种内容（${kind}）`,
    retryAfterSec: (sec: number) => `${sec} 秒后重试`,
  },
  prepare: {
    unsupported: (platform: string) => `${platform} 暂不支持`,
    needsCloud: (label: string) =>
      `${label} 的授权只在当前页面或其他设备上：到点要由服务器代发，请开启「云端代发」，或改为到点提醒你去分享`,
    needsBinding: (platform: string) =>
      `还没有绑定${platform}账号：到点会提醒你复制文案去${platform}发布`,
    noServer: (platform: string) => `${platform} 还不能由服务器定时代发`,
  },
  schema: {
    titleMax: '标题最多 200 个字符',
    summaryMax: '摘要最多 500 个字符',
    required: (field: string) => `请填写${field}`,
    minChars: (n: number) => `至少 ${n} 个字符`,
    maxChars: (n: number) => `最多 ${n} 个字符`,
    badFormat: '格式不正确',
    number: '请输入数字',
    notBelow: (n: number) => `不能小于 ${n}`,
    notAbove: (n: number) => `不能大于 ${n}`,
    validOption: '请选择有效的选项',
    choose: '请选择',
    /** Joins the issues of `formatZodError`. */
    issueSeparator: '；',
  },
  media: {
    role: { cover: '封面', image: '图片', video: '视频' },
    /** 「第 2 个图片」 */
    nth: (n: number, role: string) => `第 ${n} 个${role}`,
    sample: (label: string, value: string) => `${label}：${value}`,
    ratioIs: (r: string) => `为 ${r}`,
    ratioBetween: (min: string, max: string) => `在 ${min} 到 ${max} 之间`,
    ratioMin: (r: string) => `不小于 ${r}`,
    ratioMax: (r: string) => `不大于 ${r}`,
    tooManyImages: (who: string, max: number, total: number) =>
      `${who} 最多 ${max} 张图片，只会用前 ${max} 张（共 ${total} 张）`,
    videoTooLarge: (role: string, who: string, max: string) => `${role}超过 ${who} 上限 ${max}`,
    tooLarge: (role: string, who: string, max: string) =>
      `${role}超过 ${who} 上限 ${max}，会压缩后上传`,
    format: (who: string, role: string, formats: string) => `${who} 的${role}只支持 ${formats}`,
    needSize: (w: number, h: number) => `至少 ${w}×${h}`,
    needWidth: (w: number) => `宽至少 ${w}`,
    needHeight: (h: number) => `高至少 ${h}`,
    tooSmall: (role: string, who: string, need: string) => `${role}太小，${who} 要求${need}`,
    tooBig: (role: string, who: string) => `${role}超过 ${who} 的最大尺寸，会被缩小`,
    aspectSoft: (role: string, ratio: string, who: string, range: string) =>
      `${role}宽高比 ${ratio}，${who} 建议宽高比${range}，可能会被裁切`,
    aspectHard: (role: string, narrow: boolean, ratio: string, who: string, range: string) =>
      `${role}太${narrow ? '窄' : '宽'}（${ratio}），${who} 要求宽高比${range}`,
    durationMax: (who: string, max: string) => `视频超过 ${who} 时长上限 ${max}`,
    durationMin: (who: string, min: string) => `视频短于 ${who} 要求的 ${min}`,
    times: (text: string, n: number) => `${text}（${n} 个）`,
  },
  mobile: {
    imagesFill: (n: number) => `${n} 张图片按手机屏宽显示（宽 100%、高度自适应，去掉固定宽高）`,
    imagesFit: (n: number) =>
      `${n} 张图片最宽到手机屏宽（max-width 100%、高度自适应，窄图保持原尺寸）`,
    tableScroll: (n: number) => `${n} 个表格放进可横向滑动的容器，手机上左右滑动查看`,
    tableCards: (n: number, cols: number) =>
      `${n} 个宽表格（超过 ${cols} 列）改为每行一张卡片的纵向排版`,
  },
  degrade: {
    headings: (n: number) => `${n} 个标题改成普通二、三级标题`,
    callouts: (n: number) => `${n} 个提示框改成引用块`,
    dividers: (n: number) => `${n} 条装饰分割线改成普通分割线`,
    tasks: (n: number) => `${n} 个任务列表改成 ☐ / ☑ 列表`,
    details: (n: number) => `${n} 个折叠块已展开`,
    separator: '，',
    mathImage: (n: number) => `${n} 个公式改成平台的公式图片`,
    mathSource: (n: number) => `${n} 个公式保留为 $…$ 写法，以平台实际显示为准`,
    videos: (n: number) => `${n} 个视频改成链接`,
    mergedTables: (n: number) =>
      `${n} 个表格有合并单元格，暂时不能转成图片，已按表格保留，显示可能错位`,
  },
  pipeline: {
    rasterized: (c: { math: number; table: number; code: number }) =>
      `平台显示不了的内容已转成图片，保证读者看到的和你写的一样：${[
        c.math ? `${c.math} 个公式` : '',
        c.table ? `${c.table} 个表格` : '',
        c.code ? `${c.code} 段代码` : '',
      ]
        .filter(Boolean)
        .join('、')}`,
    linksTextified: (n: number) => `${n} 个外链改成纯文字，避免平台判定为导流而限流`,
    noQrcode: '这个平台禁止导流二维码：图片水印只保留文字，不放二维码',
    imagesOptimized: (n: number, saved: string) =>
      `${n} 张图片按平台要求压缩、缩放${saved ? `，共节省 ${saved}` : ''}，上传更快、不会因超限失败`,
  },
  mask: {
    applied: (n: number) => `已自动打码 ${n} 处（敏感词替换为 **）`,
  },
  session: {
    challengePrompt: '请在窗口中完成验证',
    challengeNoWindow: (platform: string) =>
      `${platform}要求完成验证，请在${platform}网页上完成后重试`,
    challengePaused: (platform: string) => `${platform}要求验证，已暂停，等你在窗口中完成`,
    disabled: (platform: string) =>
      `${platform}的自动发布暂时停用（平台改版处理中），请复制后手动发布`,
    desktopOnly: (platform: string) => `${platform}只能在辰记桌面端发布`,
    notLoggedIn: (platform: string) => `还没有在桌面端登录${platform}`,
    badImageUrl: '不是可访问的图片地址',
    noImageUrl: '平台没有返回图片地址',
    imagesUploaded: (n: number, platform: string) => `${n} 张图片已上传到${platform}`,
    imagesFailed: (n: number, platform: string) =>
      `${n} 张图片转存到${platform}失败，已保留原图链接（原图失效或被防盗链时会显示不出来）`,
    noWindow: (platform: string) => `没有可用的桌面窗口，请复制内容到${platform}编辑器里粘贴`,
    partFilled: (missing: 'title' | 'body' | 'both', platform: string) =>
      `没能自动填入${missing === 'title' ? '标题' : missing === 'body' ? '正文' : '标题和正文'}，请从辰记复制后粘贴到${platform}编辑器`,
    filled: '已填好，请在窗口中检查后点发布',
    noCheckEndpoint: '站点脚本没有检查接口',
    tooFrequent: '发得太频繁',
    verifyRequired: '平台要求验证',
    notJson: '返回不是 JSON',
    unexpected: (path: string) => `${path} 不是预期值`,
    noEndpoint: (platform: string, name: string) => `${platform}站点脚本里没有接口 ${name}`,
    signedEndpoint: (platform: string, name: string) =>
      `${platform}的接口 ${name} 需要平台签名，不能直接调用`,
    requestFailed: (platform: string, why: string) => `${platform}请求失败：${why}`,
    loginExpired: (platform: string) => `${platform}登录已失效，需要重新登录`,
    challenge: (platform: string) => `${platform}要求完成验证`,
    gated: (detail: string) => `${detail}，为了像平时一样的发文节奏，这篇先不发`,
    rateLimited: (platform: string) => `${platform}提示操作太频繁，请稍后再试`,
    platformError: (platform: string, detail: string) => `${platform}返回错误：${detail}`,
    badPlatformKey: (key: string) => `非法的平台 key：${key}`,
    badAccountId: (id: string) => `非法的账号 id：${id}`,
    httpNotJson: (status: number) => `HTTP ${status}，返回不是 JSON`,
    errorCode: (code: string) => `错误码 ${code}`,
    noUserId: '返回里没有用户 id',
    noLoginInfo: '页面里没有登录信息',
  },
  siteScript: {
    badBase64: '不是合法的 base64url',
    noWebCrypto: '当前环境没有 WebCrypto，无法校验站点脚本',
    badShape: '站点脚本格式不对',
    badAlg: (alg: string) => `不支持的算法 ${alg}`,
    unknownKey: (kid: string) => `未知的签名密钥 ${kid}`,
    badSignature: '站点脚本签名校验失败',
    notJson: '站点脚本内容不是 JSON',
    missingFields: '站点脚本缺少 platform / version',
    wrongPlatform: (got: string, want: string) => `站点脚本属于 ${got}，不是 ${want}`,
    expired: (at: string) => `站点脚本已于 ${at} 过期`,
    needsCore: (v: string) => `站点脚本需要 publish-core ≥ ${v}`,
    bundledExpired: (at: string) => `随包站点脚本已过期（${at}），仍按它执行`,
    remoteOlder: (remote: string, bundled: string) =>
      `远程站点脚本 ${remote} 比随包的 ${bundled} 旧，已忽略`,
    remoteUnavailable: (why: string) => `远程站点脚本不可用，改用随包副本：${why}`,
  },
  themes: {
    business: {
      name: '简约商务',
      description: '藏青与暗金，左侧竖条标题，克制留白，适合商业、职场、财经',
    },
    tech: {
      name: '科技蓝',
      description: '亮蓝到青的渐变，色块标题与卡片式引用，适合技术、科学、数码',
    },
    warm: {
      name: '文艺暖',
      description: '赭石暖色，居中标题，宽行距与斜体图注，适合文学、读书、情感随笔',
    },
    magazine: {
      name: '杂志感',
      description: '黑白加一抹正红，粗细线标题与上下线引语，适合艺术、时尚、影视、旅行',
    },
    fresh: {
      name: '清新绿',
      description: '薄荷绿，圆角色块标题与柔和引用，适合教育、健康、生活、美食',
    },
  },
  /** `{name}` templates, exported to `platforms.json` (`compliance.messages`) for the Python port. */
  compliance: {
    field: { title: '标题', summary: '摘要', tags: '标签', body: '正文', images: '图片' },
    contactWhat: { phone: '手机号', wechat: '微信号', qq: 'QQ 号', email: '邮箱' },
    lengthMax: '{field} {n} 字，超过平台上限 {max} 字',
    lengthMin: '{field} {n} 字，少于平台下限 {min} 字',
    tagsMax: '标签 {n} 个，平台最多 {max} 个',
    tagsMin: '至少需要 {min} 个标签',
    imagesMax: '图片 {n} 张，平台最多 {max} 张',
    imagesMin: '至少需要 {min} 张图片',
    imageRatio: '第 {i} 张图片比例 {w}×{h}，平台推荐 {ratios}，可能被裁切',
    linkForbidden: '平台禁止站外链接（视为导流），发布前删除',
    linkStripped: '公众号正文里的站外链接不可点击，导出时转为文末「参考链接」',
    contact: '含{what}，平台禁止站外导流',
    qrcode: '提到「{word}」，平台禁止二维码导流',
    qrImage: '第 {i} 张图片看起来是二维码，平台禁止二维码导流',
    finance: '「{word}」属于荐股或收益承诺类说法，财经平台会限流或删除，请换个说法',
    financeDisclosure: '文中提到了 {security}：如果持有相关标的，记得在文末披露持仓或利益关系',
    adLaw: '「{word}」属于《广告法》极限用语，商业推广语境下禁用',
    aiLabelOff: '已关闭 AI 标注。{why}，不标注有合规风险（{note}）',
    aiLabelRequired: '依法须标注',
    aiLabelUnverified: '平台规则待核实',
    aiFooterTop: '正文缺少 AI 辅助声明，该平台要求放在开头',
    aiFooterBottom: '正文缺少 AI 辅助声明，将在文末加一句',
    aiToggle: '发布时在平台勾选「内容由 AI 生成」声明',
  },
  /** Learned-rule items (`checkLearnedRules`); also exported for the Python port. */
  learned: {
    fromUser: '根据你近期的发布反馈',
    fromGlobal: '根据近期发布反馈',
    semantic: '{note}：{value}。{suggestion}',
    rejected: '{note}：「{word}」在{where}曾被驳回。{suggestion}',
    manyPlatforms: '多个平台',
    thisPlatform: '这个平台',
  },
};

export type CoreMessages = typeof zhCN;
export default zhCN;
