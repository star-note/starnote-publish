/** The core SDK's messages in English (sentence case); same shape as `zh-CN.ts`. */
import type { CoreMessages } from './zh-CN';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const en: CoreMessages = {
  common: {
    retry: 'Retry',
    cancelled: 'Cancelled',
    publishEnded: 'Publishing has ended',
    checkOnPlatform: 'Check on the platform',
    resendAnyway: 'Send again anyway',
    relogin: 'Log in again',
    viewHelp: 'View help',
    retryLater: 'Retry later',
    retryAfter: (wait) => `Retry in ${wait}`,
    platform: 'the platform',
  },
  wait: {
    seconds: (n) => plural(n, 'second'),
    minutes: (n) => plural(n, 'minute'),
    hours: (n) => plural(n, 'hour'),
    minSec: (m, s) => `${m} min ${s} s`,
  },
  runtime: {
    names: { web: 'the browser', electron: 'the desktop app', server: 'the server' },
    handoff: {
      deeplink: 'Finish in the app',
      'share-intent': 'Finish on the share page',
      'import-url': 'Publish with the import link',
      qrcode: 'Scan to finish on your phone',
      'web-share': 'Share to the app to finish',
      copy: 'Copy the text and post it',
    },
    copyLabel: 'Copy and post manually',
    copyReason: 'Copy the article and paste it into the platform’s editor',
    unsupportedLabel: 'Not supported yet',
    kindUnsupported: (platform, kinds) =>
      `${platform} doesn’t take this kind of content (supported: ${kinds})`,
    disabledLabel: 'Temporarily off',
    disabledReason: (platform) =>
      `Automatic publishing to ${platform} is temporarily off (the platform changed; we’re on it)`,
    bindFirstLabel: 'Connect an account first',
    bindFirstReason: (platform) => `No ${platform} account connected yet`,
    runHereAutomation: 'Publish automatically from here',
    runHereApi: 'Publish directly from here',
    runHereReason: (where, platform) => `${capitalize(where)} can publish to ${platform} directly`,
    handoffReason: (platform) => `Finish publishing on ${platform}’s own page`,
    serverLabel: 'Send from the server (can be scheduled)',
    serverReasonSchedule: 'Hand it to the server to publish on a schedule',
    serverReasonCannot: (where, platform) => `${capitalize(where)} can’t call ${platform} directly`,
    desktopScheduled:
      'Sent when the desktop app comes online (it can’t publish on time while closed)',
    desktopNeedsSession: (platform) =>
      `${platform} needs the desktop app to publish with your logged-in session`,
    desktopNeeds: (platform) => `${platform} needs the desktop app to publish`,
    desktopOnlineLabel: 'Hand to the desktop app',
    downloadDesktopLabel: 'Download the desktop app',
    desktopOnlyReason: (platform) => `${platform} can only be published from the desktop app`,
    desktopQueueLabel: 'Queue until the desktop app is online',
  },
  publisher: {
    unknownPlatform: 'This platform isn’t supported yet',
    followUpUnsupported: (platform) =>
      `${platform} can’t post comments automatically yet, so the link wasn’t posted: you can add the comment yourself`,
    followUpProgress: 'Posting the link comment',
    followUpPosted: 'The article link was posted as the first comment',
    followUpFailed: 'The link comment wasn’t posted; you can post it again',
    noCheckStatus: (platform) =>
      `${platform} answered “processing”, but its adapter can’t check the status`,
    pollTimeout: (platform, sec) =>
      `${platform} timed out after ${sec} seconds and the result is unknown: check on the platform whether it was posted`,
    waitingPublish: 'Waiting for the platform to publish',
    processing: 'The platform is processing',
    finalizeReplayed: (platform) =>
      `${platform} still shows “ready to publish” after finishing; to avoid posting twice it won’t be retried: check on the platform`,
    publishing: 'Publishing',
    wrongRuntime: (platform, where) => `${platform} can’t be published from ${where}`,
    kindUnsupported: (platform, kind) =>
      `${platform} doesn’t support this kind of content (${kind})`,
    retryAfterSec: (sec) => `Retry in ${plural(sec, 'second')}`,
  },
  prepare: {
    unsupported: (platform) => `${platform} isn’t supported yet`,
    needsCloud: (label) =>
      `${label} is only authorized in this page or on another device: to send it at the scheduled time from the server, turn on Cloud relay, or get a reminder to share it yourself`,
    needsBinding: (platform) =>
      `No ${platform} account connected: at the scheduled time you’ll be reminded to copy the text and post it on ${platform}`,
    noServer: (platform) => `${platform} can’t be sent on a schedule from the server yet`,
  },
  schema: {
    titleMax: 'Title can be at most 200 characters',
    summaryMax: 'Summary can be at most 500 characters',
    required: (field) => `Please enter ${field}`,
    minChars: (n) => `At least ${plural(n, 'character')}`,
    maxChars: (n) => `At most ${plural(n, 'character')}`,
    badFormat: 'Invalid format',
    number: 'Please enter a number',
    notBelow: (n) => `Must be at least ${n}`,
    notAbove: (n) => `Must be at most ${n}`,
    validOption: 'Please choose a valid option',
    choose: 'Please choose',
    issueSeparator: '; ',
  },
  media: {
    role: { cover: 'Cover', image: 'Image', video: 'Video' },
    nth: (n, role) => `${role} ${n}`,
    sample: (label, value) => `${label}: ${value}`,
    ratioIs: (r) => `of ${r}`,
    ratioBetween: (min, max) => `between ${min} and ${max}`,
    ratioMin: (r) => `of at least ${r}`,
    ratioMax: (r) => `of at most ${r}`,
    tooManyImages: (who, max, total) =>
      `${capitalize(who)} takes at most ${max} images; only the first ${max} of ${total} will be used`,
    videoTooLarge: (role, who, max) => `${role} is over ${who}’s limit of ${max}`,
    tooLarge: (role, who, max) => `${role} is over ${who}’s limit of ${max} and will be compressed`,
    format: (who, role, formats) => `${who} only accepts ${formats} for ${role.toLowerCase()}s`,
    needSize: (w, h) => `at least ${w}×${h}`,
    needWidth: (w) => `a width of at least ${w}`,
    needHeight: (h) => `a height of at least ${h}`,
    tooSmall: (role, who, need) => `${role} is too small: ${who} needs ${need}`,
    tooBig: (role, who) => `${role} is larger than ${who} allows and will be scaled down`,
    aspectSoft: (role, ratio, who, range) =>
      `${role} has an aspect ratio of ${ratio}; ${who} recommends one ${range}, so it may be cropped`,
    aspectHard: (role, narrow, ratio, who, range) =>
      `${role} is too ${narrow ? 'narrow' : 'wide'} (${ratio}): ${who} needs an aspect ratio ${range}`,
    durationMax: (who, max) => `Video is longer than ${who}’s limit of ${max}`,
    durationMin: (who, min) => `Video is shorter than the ${min} ${who} needs`,
    times: (text, n) => `${text} (${n})`,
  },
  mobile: {
    imagesFill: (n) =>
      `${plural(n, 'image')} shown at phone-screen width (100% wide, auto height, fixed sizes removed)`,
    imagesFit: (n) =>
      `${plural(n, 'image')} capped at phone-screen width (max-width 100%, auto height; narrow images keep their size)`,
    tableScroll: (n) =>
      `${plural(n, 'table')} put in a horizontally scrolling box: swipe sideways on a phone`,
    tableCards: (n, cols) =>
      `${plural(n, 'wide table')} (more than ${cols} columns) turned into one card per row`,
  },
  degrade: {
    headings: (n) => `${plural(n, 'heading')} changed to plain level 2/3 headings`,
    callouts: (n) => `${plural(n, 'callout')} changed to quotes`,
    dividers: (n) => `${plural(n, 'decorative divider')} changed to plain dividers`,
    tasks: (n) => `${plural(n, 'task list')} changed to ☐ / ☑ lists`,
    details: (n) => `${plural(n, 'collapsible block')} expanded`,
    separator: ', ',
    mathImage: (n) =>
      `${plural(n, 'formula', 'formulas')} turned into the platform’s formula images`,
    mathSource: (n) =>
      `${plural(n, 'formula', 'formulas')} kept as $…$ source; how they look depends on the platform`,
    videos: (n) => `${plural(n, 'video')} turned into links`,
    mergedTables: (n) =>
      `${plural(n, 'table')} with merged cells can’t be turned into images yet and stayed tables; they may look misaligned`,
  },
  pipeline: {
    rasterized: (c) =>
      `Turned what the platform can’t display into images, so readers see what you wrote: ${[
        c.math ? plural(c.math, 'formula', 'formulas') : '',
        c.table ? plural(c.table, 'table') : '',
        c.code ? plural(c.code, 'code block') : '',
      ]
        .filter(Boolean)
        .join(', ')}`,
    linksTextified: (n) =>
      `${plural(n, 'outbound link')} turned into plain text, so the platform doesn’t throttle the post as traffic diversion`,
    noQrcode:
      'This platform forbids QR codes that lead elsewhere: the image watermark keeps the text and drops the QR code',
    imagesOptimized: (n, saved) =>
      `${plural(n, 'image')} compressed and resized to the platform’s limits${saved ? `, ${saved} smaller in total` : ''}: faster uploads, no size failures`,
  },
  mask: {
    applied: (n) => `${plural(n, 'sensitive word')} masked automatically (replaced with **)`,
  },
  session: {
    challengePrompt: 'Complete the verification in the window',
    challengeNoWindow: (platform) =>
      `${platform} asks for a verification: complete it on the ${platform} website, then retry`,
    challengePaused: (platform) =>
      `${platform} asks for a verification; paused until you complete it in the window`,
    disabled: (platform) =>
      `Automatic publishing to ${platform} is temporarily off (the platform changed); copy and post it manually`,
    desktopOnly: (platform) => `${platform} can only be published from the StarNote desktop app`,
    notLoggedIn: (platform) => `You haven’t logged in to ${platform} in the desktop app yet`,
    badImageUrl: 'Not a reachable image URL',
    noImageUrl: 'The platform returned no image URL',
    imagesUploaded: (n, platform) => `${plural(n, 'image')} uploaded to ${platform}`,
    imagesFailed: (n, platform) =>
      `${plural(n, 'image')} couldn’t be copied to ${platform} and keep their original links (they won’t show if the original goes away or blocks hotlinking)`,
    noWindow: (platform) =>
      `No desktop window available: copy the content and paste it into the ${platform} editor`,
    partFilled: (missing, platform) =>
      `Couldn’t fill in the ${missing === 'title' ? 'title' : missing === 'body' ? 'body' : 'title and body'} automatically: copy from StarNote and paste it into the ${platform} editor`,
    filled: 'Filled in: check it in the window, then press Publish',
    noCheckEndpoint: 'The site script has no check endpoint',
    tooFrequent: 'Posting too often',
    verifyRequired: 'The platform asks for a verification',
    notJson: 'The response isn’t JSON',
    unexpected: (path) => `${path} isn’t the expected value`,
    noEndpoint: (platform, name) => `The ${platform} site script has no endpoint ${name}`,
    signedEndpoint: (platform, name) =>
      `${platform}’s endpoint ${name} needs a platform signature and can’t be called directly`,
    requestFailed: (platform, why) => `Request to ${platform} failed: ${why}`,
    loginExpired: (platform) => `Your ${platform} login has expired: log in again`,
    challenge: (platform) => `${platform} asks for a verification`,
    gated: (detail) => `${detail}: this one waits, to keep your usual posting pace`,
    rateLimited: (platform) => `${platform} says you’re doing that too often: try again later`,
    platformError: (platform, detail) => `${platform} returned an error: ${detail}`,
    badPlatformKey: (key) => `Invalid platform key: ${key}`,
    badAccountId: (id) => `Invalid account id: ${id}`,
    httpNotJson: (status) => `HTTP ${status}, and the response isn’t JSON`,
    errorCode: (code) => `Error code ${code}`,
    noUserId: 'The response has no user id',
    noLoginInfo: 'The page has no login information',
  },
  siteScript: {
    badBase64: 'Not valid base64url',
    noWebCrypto: 'WebCrypto isn’t available here, so the site script can’t be verified',
    badShape: 'The site script is malformed',
    badAlg: (alg) => `Unsupported algorithm ${alg}`,
    unknownKey: (kid) => `Unknown signing key ${kid}`,
    badSignature: 'The site script’s signature is invalid',
    notJson: 'The site script isn’t JSON',
    missingFields: 'The site script has no platform / version',
    wrongPlatform: (got, want) => `The site script is for ${got}, not ${want}`,
    expired: (at) => `The site script expired on ${at}`,
    needsCore: (v) => `The site script needs publish-core ≥ ${v}`,
    bundledExpired: (at) => `The bundled site script expired (${at}); using it anyway`,
    remoteOlder: (remote, bundled) =>
      `Remote site script ${remote} is older than the bundled ${bundled}; ignored`,
    remoteUnavailable: (why) => `Remote site script unavailable, using the bundled copy: ${why}`,
  },
  themes: {
    business: {
      name: 'Business',
      description:
        'Navy and dark gold, headings with a side bar, restrained spacing; for business, careers and finance',
    },
    tech: {
      name: 'Tech blue',
      description:
        'Bright blue to cyan gradients, block headings and card quotes; for tech, science and gadgets',
    },
    warm: {
      name: 'Warm literary',
      description:
        'Warm ochre, centered headings, airy lines and italic captions; for literature, reading and essays',
    },
    magazine: {
      name: 'Magazine',
      description:
        'Black and white with a touch of red, ruled headings and pull quotes; for art, fashion, film and travel',
    },
    fresh: {
      name: 'Fresh green',
      description:
        'Mint green, rounded block headings and soft quotes; for education, health, lifestyle and food',
    },
  },
  compliance: {
    field: { title: 'Title', summary: 'Summary', tags: 'Tags', body: 'Body', images: 'Images' },
    contactWhat: {
      phone: 'a phone number',
      wechat: 'a WeChat ID',
      qq: 'a QQ number',
      email: 'an email address',
    },
    lengthMax: '{field} has {n} characters, over the platform’s limit of {max}',
    lengthMin: '{field} has {n} characters, under the platform’s minimum of {min}',
    tagsMax: '{n} tags; the platform allows at most {max}',
    tagsMin: 'At least {min} tags are needed',
    imagesMax: '{n} images; the platform allows at most {max}',
    imagesMin: 'At least {min} images are needed',
    imageRatio: 'Image {i} is {w}×{h}; the platform recommends {ratios}, so it may be cropped',
    linkForbidden:
      'The platform doesn’t allow external links (it treats them as traffic diversion): remove them before publishing',
    linkStripped:
      'External links in an Official Account article aren’t clickable; they become “References” at the end on export',
    contact: 'Contains {what}; the platform doesn’t allow directing readers elsewhere',
    qrcode: 'Mentions “{word}”; the platform doesn’t allow QR codes that direct readers elsewhere',
    qrImage:
      'Image {i} looks like a QR code; the platform doesn’t allow QR codes that direct readers elsewhere',
    finance:
      '“{word}” reads as a stock tip or a promise of returns; finance platforms limit or remove such posts: rephrase it',
    financeDisclosure:
      'The article mentions {security}: if you hold it, disclose your position or interest at the end',
    adLaw:
      '“{word}” is an absolute claim banned in commercial promotion by China’s Advertising Law',
    aiLabelOff: 'AI labeling is off. {why}; publishing without it is a compliance risk ({note})',
    aiLabelRequired: 'The label is required by law',
    aiLabelUnverified: 'The platform’s rule is unverified',
    aiFooterTop: 'The body has no AI-assistance note; this platform wants it at the top',
    aiFooterBottom: 'The body has no AI-assistance note; one line will be added at the end',
    aiToggle: 'When publishing, tick the platform’s “AI-generated content” declaration',
  },
  learned: {
    fromUser: 'From your recent publishing feedback',
    fromGlobal: 'From recent publishing feedback',
    semantic: '{note}: {value}. {suggestion}',
    rejected: '{note}: “{word}” was rejected on {where} before. {suggestion}',
    manyPlatforms: 'several platforms',
    thisPlatform: 'this platform',
  },
};

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export default en;
