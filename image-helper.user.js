// ==UserScript==
// @name         Image Helper
// @name:zh-CN   图片助手
// @name:en      Image Helper
// @namespace    https://github.com/tlgj/Browser-Scripts
// @version      1.20.5
// @description  提取页面图片并清洗到高清，支持多品牌 URL 规则、幻灯片浏览。
// @description:en Extracts page images and cleans them to high definition. Supports multi-brand URL rules and slideshow browsing.
// @author       tlgj
// @license      MIT
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  // =========================================================
  // =========================================================
  // 文件名清理工具（仅用于安全显示文件名）
  // =========================================================
  function sanitizeFilename(input, maxLen = 255) {
    const s = String(input || "")
      .trim()
      // 替换文件名中不允许的字符（Windows/Mac/Linux通用）
      .replace(/[\\/:*?"<>|]+/g, "_")
      // 替换其他可能导致问题的特殊字符
      .replace(/[%#@&!;()\[\]{}<>]+/g, "_")
      // 替换控制字符
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, "_")
      // 替换连续空格和特殊符号
      .replace(/\s+/g, "_")
      .replace(/[._]{2,}/g, "_")
      // 移除开头/结尾的特殊字符
      .replace(/^[_\.\s-]+|[_\.\s-]+$/g, "")
      // 替换换行符
      .replace(/[\r\n\t]+/g, "_");
    return (s || "untitled").slice(0, maxLen);
  }

  // =========================================================
  // 0) 存储与简化配置
  // =========================================================
  const STORE_KEYS = {
    ENABLE_BUTTON: "sih_enable_button",
    BTN_POS: "sih_btn_pos_v2",
    BTN_POS_LOCKED: "sih_btn_pos_locked",
    FILTER: "sih_filter",
    SLIDE_LOAD_MODE: "sih_slide_load_mode",
    SLIDE_RAW_PREVIEW_DELAY_MS: "sih_slide_raw_preview_delay_ms",
    ENHANCED_IMAGE_DISCOVERY: "sih_enhanced_image_discovery",
    PROBE_FILESIZE: "sih_probe_filesize",
    CLICK_OPEN_WHITELIST: "sih_click_open_whitelist",
    SYNC_PAGE_SCROLL: "sih_sync_page_scroll",
    AUTO_LOAD_MORE: "sih_auto_load_more",
  };

  const DEFAULT_BTN_OFFSET = 18;

  const DEFAULTS = {
    enableButton: true,
    btnPos: null,
    btnPosLocked: false,
    filter: {
      minSidePx: 100,
      minSizeKB: 0,
      exts: "jpeg,jpg,png,webp,avif",
    },
    scanBackgroundImages: false,
    maxElementsForBgScan: 8000,
    enhancedImageDiscovery: false,
    probeFilesize: true,
    // 点击网页中的（大）图片直接打开画廊：默认关闭，仅白名单站点启用
    clickOpenWhitelist: [],
    // 画廊翻页时，网页同步滚动到对应图片
    syncPageScroll: true,
    // 打开画廊时先自动“加载更多”（滚动触发懒加载/无限滚动）
    autoLoadMore: false,
    preloadRadius: 2,
    // 幻灯片主图加载模式：
    // - clean：直接加载清洗后的高清链接（默认）
    // - raw：直接加载原始链接（更省流/更快，但可能不清晰）
    // - raw-then-clean：先原始预览，再切换到清洗后的高清（体验最好）
    slideLoadMode: "raw-then-clean",
    // raw-then-clean 模式下：raw 预览停留多久再切 clean（毫秒）
    slideRawPreviewDelayMs: 120,
  };

  const SETTINGS = {
    enableButton: GM_getValue(STORE_KEYS.ENABLE_BUTTON, DEFAULTS.enableButton),
    btnPos: GM_getValue(STORE_KEYS.BTN_POS, DEFAULTS.btnPos),
    btnPosLocked: GM_getValue(STORE_KEYS.BTN_POS_LOCKED, DEFAULTS.btnPosLocked),
    slideLoadMode: GM_getValue(
      STORE_KEYS.SLIDE_LOAD_MODE,
      DEFAULTS.slideLoadMode
    ),
    slideRawPreviewDelayMs: GM_getValue(
      STORE_KEYS.SLIDE_RAW_PREVIEW_DELAY_MS,
      DEFAULTS.slideRawPreviewDelayMs
    ),
    filter: (() => {
      const savedFilter = GM_getValue(STORE_KEYS.FILTER, {});
      return {
        minSidePx:
          savedFilter.minSidePx !== undefined && savedFilter.minSidePx !== ""
            ? savedFilter.minSidePx
            : DEFAULTS.filter.minSidePx,
        minSizeKB:
          savedFilter.minSizeKB !== undefined && savedFilter.minSizeKB !== ""
            ? savedFilter.minSizeKB
            : DEFAULTS.filter.minSizeKB,
        exts:
          savedFilter.exts !== undefined && savedFilter.exts !== ""
            ? savedFilter.exts
            : DEFAULTS.filter.exts,
      };
    })(),
    scanBackgroundImages: DEFAULTS.scanBackgroundImages,
    maxElementsForBgScan: DEFAULTS.maxElementsForBgScan,
    enhancedImageDiscovery: GM_getValue(
      STORE_KEYS.ENHANCED_IMAGE_DISCOVERY,
      DEFAULTS.enhancedImageDiscovery
    ),
    probeFilesize: GM_getValue(
      STORE_KEYS.PROBE_FILESIZE,
      DEFAULTS.probeFilesize
    ),
    clickOpenWhitelist:
      GM_getValue(
        STORE_KEYS.CLICK_OPEN_WHITELIST,
        DEFAULTS.clickOpenWhitelist
      ) || [],
    syncPageScroll: GM_getValue(
      STORE_KEYS.SYNC_PAGE_SCROLL,
      DEFAULTS.syncPageScroll
    ),
    autoLoadMore: GM_getValue(
      STORE_KEYS.AUTO_LOAD_MORE,
      DEFAULTS.autoLoadMore
    ),
    preloadRadius: DEFAULTS.preloadRadius,
  };

  function normalizeDomainEntry(input) {
    const value = String(input || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^\*\./, "")
      .replace(/^\.+/, "")
      .replace(/\/+.*$/, "")
      .replace(/:\d+$/, "");
    if (!value) return "";
    if (value === "*") return "";
    return value;
  }

  function isHostExactMatchedInList(hostname, list) {
    if (!list || !list.length) return false;
    const host = String(hostname || "")
      .trim()
      .toLowerCase();
    if (!host) return false;
    return list.some((site) => normalizeDomainEntry(site) === host);
  }

  // 点击图片直开画廊：默认关闭，仅白名单站点启用
  function isClickOpenEnabled(hostname = location.hostname) {
    return isHostExactMatchedInList(hostname, SETTINGS.clickOpenWhitelist);
  }

  function saveClickOpenWhitelist() {
    GM_setValue(STORE_KEYS.CLICK_OPEN_WHITELIST, SETTINGS.clickOpenWhitelist);
  }

  function toggleClickOpenWhitelist() {
    const host = normalizeDomainEntry(location.hostname);
    if (!host) return;
    const list = SETTINGS.clickOpenWhitelist || [];
    const idx = list.findIndex(
      (entry) => normalizeDomainEntry(entry) === host
    );
    if (idx >= 0) {
      list.splice(idx, 1);
      alert(`已将「${host}」移出白名单：点击图片不再直接打开画廊。`);
    } else {
      list.push(host);
      alert(`已将「${host}」加入白名单：点击图片将直接打开画廊。`);
    }
    SETTINGS.clickOpenWhitelist = list;
    saveClickOpenWhitelist();
  }

  // =========================================================
  // UI Styles（美化版）
  // =========================================================
  const STYLE_ID = "sih-style-v1440";
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
:root{
  --tm-font: system-ui, -apple-system, Segoe UI, Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  --tm-fg: rgba(255,255,255,0.94);
  --tm-dim: rgba(255,255,255,0.74);
  --tm-border: rgba(255,255,255,0.12);
  --tm-glass: rgba(18,18,20,0.62);
  --tm-glass-2: rgba(18,18,20,0.72);
  --tm-shadow: 0 18px 50px rgba(0,0,0,0.50);
  --tm-btn: rgba(255,255,255,0.10);
  --tm-btn-hover: rgba(255,255,255,0.16);
  --tm-danger: #ff5d5d;
  --tm-radius: 14px;
  --tm-accent: rgba(77,163,255,1);
  --tm-accent-soft: rgba(77,163,255,0.35);
}

#tm-img-slide-overlay{ font-family: var(--tm-font); }

.tm-glassbar{
  background: var(--tm-glass);
  border-bottom: 1px solid var(--tm-border);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.tm-glassfooter{
  background: var(--tm-glass-2);
  border-top: 1px solid var(--tm-border);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.tm-topbar{
  display:flex; align-items:center; gap: 14px; padding: 12px 14px;
  flex-wrap: wrap;
}

.tm-top-left{ display:flex; align-items:center; gap:12px; flex-wrap: wrap; }
.tm-top-right{ display:flex; align-items:center; gap:10px; flex-wrap: wrap; justify-content:flex-end; }

.tm-filename{
  flex: 1 1 320px; min-width: 220px; text-align: center; padding: 0 12px;
  font-size: 20px; font-weight: 900; letter-spacing: 0.2px;
  color: rgba(255,255,255,0.94);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  user-select: text;
}


/* ===== 按钮样式（美化版） ===== */
.tm-btn{
  appearance: none;
  border: 1px solid var(--tm-border);
  background: var(--tm-btn);
  color: rgba(255,255,255,0.92);
  font: 900 16px/1 var(--tm-font);
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: transform .12s ease, background .15s ease,
              border-color .15s ease, box-shadow .18s ease, opacity .15s ease;
}

.tm-btn:hover{
  background: var(--tm-btn-hover);
  border-color: rgba(255,255,255,0.18);
  transform: translateY(-1px);
  box-shadow: none;
}

.tm-btn:active{
  transform: translateY(1px);
  box-shadow: none;
}

.tm-btn:disabled{ opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }

.tm-btn-primary{
  border-color: rgba(77,163,255,0.55);
  background: rgba(77,163,255,0.16);
}

.tm-btn-primary:hover{
  background: rgba(77,163,255,0.22);
  border-color: rgba(77,163,255,0.80);
  box-shadow: none;
}

.tm-btn-danger{
  border-color: rgba(255,93,93,0.55);
  background: rgba(255,93,93,0.14);
}

.tm-btn-danger:hover{
  background: rgba(255,93,93,0.22);
  border-color: rgba(255,93,93,0.82);
  box-shadow: none;
}

.tm-btn-ghost{
  border-color: transparent;
  background: transparent;
  color: rgba(255,255,255,0.74);
}

.tm-btn-ghost:hover{
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.94);
  box-shadow: none;
}

.tm-pill{
  display:inline-flex; align-items:center; gap:8px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--tm-border);
  background: rgba(0,0,0,0.18);
}

.tm-kv{ font-size: 16px; color: rgba(255,255,255,0.94); letter-spacing: .2px; }
.tm-kv small{ font-size: 14px; color: rgba(255,255,255,0.74); font-weight: 800; }

.tm-link-row{
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.tm-link-main{
  flex: 1 1 auto;
  min-width: 0;
}

.tm-copy-btn{
  flex: 0 0 auto;
  min-width: 72px;
  padding: 8px 10px;
  font-size: 14px;
  font-weight: 800;
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
  white-space: nowrap;
  text-align: center;
}

.tm-label{ font-size: 14px; color: rgba(255,255,255,0.74); margin-bottom: 6px; }

.tm-url{
  font-size: 15px;
  color: rgba(255,255,255,0.88);
  word-break: break-all;
  line-height: 1.5;
  padding: 8px 10px;
  background: rgba(0,0,0,0.25);
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.06);
}

.tm-stage{
  height: 100%;
  min-height: 0;
  display:flex;
  flex-direction: row;
  align-items: stretch;
  padding: 10px 12px 12px 12px;
  gap: 10px;
  overflow: hidden;
}

.tm-canvas{
  position: relative;
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

.tm-image-box{
  position: absolute;
  inset: 0;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow: hidden;
  border-radius: var(--tm-radius);
}

/* ===== 主图样式（美化版） ===== */
.tm-main-img{
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: rgba(0,0,0,0.35);
  border: 1px solid var(--tm-border);
  border-radius: var(--tm-radius);
  box-shadow: var(--tm-shadow);
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: none;
  opacity: 1;
  transition: opacity .2s ease, box-shadow .25s ease;
}

.tm-main-img:hover {
  box-shadow: 0 24px 60px rgba(0,0,0,0.55);
}

/* ===== 加载动画 ===== */
@keyframes tm-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.tm-main-img.loading {
  background: linear-gradient(90deg,
    rgba(255,255,255,0.04) 25%,
    rgba(255,255,255,0.10) 50%,
    rgba(255,255,255,0.04) 75%
  );
  background-size: 200% 100%;
  animation: tm-shimmer 1.8s infinite;
}

/* ===== 提示气泡 ===== */
.tm-hint{
  position:absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 14px;
  color: rgba(255,255,255,0.90);
  background: rgba(0,0,0,0.35);
  border: 1px solid var(--tm-border);
  padding: 8px 12px;
  border-radius: 999px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 4;
  animation: tm-hint-in 0.25s ease;
}

@keyframes tm-hint-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

#tm-status.tm-hint{ bottom: 14px; }
#tm-help.tm-hint{ bottom: 56px; }

/* ===== 导航按钮（美化版） ===== */
.tm-navbtn{
  position:absolute;
  top:50%;
  transform: translateY(-50%);
  width: 60px;
  height: 60px;
  display:grid;
  place-items:center;
  border-radius: 16px;
  border: 1px solid var(--tm-border);
  background: rgba(0,0,0,0.28);
  color: rgba(255,255,255,0.92);
  font-size: 32px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 5;
  opacity: 0.6;
  transition: all .2s ease;
}
#tm-prev.tm-navbtn{ left:0; }
#tm-next.tm-navbtn{ right:0; }

.tm-navbtn:hover{
  opacity: 1;
  background: rgba(255,255,255,0.12);
  transform: translateY(-50%) scale(1.08);
}

.tm-navbtn:active{
  transform: translateY(-50%) scale(0.96);
}

/* ===== 缩略图条（美化版） ===== */
/* ===== 右侧缩略图索引条（v1.20：由底部移至屏幕右侧） ===== */
.tm-strip-panel{
  position: relative;
  flex: 0 0 auto;
  width: 128px;
  max-width: 22vw;
  height: 100%;
  min-height: 0;
  display: flex;
  background: rgba(0,0,0,0.26);
  border: 1px solid var(--tm-border);
  border-radius: 16px;
  padding: 10px 10px 10px 10px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.tm-strip{
  display:flex;
  flex-direction: column;
  gap:10px;
  overflow-x: hidden;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 2px;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.tm-strip::-webkit-scrollbar{ width: 8px; height: 8px; }

.tm-strip::-webkit-scrollbar-thumb{
  background: rgba(255,255,255,0.18);
  border-radius: 4px;
}

.tm-strip::-webkit-scrollbar-thumb:hover{
  background: rgba(255,255,255,0.28);
}

.tm-strip::-webkit-scrollbar-track{
  background: rgba(255,255,255,0.04);
  border-radius: 4px;
}

/* ===== 缩略图（美化版） ===== */
.tm-thumb{
  width: 104px;
  height: 78px;
  flex: 0 0 auto;
  border-radius: 14px;
  object-fit: cover;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--tm-border);
  opacity: 0.78;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  transition: all .18s ease;
}

.tm-thumb:hover{
  opacity: 0.96;
  border-color: rgba(255,255,255,0.18);
  transform: translateY(-3px) scale(1.05);
  box-shadow: none;
  z-index: 2;
}

.tm-thumb:active{
  transform: translateY(-1px) scale(1.02);
}

.tm-thumb.active{
  opacity: 1;
  border-color: rgba(77,163,255,0.85);
  transform: translateY(-2px);
  box-shadow: none;
}

/* ===== 浮动按钮（美化版） ===== */
#tm-img-slide-float-btn{
  font-family: var(--tm-font);
  font-size: 16px !important;
  font-weight: 900;
  letter-spacing: 0.4px;
  white-space: nowrap;
  word-break: keep-all;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform .15s ease, box-shadow .2s ease, background .15s ease;
}


#tm-img-slide-float-btn:hover {
  transform: scale(1.05);
  box-shadow: none;
}

        `;
    document.head.appendChild(style);
  }

  // =========================================================
  // Rules（清洗规则 / host 映射）
  // 说明：按“工具函数 → 可复用规则 → 品牌/站点规则 → host 映射”的结构集中放置，
  //       仅做组织与注释分区，不改变任何规则/执行顺序/行为。
  // =========================================================

  // ===== Rules: helpers =====
  const safeUrlParse = (urlStr) => {
    try {
      return new URL(urlStr);
    } catch {
      return null;
    }
  };

  const createRegexRule = (regex, replacement) => ({
    apply: (url) => url.replace(regex, replacement),
  });

  const createQueryReplaceRule = (newQuery) => ({
    apply: (url) => url.split("?")[0] + newQuery,
  });

  function extractEncodedOriginFromPath(pathname) {
    const path = String(pathname || "").replace(/^\/+/, "");
    if (!path) return null;

    const decodedPath = (() => {
      try {
        return decodeURIComponent(path);
      } catch {
        return path;
      }
    })();

    const originMatch = decodedPath.match(/^https?:\/\/[^?#]+/i);
    return originMatch ? originMatch[0] : null;
  }

  function extractPlainOriginFromWrappedPath(pathname) {
    const path = String(pathname || "");
    if (!path) return null;

    const plainMatch = path.match(/https?:\/\/[^?#]+/i);
    return plainMatch ? plainMatch[0] : null;
  }

  const CLOUINARY_TRANSFORM_SEGMENT_RE =
    /^[a-z]{1,3}_[^/]+(?:,[a-z]{1,3}_[^/]+)*$/i;

  function isCloudinaryTransformSegment(segment) {
    return CLOUINARY_TRANSFORM_SEGMENT_RE.test(String(segment || ""));
  }

  function stripCloudinaryUploadTransforms(urlStr, uploadPrefix, options = {}) {
    const { assetPathStartsWith = null } = options;
    const u = safeUrlParse(urlStr);
    if (!u) return urlStr;
    if (!u.pathname.startsWith(uploadPrefix)) return urlStr;

    const segments = u.pathname
      .slice(uploadPrefix.length)
      .split("/")
      .filter(Boolean);
    if (!segments.length) return urlStr;

    let firstAssetIndex = 0;
    while (
      firstAssetIndex < segments.length &&
      isCloudinaryTransformSegment(segments[firstAssetIndex])
    ) {
      firstAssetIndex += 1;
    }

    if (firstAssetIndex <= 0 || firstAssetIndex >= segments.length)
      return urlStr;

    const assetPath = segments.slice(firstAssetIndex).join("/");
    if (
      assetPathStartsWith &&
      !String(assetPath || "").startsWith(assetPathStartsWith)
    ) {
      return urlStr;
    }

    return `${u.origin}${uploadPrefix}${assetPath}`;
  }

  const createCloudinaryUploadStripRule = (uploadPrefix, options = {}) => ({
    apply: (urlStr) =>
      stripCloudinaryUploadTransforms(urlStr, uploadPrefix, options),
  });

  // ===== Rules: reusable rules =====
  const REUSABLE_RULES = {
    REMOVE_ALL_QUERY: createRegexRule(/\?.*$/, ""),
    TO_PNG: createRegexRule(/\.(?:webp|jpe?g)(?=\?|$)/i, ".png"),
    REMOVE_VERSION_QUERY: createRegexRule(/\?v=\d+$/, ""),
    REMOVE_SIZE_SUFFIX: createRegexRule(/_\d+x\d+(?=\.\w+$)/, ""),
    SHEIN_LTWEBSTATIC_REMOVE_THUMBNAIL_SUFFIX: createRegexRule(
      /_thumbnail_(?:\d+x\d+|x\d+)(?=\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#]))/i,
      ""
    ),
  };

  // ===== Rules: brand/site rules =====
  const BRAND_RULES = {
    JD_360BUYIMG_REMOVE_AVIF: {
      apply: (url) =>
        url.replace(/(\.(?:jpe?g|png|webp|gif))\.avif(?=$|[?#])/i, "$1"),
    },

    NEWBALANCE_CN_CLEAN: {
      apply: (url) =>
        url.replace(/([?&])image_process=[^&]*(&?)/, (_match, p1, p2) => {
          if (p1 === "?") return p2 === "&" ? "?" : "";
          return p2;
        }),
    },
    NIKE_CLEAN_PATH: {
      apply: (urlStr) => {
        if (!urlStr.includes("/a/images/")) return urlStr;
        const baseUrl = urlStr.substring(0, urlStr.indexOf("/a/images/"));

        const transformMatch = urlStr.match(
          /\/a\/images\/t_[^/]+\/(?:[^/]+\/)*([a-z0-9]+\/[^?]+\.(?:png|jpg|jpeg|webp|gif))/i
        );
        if (transformMatch) return `${baseUrl}/a/images/${transformMatch[1]}`;

        const uuidMatch = urlStr.match(
          /\/a\/images\/[^/]+\/(.+?\/)([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/.+?)$/i
        );
        if (uuidMatch) return `${baseUrl}/a/images/${uuidMatch[2]}`;

        const shortIdMatch = urlStr.match(
          /\/a\/images\/[^/]+\/([a-z0-9_-]+\/[^?]+)$/i
        );
        if (shortIdMatch) return `${baseUrl}/a/images/${shortIdMatch[1]}`;

        return urlStr;
      },
    },
    NIKE_AE_LIKE: {
      apply: (urlStr) => {
        if (!urlStr.includes("/dw/image/")) return urlStr;
        const u = safeUrlParse(urlStr);
        if (!u) return urlStr;

        if (u.searchParams.get("tm_fmt") === "png") {
          const newPath = u.pathname.replace(/\.jpe?g$/i, ".png");
          const newUrl = new URL(u.protocol + "//" + u.host + newPath);
          newUrl.searchParams.set("sw", "3000");
          newUrl.searchParams.set("sh", "3000");
          newUrl.searchParams.set("fmt", "png-alpha");
          newUrl.searchParams.set("tm_fmt", "png");
          return newUrl.toString();
        }

        if (/\.png$/i.test(u.pathname)) {
          return u.protocol + "//" + u.host + u.pathname;
        }

        return u.protocol + "//" + u.host + u.pathname;
      },
    },
    GOAT_CLEAN: {
      apply: (urlStr) => {
        let cleanedUrl = urlStr;
        if (
          cleanedUrl.includes("/transform/") &&
          cleanedUrl.includes("/attachments/")
        ) {
          cleanedUrl = cleanedUrl.replace(
            /\/transform\/.*\/attachments\//,
            "/attachments/"
          );
        }
        const u = safeUrlParse(cleanedUrl);
        if (!u) return cleanedUrl.replace(/\?.*$/, "");
        ["action", "width", "height", "fit", "crop", "quality"].forEach((key) =>
          u.searchParams.delete(key)
        );
        return u.search ? u.toString() : u.origin + u.pathname;
      },
    },
    STOCKX_HIGH_RES: createQueryReplaceRule("?fm=jpg&dpr=3"),
    ADIDAS_ASSETS_PATH: createRegexRule(/(\/images\/)[^/]+,[^/]+\//, "$1"),
    ADIDAS_JPG_TO_PNG: createRegexRule(/\.jpg(?=\?|$)/i, ".png"),
    ASICS_HIGH_RES: createQueryReplaceRule(
      "?wid=3000&hei=3000&fmt=png-alpha&qlt=100"
    ),

    // Shopline 图片规则：CDN 清理 / 源站转 CloudFront / CloudFront 原图提取
    SHOPLINE_IMAGE_CDN_QUERY: {
      apply: (url) => {
        const u = safeUrlParse(url);
        if (!u) return url;
        if (
          u.searchParams.has("w") ||
          u.searchParams.has("h") ||
          u.searchParams.has("q")
        )
          return url.split("?")[0];
        return url;
      },
    },
    ANTA_GROUP_CN_QUERY: {
      apply: (url) => {
        const u = safeUrlParse(url);
        if (!u) return url;
        if (u.searchParams.has("x-image-process")) {
          return url.split("?")[0];
        }
        return url;
      },
    },
    SNIPES_ASSET_ORIGINAL: {
      apply: (urlStr) => {
        const u = safeUrlParse(urlStr);
        if (!u || u.hostname !== "asset.snipes.com") return urlStr;
        return stripCloudinaryUploadTransforms(urlStr, "/images/");
      },
    },
    SHOPLINE_IMAGE_ORIGIN_TO_CLOUDFRONT: {
      apply: (url) =>
        url.replace(
          /^https:\/\/shoplineimg\.com\/[a-f0-9]+\/([a-f0-9]+)\/[^?]+\.(jpg|jpeg|png|webp|gif).*/i,
          "https://d31xv78q8gnfco.cloudfront.net/media/image_clips/$1/original.$2"
        ),
    },
    SHOPLINE_IMAGE_CLOUDFRONT: {
      apply: (url) => {
        const m = url.match(
          /(https:\/\/d31xv78q8gnfco\.cloudfront\.net\/media\/image_clips\/[a-f0-9]+\/original\.(?:jpg|jpeg|png|webp|gif))/i
        );
        return m ? m[0] : url;
      },
    },
    MLB_KOREA_PARAMS: createRegexRule(
      /\/cdn-cgi\/image\/[^/]+(\/images\/.*)/,
      "/cdn-cgi/image/q=100,format=auto$1"
    ),
    MLB_KOREA_SHOP_FILES: createRegexRule(
      /\?(?:v=\d+&width=\d+|width=\d+&v=\d+|v=\d+|width=\d+)/,
      ""
    ),
    PUMA_INTL_UPLOAD_PARAMS: createCloudinaryUploadStripRule("/upload/", {
      assetPathStartsWith: "global/",
    }),
    PUMA_CN_IMAGE_PROCESSING: createRegexRule(/([?&]imageMogr2\/[^&]*)/, ""),
    SKECHERS_USA_PATH: createRegexRule(/(\/image);[^/]+/, "$1"),
    SKECHERS_SG_SUFFIX: createRegexRule(
      /(\_\d+x\d+)(?=\.(?:jpg|jpeg|png|webp|gif))/i,
      ""
    ),
    THENORTHFACE_INTL_CLEAN: createRegexRule(
      /\/t_img\/[^/]+\/v(\d+\/)/,
      "/v$1"
    ),
    THENORTHFACE_CN_REMOVE_QUERY: createRegexRule(/\?\d+$/, ""),
    UNDERARMOUR_SCENE7: {
      apply: (urlStr) => {
        const u = safeUrlParse(urlStr);
        if (!u) return urlStr;
        u.search = "";
        u.searchParams.set("scl", "1");
        u.searchParams.set("fmt", "png-alpha");
        u.searchParams.set("qlt", "100");
        return u.toString();
      },
    },
    VANS_INTL_CLEAN_PARAMS: createRegexRule(
      /(\/images\/).*?(v\d+\/.*)/,
      "$1$2"
    ),
    SAUCONY_SCENE7_REMOVE_DOLLAR_PARAMS: createRegexRule(/\$[^$]+\$/, ""),
    HOKA_CN_REMOVE_QUERY: createRegexRule(/\?\d+(?:#\w+)?$/, ""),
    ON_CN_REMOVE_OSS_QUERY: createRegexRule(/\?x-oss-process=image\/.*/, ""),
    POIZON_FORCE_PNG: createQueryReplaceRule("?x-oss-process=image/format,png"),
    SHOPIFY_REMOVE_SIZE: createRegexRule(
      /(\_\d+x\d*|\_pico|\_icon|\_thumb|\_small|\_compact|\_medium|\_large|\_grande|\_original|\_master)(?=\.\w+)/,
      ""
    ),
    SANITY_CLEAN: createRegexRule(
      /^(https:\/\/cdn\.sanity\.io\/images\/[^/]+\/[^/]+\/[^/?#]+).*/,
      "$1"
    ),
    ALICDN_REMOVE_SUFFIX: {
      apply: (url) => url.replace(/(\.(jpg|jpeg|png|webp|gif))_[^/]*$/i, "$1"),
    },
    FARFETCH_CONTENTS_REMOVE_SIZE_SUFFIX: createRegexRule(
      /_\d+(?=\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#]))/i,
      ""
    ),
    AMAZON_MEDIA_CLEAN: createRegexRule(
      /^(https:\/\/m\.media-amazon\.com\/images\/I\/[^._]+)\._[^.]*_\.(\w+)$/,
      "$1.$2"
    ),
    EBAY_TO_PNG_2000: createRegexRule(
      /\/s-l\d+\.(?:jpg|jpeg|png|webp)$/i,
      "/s-l2000.png"
    ),
    END_CLOTHING_CLEAN: createRegexRule(
      /\/media\/[^/]+\/(?:prodmedia\/)?media\/catalog\/product\//,
      "/media/catalog/product/"
    ),
    RUNNMORE_TO_ORIGINAL: {
      apply: (url) =>
        url
          .replace(/\/files\/thumbs\/files\//, "/files/")
          .replace(/\/images\/thumbs_\d+\//, "/")
          .replace(/(\_\d+\_\d+px)(\.\w+)$/, "$2"),
    },
    SPORTVISION_MK_TO_ORIGINAL: {
      apply: (url) =>
        url
          .replace(/\/files\/thumbs\/files\//, "/files/")
          .replace(/\/images\/thumbs_\d+\//, "/")
          .replace(/\/images\/([^/]+)_\d+_\d+px(?=\.\w+$)/, "/$1")
          .replace(/(\_\d+\_\d+px)(\.\w+)$/, "$2"),
    },
    MAGENTO_TO_ORIGINAL: createRegexRule(
      /\/media\/catalog\/product\/cache\/image\/\d+x\d+\/[^/]+\/(.+)/,
      "/media/catalog/product/$1"
    ),
    OPENCART_TO_ORIGINAL: createRegexRule(
      /^https?:\/\/([^/]+)(\/image)\/cache(\/catalog\/.+?)(-\d+x\d+)(\.\w+)$/i,
      "https://$1$2$3$5"
    ),
    T4S_TO_ORIGINAL: {
      apply: (url) => {
        let c = url.replace(/-\d+(\.\w+)$/, "$1");
        return c.endsWith(".jpg") ? c : c.replace(/\.\w+$/, ".jpg");
      },
    },
    FOOTLOCKER_SCENE7_FORCE_ZOOM2000PNG: {
      apply: (url) => {
        if (!url.includes("/is/image/")) return url;
        const base = url.split("?")[0];
        return `${base}?$zoom2000png$`;
      },
    },
    COMPLEX_CLOUDINARY_CLEAN: createCloudinaryUploadStripRule(
      "/complex/image/upload/",
      {
        assetPathStartsWith: "sanity-new/",
      }
    ),
    HYPEBEAST_CDN_ORIGINAL: {
      apply: (urlStr) => {
        const u = safeUrlParse(urlStr);
        if (!u || u.hostname !== "image-cdn.hypb.st") return urlStr;

        const extracted = extractEncodedOriginFromPath(u.pathname);
        return extracted || urlStr;
      },
    },
    SNEAKER_FREAKER_BCDN_ORIGINAL: {
      apply: (urlStr) => {
        const u = safeUrlParse(urlStr);
        if (!u || u.hostname !== "sneaker-freaker.b-cdn.net") return urlStr;

        const extracted = extractEncodedOriginFromPath(u.pathname);
        return extracted || urlStr;
      },
    },
    ZALORA_DYNAMIC_ORIGINAL: {
      apply: (urlStr) => {
        const u = safeUrlParse(urlStr);
        if (!u || u.hostname !== "dynamic.zacdn.com") return urlStr;

        const extracted = extractPlainOriginFromWrappedPath(u.pathname);
        return extracted || urlStr;
      },
    },
    BOMBAS_ASSETS_ORIGINAL: {
      apply: (urlStr) => {
        const u = safeUrlParse(urlStr);
        if (!u || u.hostname !== "assets.bombas.com") return urlStr;
        if (!u.pathname.startsWith("/image/fetch/")) return urlStr;

        const extracted =
          extractPlainOriginFromWrappedPath(u.pathname) ||
          extractEncodedOriginFromPath(u.pathname);
        return extracted || urlStr;
      },
    },
  };

  const RULE_CHAINS = {
    SHOPIFY_ORIGINAL_CLEAN: [
      BRAND_RULES.SHOPIFY_REMOVE_SIZE,
      REUSABLE_RULES.REMOVE_ALL_QUERY,
    ],
  };

  // ===== Rules: host maps =====
  const EXACT_HOST_MAP = new Map([
    ["image.goat.com", "goat"],
    ["cdn.flightclub.com", "flightclub"],
    ["images.stockx.com", "stockx"],
    ["static.nike.com.cn", "nike-cn"],
    ["static.nike.com", "nike-global"],
    ["c.static-nike.com", "nike-global"],
    ["www.nike.ae", "nike-ae-like"],
    ["www.nike.com.kw", "nike-ae-like"],
    ["www.nike.qa", "nike-ae-like"],
    ["www.nike.sa", "nike-ae-like"],
    ["assets.adidas.com", "adidas-intl"],
    ["images.asics.com", "asics-intl"],
    ["img.cdn.91app.hk", "cdn-91app"],
    ["img.91app.com", "cdn-91app"],
    ["www.brooksrunning.com", "brooks-intl"],
    ["res-converse.baozun.com", "converse-cn"],
    ["dam-converse.baozun.com", "converse-cn"],
    ["www.decathlon.com", "decathlon-intl"],
    ["pixl.decathlon.com.cn", "decathlon-cn"],
    ["contents.mediadecathlon.com", "decathlon-hk"],

    // Shopline 图片域名
    ["img.myshopline.com", "shopline-image-cdn"],
    ["img.fishfay.com", "anta-group-cn"],
    ["shoplineimg.com", "shopline-image-origin"],
    ["d31xv78q8gnfco.cloudfront.net", "shopline-image-cloudfront"],
    ["dms.deckers.com", "hoka-intl"],
    ["b2c.hoka.wishetin.com", "hoka-cn"],
    ["lining-goods-online-1302115263.file.myqcloud.com", "lining-cn"],
    ["i1.adis.ws", "mizuno-usa"],
    ["static-resource.mlb-korea.com", "mlb-korea"],
    ["en.mlb-korea.com", "mlb-korea-shop"],
    ["nb.scene7.com", "newbalance-intl"],
    ["itg-tezign-files.tezign.com", "newbalance-cn"],
    ["old-order.com", "old-order-shopify"],
    ["images.ctfassets.net", "on-intl"],
    ["oss.on-running.cn", "on-cn"],
    ["images.puma.com", "puma-intl"],
    ["itg-tezign-files-tx.tezign.com", "puma-cn"],
    ["cdn.dam.salomon.com", "salomon-intl"],
    ["s7d4.scene7.com", "saucony-intl"],
    ["images.skechers.com", "skechers-usa"],
    ["www.skechers.com.hk", "skechers-hk"],
    ["www.skechers.com.sg", "skechers-sg"],
    ["assets.thenorthface.com", "thenorthface-intl"],
    ["img2.thenorthface.com.cn", "thenorthface-cn"],
    ["underarmour.scene7.com", "underarmour-scene7"],
    ["assets.vans.com", "vans-intl"],
    ["sneakernews.com", "sneakernews-wp"],
    ["cdn.sanity.io", "sanity-cdn"],
    ["cdn.poizon.com", "poizon-cdn"],
    ["static.shihuocdn.cn", "shihuo-cdn"],
    ["eimage.shihuocdn.cn", "shihuo-cdn"],
    ["images.novelship.com", "novelship-img"],
    ["www.snipesusa.com", "snipes-us"],
    ["asset.snipes.com", "snipes-global"],
    ["static.shiekh.com", "magento-shiekh"],
    ["m.media-amazon.com", "amazon-media"],
    ["i.ebayimg.com", "ebay-img-force-png"],
    ["media.endclothing.com", "end-clothing"],
    ["media.finishline.com", "finishline-media"],
    ["www.runnmore.com", "runnmore"],
    ["www.sportvision.mk", "sportvision-mk"],
    ["www.sportvision.hr", "sportvision-mk"],
    ["gnk-store.ru", "opencart-generic"],
    ["gw.alicdn.com", "alicdn"],
    ["img.alicdn.com", "alicdn"],
    ["assets.footlocker.com", "footlocker-scene7"],
    ["cdn-images.farfetch-contents.com", "farfetch-contents"],
    ["img.ltwebstatic.com", "shein-ltwebstatic"],
    ["img.shein.com", "shein-ltwebstatic"],
    ["images.complex.com", "complex-cloudinary"],
    ["image-cdn.hypb.st", "hypebeast-cdn"],
    ["sneaker-freaker.b-cdn.net", "sneaker-freaker-bcdn"],
    ["catalog.hkstore.com", "hkstore-catalog"],
    ["dynamic.zacdn.com", "zalora-dynamic-cdn"],
    ["assets.bombas.com", "bombas-assets"],
    ["www.stadiumgoods.com", "stadiumgoods-shopify"],
    ["f.nooncdn.com", "noon-cdn"],
  ]);

  const PARTIAL_MATCH_RULES = [
    {
      str: "cdn.shopify.com/s/files/1/1330/6287/files",
      type: "decathlon-intl",
    },
    {
      str: "cdn.shopify.com/s/files/1/0862/7834/0912/files",
      type: "reebok-intl",
    },
    {
      str: "cdn.shopify.com/s/files/1/0603/3031/1875/files",
      type: "kickscrew-shopify",
    },
    { str: "t4s.cz", type: "t4s-cdn" },
  ];

  // ===== Rules: hostType → rule chain =====
  const HOST_RULE_MAP = {
    goat: [BRAND_RULES.GOAT_CLEAN],
    flightclub: [REUSABLE_RULES.REMOVE_ALL_QUERY],
    stockx: [BRAND_RULES.STOCKX_HIGH_RES],
    "nike-cn": [BRAND_RULES.NIKE_CLEAN_PATH, REUSABLE_RULES.TO_PNG],
    "nike-global": [BRAND_RULES.NIKE_CLEAN_PATH, REUSABLE_RULES.TO_PNG],
    "nike-ae-like": [BRAND_RULES.NIKE_AE_LIKE],
    "adidas-intl": [
      BRAND_RULES.ADIDAS_ASSETS_PATH,
      BRAND_RULES.ADIDAS_JPG_TO_PNG,
    ],
    "asics-intl": [BRAND_RULES.ASICS_HIGH_RES],
    "cdn-91app": [REUSABLE_RULES.REMOVE_VERSION_QUERY],
    "brooks-intl": [REUSABLE_RULES.REMOVE_ALL_QUERY, REUSABLE_RULES.TO_PNG],
    "converse-cn": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "decathlon-intl": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "decathlon-cn": [REUSABLE_RULES.REMOVE_ALL_QUERY, REUSABLE_RULES.TO_PNG],
    "decathlon-hk": [REUSABLE_RULES.REMOVE_ALL_QUERY, REUSABLE_RULES.TO_PNG],

    // Shopline 图片规则链
    "shopline-image-cdn": [BRAND_RULES.SHOPLINE_IMAGE_CDN_QUERY],
    "anta-group-cn": [BRAND_RULES.ANTA_GROUP_CN_QUERY],
    "shopline-image-origin": [BRAND_RULES.SHOPLINE_IMAGE_ORIGIN_TO_CLOUDFRONT],
    "shopline-image-cloudfront": [BRAND_RULES.SHOPLINE_IMAGE_CLOUDFRONT],
    "hoka-intl": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "hoka-cn": [BRAND_RULES.HOKA_CN_REMOVE_QUERY],
    "lining-cn": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "mizuno-usa": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "mlb-korea": [BRAND_RULES.MLB_KOREA_PARAMS],
    "mlb-korea-shop": [BRAND_RULES.MLB_KOREA_SHOP_FILES],
    "newbalance-intl": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "newbalance-cn": [BRAND_RULES.NEWBALANCE_CN_CLEAN],
    "old-order-shopify": RULE_CHAINS.SHOPIFY_ORIGINAL_CLEAN,
    "on-intl": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "on-cn": [BRAND_RULES.ON_CN_REMOVE_OSS_QUERY],
    "puma-intl": [BRAND_RULES.PUMA_INTL_UPLOAD_PARAMS],
    "puma-cn": [BRAND_RULES.PUMA_CN_IMAGE_PROCESSING],
    "reebok-intl": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "salomon-intl": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "saucony-intl": [
      BRAND_RULES.SAUCONY_SCENE7_REMOVE_DOLLAR_PARAMS,
      REUSABLE_RULES.REMOVE_ALL_QUERY,
    ],
    "skechers-usa": [BRAND_RULES.SKECHERS_USA_PATH],
    "skechers-hk": [REUSABLE_RULES.REMOVE_VERSION_QUERY],
    "skechers-sg": [
      BRAND_RULES.SKECHERS_SG_SUFFIX,
      REUSABLE_RULES.REMOVE_VERSION_QUERY,
    ],
    "thenorthface-intl": [BRAND_RULES.THENORTHFACE_INTL_CLEAN],
    "thenorthface-cn": [BRAND_RULES.THENORTHFACE_CN_REMOVE_QUERY],
    "underarmour-scene7": [BRAND_RULES.UNDERARMOUR_SCENE7],
    "vans-intl": [BRAND_RULES.VANS_INTL_CLEAN_PARAMS],
    "sneakernews-wp": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "sanity-cdn": [BRAND_RULES.SANITY_CLEAN],
    "poizon-cdn": [BRAND_RULES.POIZON_FORCE_PNG],
    "shihuo-cdn": [
      REUSABLE_RULES.REMOVE_SIZE_SUFFIX,
      REUSABLE_RULES.REMOVE_ALL_QUERY,
    ],
    "kickscrew-shopify": RULE_CHAINS.SHOPIFY_ORIGINAL_CLEAN,
    "novelship-img": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "snipes-us": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "snipes-global": [
      BRAND_RULES.SNIPES_ASSET_ORIGINAL,
      REUSABLE_RULES.REMOVE_ALL_QUERY,
    ],
    "magento-shiekh": [BRAND_RULES.MAGENTO_TO_ORIGINAL],
    "amazon-media": [BRAND_RULES.AMAZON_MEDIA_CLEAN],
    "ebay-img-force-png": [BRAND_RULES.EBAY_TO_PNG_2000],
    "end-clothing": [BRAND_RULES.END_CLOTHING_CLEAN],
    "finishline-media": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    runnmore: [BRAND_RULES.RUNNMORE_TO_ORIGINAL],
    "sportvision-mk": [BRAND_RULES.SPORTVISION_MK_TO_ORIGINAL],
    "opencart-generic": [BRAND_RULES.OPENCART_TO_ORIGINAL],
    "t4s-cdn": [BRAND_RULES.T4S_TO_ORIGINAL],
    alicdn: [BRAND_RULES.ALICDN_REMOVE_SUFFIX],
    "footlocker-scene7": [BRAND_RULES.FOOTLOCKER_SCENE7_FORCE_ZOOM2000PNG],
    "farfetch-contents": [
      BRAND_RULES.FARFETCH_CONTENTS_REMOVE_SIZE_SUFFIX,
      REUSABLE_RULES.REMOVE_ALL_QUERY,
    ],
    "shein-ltwebstatic": [
      REUSABLE_RULES.SHEIN_LTWEBSTATIC_REMOVE_THUMBNAIL_SUFFIX,
      REUSABLE_RULES.REMOVE_ALL_QUERY,
    ],
    "complex-cloudinary": [BRAND_RULES.COMPLEX_CLOUDINARY_CLEAN],
    "hypebeast-cdn": [BRAND_RULES.HYPEBEAST_CDN_ORIGINAL],
    "sneaker-freaker-bcdn": [BRAND_RULES.SNEAKER_FREAKER_BCDN_ORIGINAL],
    "hkstore-catalog": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "zalora-dynamic-cdn": [BRAND_RULES.ZALORA_DYNAMIC_ORIGINAL],
    "bombas-assets": [BRAND_RULES.BOMBAS_ASSETS_ORIGINAL],
    "stadiumgoods-shopify": RULE_CHAINS.SHOPIFY_ORIGINAL_CLEAN,
    "noon-cdn": [REUSABLE_RULES.REMOVE_ALL_QUERY],
    "jd-360buyimg": [BRAND_RULES.JD_360BUYIMG_REMOVE_AVIF],
  };

  function detectHostTypeByUrlObj(u, fullUrlStr) {
    if (
      u.hostname === "360buyimg.com" ||
      u.hostname.endsWith(".360buyimg.com")
    ) {
      return "jd-360buyimg";
    }

    if (
      u.hostname === "img.myshopline.com" ||
      /^img-[a-z0-9-]+\.myshopline\.com$/i.test(u.hostname)
    ) {
      return "shopline-image-cdn";
    }

    let hostType = EXACT_HOST_MAP.get(u.hostname);
    if (!hostType) {
      if (u.pathname.startsWith("/cdn/shop/files/")) {
        hostType = "old-order-shopify";
      } else {
        for (const rule of PARTIAL_MATCH_RULES) {
          if (fullUrlStr.includes(rule.str)) {
            hostType = rule.type;
            break;
          }
        }
      }
    }
    return hostType || null;
  }

  function cleanUrl(urlStr) {
    const u = safeUrlParse(urlStr);
    if (!u) return { raw: urlStr, clean: urlStr, hostType: null };

    const hostType = detectHostTypeByUrlObj(u, urlStr);
    if (!hostType) return { raw: urlStr, clean: urlStr, hostType: null };

    const rules = HOST_RULE_MAP[hostType];
    if (!rules) return { raw: urlStr, clean: urlStr, hostType };

    let newUrl = urlStr;
    for (const r of rules) newUrl = r.apply(newUrl);
    return { raw: urlStr, clean: newUrl, hostType };
  }

  // =========================================================
  // 2) 提取候选图片
  // =========================================================
  function normalizeToAbs(url) {
    if (!url) return null;
    const s = String(url).trim();
    if (!s) return null;
    if (/^(data:|blob:|javascript:)/i.test(s)) return null;
    try {
      return new URL(s, location.href).toString();
    } catch {
      return null;
    }
  }

  function pickBestFromSrcset(srcset) {
    if (!srcset) return null;
    const parts = srcset
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return null;

    let best = null;
    for (const p of parts) {
      const seg = p.split(/\s+/).filter(Boolean);
      const url = seg[0];
      const desc = seg[1] || "";
      let score = 0;
      let wHint = 0;

      const mw = desc.match(/^(\d+)w$/i);
      if (mw) {
        wHint = parseInt(mw[1], 10);
        score = wHint;
      }

      const mx = desc.match(/^(\d+(?:\.\d+)?)x$/i);
      if (mx) score = parseFloat(mx[1]) * 10000;

      if (!best || score > best.score) best = { url, score, wHint };
    }
    return best;
  }

  function getExt(urlStr) {
    try {
      const u = new URL(urlStr);
      const fn = u.pathname.split("/").pop() || "";
      const m = fn.match(/\.([a-z0-9]+)$/i);
      return m ? m[1].toLowerCase() : "";
    } catch {
      return "";
    }
  }

  function guessExtFromUrl(urlStr, extFromPath) {
    if (extFromPath) return extFromPath;
    const match = urlStr.match(/\$(zoom2000(png|jpg))\$/i);
    return match ? match[2] : "";
  }

  function getFileName(urlStr, fallbackExt) {
    try {
      const u = new URL(urlStr);
      let name = u.pathname.split("/").pop() || "";
      // 安全解码并清理特殊字符
      try {
        name = decodeURIComponent(name);
      } catch {
        // 如果解码失败，使用原始名称
      }
      // 清理文件名中的特殊字符（仅用于显示，保留较长限制）
      name = sanitizeFilename(name, 200);
      if (!/\.[a-z0-9]+$/i.test(name) && fallbackExt)
        name = `${name}.${fallbackExt}`;
      return name || "(无文件名)";
    } catch {
      return "(无文件名)";
    }
  }

  function getMinSideHintFromImg(img) {
    // 优先使用 naturalWidth/Height（实际尺寸）
    let w = img.naturalWidth || 0;
    let h = img.naturalHeight || 0;

    // 如果无法获取实际尺寸，尝试使用 clientWidth/clientHeight（显示尺寸）
    if (!w || !h) {
      w = img.clientWidth || 0;
      h = img.clientHeight || 0;
    }

    // 如果仍然无法获取，返回 0
    if (!w || !h) return 0;

    return Math.min(w, h);
  }

  function extractCandidates() {
    const seen = new Set();
    const list = [];

    const add = (rawUrl, minSideHint = 0, sourceEl = null) => {
      const abs = normalizeToAbs(rawUrl);
      if (!abs) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      list.push({
        rawUrl: abs,
        minSideHint: minSideHint || 0,
        sourceEl: sourceEl || null,
      });
    };

    const addUrlsFromCssText = (cssText, sourceEl = null) => {
      if (!cssText || cssText === "none") return;

      const urlMatches = cssText.matchAll(/url\(["']?(.*?)["']?\)/gi);
      for (const m of urlMatches) add(m[1], 0, sourceEl);

      const imageSetMatches = cssText.matchAll(/image-set\((.*?)\)/gi);
      for (const match of imageSetMatches) {
        const body = match[1] || "";
        const candidates = Array.from(
          body.matchAll(
            /(?:url\()?["']?([^"')\s,]+)["']?\)?\s*(\d+(?:\.\d+)?x|\d+w)?/gi
          )
        )
          .map((m) => {
            const url = m[1];
            const descriptor = (m[2] || "").toLowerCase();
            let score = 0;
            if (/w$/.test(descriptor)) score = parseInt(descriptor, 10) || 0;
            else if (/x$/.test(descriptor)) {
              score = (parseFloat(descriptor) || 0) * 10000;
            }
            return { url, score };
          })
          .filter((item) => item.url && !/^type$/i.test(item.url));

        if (!candidates.length) continue;
        candidates.sort((a, b) => b.score - a.score);
        add(candidates[0].url, 0, sourceEl);
      }
    };

    const addBestSrcset = (srcset, sourceEl = null) => {
      if (!srcset) return;
      const best = pickBestFromSrcset(srcset);
      if (best?.url) add(best.url, best.wHint || 0, sourceEl);
    };

    const addJsonImageValues = (value, depth = 0) => {
      if (depth > 4 || value == null) return;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return;
        if (
          /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i.test(trimmed) ||
          /[?&](?:image|img|format)=/i.test(trimmed)
        ) {
          add(trimmed, 0);
          return;
        }
        if (/^https?:\/\//i.test(trimmed) || /^(?:\/\/|\/)/.test(trimmed)) {
          if (
            /\/(?:images?|media|product|gallery|content|uploads?)\//i.test(
              trimmed
            )
          ) {
            add(trimmed, 0);
          }
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) addJsonImageValues(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;

      for (const [key, val] of Object.entries(value)) {
        const lowerKey = String(key || "").toLowerCase();
        if (
          /(^|[_-])(image|img|thumb|thumbnail|picture|zoom|src|srcset|avatar)([_-]|$)/.test(
            lowerKey
          ) ||
          /(^|[_-])(gallery|images|media)([_-]|$)/.test(lowerKey)
        ) {
          addJsonImageValues(val, depth + 1);
        }
      }
    };

    const addJsonStringIfLikelyImagePayload = (raw, sourceHint = "") => {
      if (!raw) return;
      const trimmed = raw.trim();
      if (!trimmed) return;

      const lowerSource = String(sourceHint || "").toLowerCase();
      const lowerRaw = trimmed.slice(0, 400).toLowerCase();
      const looksLikeImagePayload =
        /(?:image|img|thumb|thumbnail|gallery|media|picture|zoom|src|srcset)/.test(
          lowerSource
        ) ||
        /(?:image|img|thumb|thumbnail|gallery|media|picture|zoom|src|srcset)/.test(
          lowerRaw
        );
      if (!looksLikeImagePayload) return;

      try {
        addJsonImageValues(JSON.parse(trimmed));
      } catch {
        if (
          /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i.test(trimmed) ||
          /[?&](?:image|img|format)=/i.test(trimmed)
        ) {
          add(trimmed, 0);
        }
      }
    };

    const parseScriptJsonForImages = (script) => {
      const raw = script.textContent || "";
      if (!raw) return;

      const lowerId = String(script.id || "").toLowerCase();
      const lowerClass = String(script.className || "").toLowerCase();
      const lowerType = String(script.type || "").toLowerCase();
      const hintText = `${lowerId} ${lowerClass} ${lowerType}`;
      const isNextData = lowerId === "__next_data__";
      const isLdJson = lowerType === "application/ld+json";
      const shouldParseJson =
        isNextData ||
        isLdJson ||
        /(?:image|img|gallery|media|product)/.test(hintText) ||
        /(?:image|img|gallery|media|product)/.test(
          raw.slice(0, 400).toLowerCase()
        );

      if (!shouldParseJson) return;

      try {
        addJsonImageValues(JSON.parse(raw));
      } catch {
        const matches = raw.matchAll(
          /https?:\/\/[^\s"'<>]+(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[^\s"'<>]*)/gi
        );
        for (const m of matches) add(m[0], 0);
      }
    };

    const LAZY_URL_ATTRS = [
      "data-src",
      "data-original",
      "data-lazy",
      "data-lazy-src",
      "data-url",
      "data-image",
      "data-img",
      "data-zoom",
      "data-zoom-image",
      "data-large_image",
      "data-highres",
      "data-hires",
      "data-full",
      "data-full-url",
      "data-image-src",
      "data-original-src",
      "data-fullsize",
      "data-src-large",
      "data-media",
      "data-thumb",
      "data-fancybox",
    ];
    const LAZY_SRCSET_ATTRS = ["data-srcset", "data-lazy-srcset"];

    document.querySelectorAll("img, source").forEach((el) => {
      const tagName = el.tagName.toLowerCase();

      addBestSrcset(el.getAttribute("srcset"), el);

      if (tagName === "img") {
        const src = el.currentSrc || el.src;
        if (src) add(src, getMinSideHintFromImg(el), el);
      }

      for (const a of LAZY_URL_ATTRS) {
        const v = el.getAttribute(a);
        if (v) add(v, 0, el);
      }
      for (const a of LAZY_SRCSET_ATTRS) {
        addBestSrcset(el.getAttribute(a), el);
      }
    });

    document
      .querySelectorAll(
        'meta[property="og:image"][content], meta[name="og:image"][content]'
      )
      .forEach((m) => add(m.getAttribute("content"), 0));
    document
      .querySelectorAll('link[rel="preload"][as="image"][href]')
      .forEach((l) => add(l.getAttribute("href"), 0));
    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((script) => {
        parseScriptJsonForImages(script);
      });

    const IMG_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href && IMG_EXT_RE.test(href)) add(href, 0, a);
    });

    document
      .querySelectorAll('[style*="url("], [style*="image-set("]')
      .forEach((el) => {
        addUrlsFromCssText(el.getAttribute("style") || "", el);
      });

    if (SETTINGS.enhancedImageDiscovery) {
      document
        .querySelectorAll("[data-gallery], [data-images], [data-media]")
        .forEach((el) => {
          for (const attrName of [
            "data-gallery",
            "data-images",
            "data-media",
          ]) {
            addJsonStringIfLikelyImagePayload(
              el.getAttribute(attrName),
              attrName
            );
          }
        });

      document
        .querySelectorAll(
          'script[type="application/json"], script#__NEXT_DATA__'
        )
        .forEach((script) => {
          parseScriptJsonForImages(script);
        });
    }

    if (SETTINGS.scanBackgroundImages) {
      const all = document.getElementsByTagName("*");
      if (all.length <= SETTINGS.maxElementsForBgScan) {
        for (let i = 0; i < all.length; i++) {
          addUrlsFromCssText(getComputedStyle(all[i]).backgroundImage, all[i]);
        }
      }
    }

    return list;
  }

  // =========================================================
  // 3) Content-Length 过滤
  // =========================================================
  function parseLengthFromHeaders(headers) {
    const h = headers || "";

    let m = h.match(/content-range:\s*bytes\s+\d+-\d+\/(\d+)/i);
    if (m) return parseInt(m[1], 10);

    m = h.match(/content-length:\s*(\d+)/i);
    if (m) return parseInt(m[1], 10);

    return null;
  }

  // Content-Length 探测缓存：避免同一 URL 在一次扫描/多次重扫中重复 HEAD/Range
  // value = Promise<number|null>（保证并发请求去重）
  const contentLengthProbeCache = new Map();

  function probeContentLength(url) {
    if (!url) return Promise.resolve(null);

    const cached = contentLengthProbeCache.get(url);
    if (cached) return cached;

    const p = (async () => {
      const timeoutMs = 8000;

      const doHEAD = () =>
        new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: "HEAD",
            url,
            timeout: timeoutMs,
            onload: (res) =>
              resolve(parseLengthFromHeaders(res.responseHeaders)),
            onerror: () => resolve(null),
            ontimeout: () => resolve(null),
          });
        });

      const doRangedGET = () =>
        new Promise((resolve) => {
          let finished = false;
          let req = null;

          const done = (v) => {
            if (finished) return;
            finished = true;
            resolve(v);
          };

          req = GM_xmlhttpRequest({
            method: "GET",
            url,
            headers: { Range: "bytes=0-0" },
            timeout: timeoutMs,
            responseType: "arraybuffer",
            onprogress: (evt) => {
              if (evt && evt.loaded > 65536) {
                try {
                  req && req.abort && req.abort();
                } catch {
                  /* ignore */
                }
                done(null);
              }
            },
            onload: (res) => done(parseLengthFromHeaders(res.responseHeaders)),
            onerror: () => done(null),
            ontimeout: () => done(null),
          });
        });

      const len1 = await doHEAD();
      if (len1 != null) return len1;
      return await doRangedGET();
    })();

    contentLengthProbeCache.set(url, p);
    return p;
  }

  async function applySizeFilter(items, setStatus) {
    const minKB = Number(SETTINGS.filter.minSizeKB || 0);
    if (!minKB) return items;

    const minBytes = Math.max(0, Math.floor(minKB * 1024));
    if (!minBytes) return items;

    const concurrency = 6;
    let idx = 0;
    let done = 0;
    const out = [];
    const keepUnknown = true;

    async function worker() {
      while (idx < items.length) {
        const i = idx++;
        const it = items[i];

        setStatus?.(`检测文件大小 ${done}/${items.length}…`);
        const len = await probeContentLength(it.cleanUrl);
        done++;
        it.contentLength = len;

        if (len == null) {
          if (keepUnknown) out.push(it);
        } else {
          if (len >= minBytes) out.push(it);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, () =>
        worker()
      )
    );
    setStatus?.(`检测完成：保留 ${out.length}/${items.length}`);
    return out;
  }

  // =========================================================
  // 4) 简化过滤
  // =========================================================
  function extAllowed(ext) {
    const exts = String(SETTINGS.filter.exts || "").trim();
    if (!exts) return true;
    const allow = new Set(
      exts
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
    if (ext === "jpeg" && allow.has("jpg")) return true;
    if (ext === "jpg" && allow.has("jpeg")) return true;
    return allow.has(ext);
  }

  function passSimpleFilters(minSideHint, ext) {
    const minSide = Number(SETTINGS.filter.minSidePx || 0);
    // 如果设置了分辨率过滤，过滤掉尺寸小于阈值或无法获取尺寸的图片
    if (minSide && minSideHint < minSide) return false;
    if (ext && !extAllowed(ext)) return false;
    return true;
  }

  // =========================================================
  // 5) 幻灯片 UI
  // =========================================================
  let overlay = null;
  let list = [];
  let current = 0;

  // v1.20 需求3：点击网页图片打开画廊时，记录目标图以精确定位
  let pendingClickTarget = null;

  let thumbObserver = null;
  const THUMB_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="104" height="78" viewBox="0 0 104 78">
  <rect fill="#1a1a1c" width="104" height="78" rx="14"/>
  <path fill="#333" d="M38 34a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm24 18H38l8-10 5 4 10-13 12 19z"/>
</svg>
`)}`;
  const THUMB_MAX_RENDER = 800;

  let cachedEls = null;
  let wheelHandler = null;

  function cacheOverlayElements() {
    if (!overlay) {
      cachedEls = null;
      return;
    }
    cachedEls = {
      counter: overlay.querySelector("#tm-counter"),
      status: overlay.querySelector("#tm-status"),
      hostType: overlay.querySelector("#tm-hosttype"),
      filename: overlay.querySelector("#tm-filename"),
      mainImg: overlay.querySelector("#tm-main-img"),
      strip: overlay.querySelector("#tm-strip"),
      filesizePill: overlay.querySelector("#tm-filesize-pill"),
      filesize: overlay.querySelector("#tm-filesize"),
    };
  }

  function setStatus(text) {
    const el = cachedEls?.status || overlay?.querySelector("#tm-status");
    if (!el) return;
    if (!text) {
      el.style.display = "none";
      el.textContent = "";
    } else {
      el.style.display = "block";
      el.textContent = text;
    }
  }

  function updateCounter() {
    const c = cachedEls?.counter || overlay?.querySelector("#tm-counter");
    if (c) c.textContent = `${list.length ? current + 1 : 0} / ${list.length}`;
  }

  const BTN_ID = "tm-img-slide-float-btn";
  function updateFloatingButtonText() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.textContent = overlay ? "关闭" : "图片";
    btn.title = overlay ? "关闭图片幻灯片（Esc）" : "打开图片幻灯片";
  }

  function preloadAround(i) {
    const radius = Number(SETTINGS.preloadRadius || 0);
    if (!radius || list.length === 0) return;

    for (let d = 1; d <= radius; d++) {
      const a = (i + d + list.length) % list.length;
      const b = (i - d + list.length) % list.length;

      [a, b].forEach((k) => {
        const u = list[k]?.cleanUrl;
        if (!u) return;
        const img = new Image();
        img.decoding = "async";
        img.loading = "eager";
        img.src = u;
      });
    }
  }

  function ensureThumbObserver(stripEl) {
    if (thumbObserver) return;
    thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (!ent.isIntersecting) continue;
          const img = ent.target;
          const src = img.dataset.src;
          if (src) {
            img.src = src;
            delete img.dataset.src;
          }
          thumbObserver.unobserve(img);
        }
      },
      { root: stripEl, rootMargin: "140px", threshold: 0.01 }
    );
  }

  function renderThumbnails() {
    const strip = cachedEls?.strip || overlay?.querySelector("#tm-strip");
    if (!strip) return;

    // ✅ 修复：先断开再置空
    if (thumbObserver) {
      thumbObserver.disconnect();
      thumbObserver = null;
    }

    strip.innerHTML = "";
    if (!list.length) return;

    const renderCount = Math.min(list.length, THUMB_MAX_RENDER);
    ensureThumbObserver(strip);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < renderCount; i++) {
      const it = list[i];
      const img = document.createElement("img");
      img.className = "tm-thumb";
      img.alt = String(i + 1);
      img.loading = "lazy";
      img.decoding = "async";
      img.src = THUMB_PLACEHOLDER;

      img.dataset.src = it.rawUrl;

      img.addEventListener("error", () => {
        if (img.dataset.fallbackTried) {
          img.style.opacity = "0.3";
          img.alt = "加载失败";
          return;
        }
        img.dataset.fallbackTried = "1";
        img.src = it.cleanUrl;
      });

      img.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        show(i);
      });

      frag.appendChild(img);
      thumbObserver.observe(img);
    }
    strip.appendChild(frag);
    updateActiveThumbnail();
  }

  function updateActiveThumbnail() {
    const strip = cachedEls?.strip || overlay?.querySelector("#tm-strip");
    if (!strip) return;

    const thumbs = strip.querySelectorAll(".tm-thumb");
    thumbs.forEach((t) => t.classList.remove("active"));

    const active = thumbs[current];
    if (active) {
      active.classList.add("active");
      try {
        active.scrollIntoView({ block: "nearest", inline: "center" });
      } catch {
        /* ignore */
      }
    }
  }

  function show(i) {
    if (!list.length) return;
    // v1.20.3 “加载更多”进行中禁止向前绕回第 1 张：停在末张，等新图追加后再继续
    if (loadingMore && i >= list.length) return;
    current = (i + list.length) % list.length;

    const it = list[current];
    updateCounter();

    const els = cachedEls || {};
    if (els.hostType)
      els.hostType.textContent = it.hostType ? `[${it.hostType}]` : "[no-rule]";
    if (els.filename) els.filename.textContent = it.fileName || "(无文件名)";

    const imgEl = els.mainImg || overlay?.querySelector("#tm-main-img");
    setStatus("加载中…");

    // ✅ 美化：添加加载动画
    imgEl.classList.add("loading");
    imgEl.style.opacity = "0";

    // 用 token 防止快速切换时旧 onload/onerror 乱入
    const token = String(Date.now()) + "_" + String(Math.random());
    imgEl.dataset.tmToken = token;

    // 更新顶部文件大小胶囊
    const filesizePill =
      els.filesizePill || overlay?.querySelector("#tm-filesize-pill");
    const filesizeEl = els.filesize || overlay?.querySelector("#tm-filesize");
    if (filesizePill) filesizePill.style.display = "none";
    if (filesizeEl) filesizeEl.textContent = "-";

    const trySettleSuccess = () => {
      if (imgEl.dataset.tmToken !== token) return;
      setStatus("");
      imgEl.style.opacity = "1";
      imgEl.classList.remove("loading");

      // 图片加载成功后，显示文件大小（仅在开关开启时主动探测）
      const showFilesize = (len) => {
        if (imgEl.dataset.tmToken !== token) return;
        if (filesizePill && filesizeEl) {
          if (len != null) {
            filesizeEl.textContent = formatFileSize(len);
            filesizePill.style.display = "";
          } else {
            filesizeEl.textContent = "-";
            filesizePill.style.display = "none";
          }
        }
      };

      if (it.contentLength != null) {
        showFilesize(it.contentLength);
      } else if (SETTINGS.probeFilesize && it.cleanUrl) {
        probeContentLength(it.cleanUrl).then((len) => {
          it.contentLength = len;
          showFilesize(len);
        });
      }
    };

    const trySettleError = () => {
      if (imgEl.dataset.tmToken !== token) return;
      setStatus("加载失败（可能防盗链/不存在）");
      imgEl.style.opacity = "0.5";
      imgEl.classList.remove("loading");
    };

    imgEl.onload = () => {
      // raw-then-clean 时：raw 加载成功先显示，并清掉“加载中”避免用户误判卡死；clean 成功后再静默收口一次
      if (imgEl.dataset.tmToken !== token) return;
      if (
        SETTINGS.slideLoadMode === "raw-then-clean" &&
        imgEl.dataset.tmPhase === "raw"
      ) {
        imgEl.style.opacity = "1";
        imgEl.classList.remove("loading");
        setStatus("");
        return;
      }
      trySettleSuccess();
    };

    imgEl.onerror = () => {
      if (imgEl.dataset.tmToken !== token) return;
      // raw-then-clean：raw 失败就直接切 clean 再试一次
      if (
        SETTINGS.slideLoadMode === "raw-then-clean" &&
        imgEl.dataset.tmPhase === "raw"
      ) {
        imgEl.dataset.tmPhase = "clean";
        imgEl.src = it.cleanUrl;
        return;
      }
      trySettleError();
    };

    // 根据设置选择加载策略
    if (SETTINGS.slideLoadMode === "raw") {
      imgEl.dataset.tmPhase = "raw";
      imgEl.src = it.rawUrl || it.cleanUrl;
    } else if (SETTINGS.slideLoadMode === "raw-then-clean") {
      imgEl.dataset.tmPhase = "raw";
      imgEl.src = it.rawUrl || it.cleanUrl;

      // raw 已经开始加载；稍后无论如何都尝试切到 clean（若 raw 本身就是 clean，则不重复）
      if (it.cleanUrl && it.rawUrl && it.cleanUrl !== it.rawUrl) {
        const delay = clamp(
          Number(SETTINGS.slideRawPreviewDelayMs || 0),
          0,
          5000
        );
        setTimeout(() => {
          if (imgEl.dataset.tmToken !== token) return;
          imgEl.dataset.tmPhase = "clean";
          imgEl.src = it.cleanUrl;
        }, delay);
      }
    } else {
      // clean（默认）
      imgEl.dataset.tmPhase = "clean";
      imgEl.src = it.cleanUrl;
    }

    preloadAround(current);
    updateActiveThumbnail();
    updateFloatingButtonText();

    // v1.20 合并页面：翻到某张图时复位主图缩放，并让背景网页同步滚动到该图片
    resetMainZoom();
    syncPageToCurrent();

    // v1.20.3 翻到接近最后一张时，自动触发“加载更多”
    maybeAutoLoadNearEnd();
  }

  // =========================================================
  // v1.20 主图缩放/平移（原独立查看器能力合并进幻灯片，两页合一）
  // =========================================================
  const mainZoom = {
    scale: 1,
    tx: 0,
    ty: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
  };

  function getMainImgEl() {
    return cachedEls?.mainImg || overlay?.querySelector("#tm-main-img");
  }

  function applyMainZoom() {
    const imgEl = getMainImgEl();
    if (!imgEl) return;
    imgEl.style.transform = `translate(${mainZoom.tx}px, ${mainZoom.ty}px) scale(${mainZoom.scale})`;
  }

  function resetMainZoom() {
    mainZoom.scale = 1;
    mainZoom.tx = 0;
    mainZoom.ty = 0;
    mainZoom.dragging = false;
    applyMainZoom();
  }

  function zoomMainBy(factor) {
    if (!overlay) return;
    mainZoom.scale = clamp(mainZoom.scale * factor, 1, 12);
    if (mainZoom.scale <= 1.001) {
      mainZoom.tx = 0;
      mainZoom.ty = 0;
    }
    applyMainZoom();
  }

  function bindMainImageZoom(mainImgEl) {
    if (!mainImgEl) return;

    mainImgEl.addEventListener("pointerdown", (e) => {
      if (mainZoom.scale <= 1.01) return;
      mainImgEl.setPointerCapture?.(e.pointerId);
      mainZoom.dragging = true;
      mainZoom.startX = e.clientX;
      mainZoom.startY = e.clientY;
      mainZoom.startTx = mainZoom.tx;
      mainZoom.startTy = mainZoom.ty;
      e.preventDefault();
      e.stopPropagation();
    });

    mainImgEl.addEventListener("pointermove", (e) => {
      if (!mainZoom.dragging) return;
      const dx = e.clientX - mainZoom.startX;
      const dy = e.clientY - mainZoom.startY;
      mainZoom.tx = mainZoom.startTx + dx;
      mainZoom.ty = mainZoom.startTy + dy;
      applyMainZoom();
      e.preventDefault();
      e.stopPropagation();
    });

    const endDrag = (e) => {
      if (!mainZoom.dragging) return;
      mainZoom.dragging = false;
      e.preventDefault();
      e.stopPropagation();
    };
    mainImgEl.addEventListener("pointerup", endDrag);
    mainImgEl.addEventListener("pointercancel", endDrag);
  }

  // =========================================================
  // v1.20 网页同步滚动：画廊到第 N 张 → 背景网页滚到第 N 张图片
  // =========================================================
  function syncPageToCurrent() {
    if (!SETTINGS.syncPageScroll) return;
    if (!overlay) return;
    const it = list[current];
    const el = it && it.sourceEl;
    if (!el || !el.isConnected) return;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      /* ignore */
    }
  }

  // =========================================================
  // v1.20 通用“图片加载更多”：滚动页面触发懒加载/无限滚动后重扫
  // =========================================================
  let loadingMore = false;
  // v1.20.3 轮播接近末尾自动“加载更多”：一次尝试没有新增图后置 true，防止反复空转
  let autoLoadNearEndDone = false;
  const AUTO_NEAR_END = 3; // 距末尾 ≤3 张时触发
  const AUTO_MIN_LIST = 6; // 列表太短的静态页面不自动折腾

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function pageMetrics() {
    const doc = document.documentElement;
    const body = document.body;
    return {
      height: Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0),
      imgs: document.getElementsByTagName("img").length,
    };
  }

  function scrollAllToBottom() {
    const doc = document.documentElement;
    const body = document.body;
    const maxY = Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0
    );
    try {
      window.scrollTo(0, maxY);
    } catch {
      /* ignore */
    }

    // 同时把“容器内滚动”的图库滚到底（部分站点图片列表在 div 里滚动）
    try {
      const all = document.body.querySelectorAll("*");
      let scrolled = 0;
      for (let i = 0; i < all.length && scrolled < 8; i++) {
        const el = all[i];
        if (el.scrollHeight <= el.clientHeight + 80) continue;
        if (el.clientHeight < 160) continue;
        const oy = getComputedStyle(el).overflowY;
        if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") continue;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) continue;
        el.scrollTop = el.scrollHeight;
        scrolled++;
      }
    } catch {
      /* ignore */
    }
  }

  async function scrollLoadMoreRounds() {
    if (loadingMore) return;
    loadingMore = true;
    try {
      const maxRounds = 12;
      let stagnant = 0;
      let last = pageMetrics();
      for (let round = 1; round <= maxRounds; round++) {
        setStatus(`滚动加载更多 ${round}/${maxRounds}…`);
        scrollAllToBottom();
        await sleep(650);
        const now = pageMetrics();
        const grew = now.height > last.height + 20 || now.imgs > last.imgs;
        last = now;
        if (grew) stagnant = 0;
        else stagnant++;
        // 连续 3 轮没有增长即认为已到底
        if (stagnant >= 3) break;
      }
    } finally {
      loadingMore = false;
    }
  }

  // 统一的“滚动加载更多 + 重扫”流程（v1.20.3）；只有真的加载到新图才重新武装自动触发
  async function runLoadMoreRebuild(preserveUrl) {
    if (loadingMore) return;
    autoLoadNearEndDone = true;
    const prevLen = list.length;
    await rebuildAndOpen({ loadMore: true, preserveUrl });
    if (list.length > prevLen) autoLoadNearEndDone = false;
  }

  // 翻到接近末尾时自动触发“加载更多”（由 show() 调用）
  function maybeAutoLoadNearEnd() {
    if (!overlay || loadingMore || autoLoadNearEndDone) return;
    if (list.length < AUTO_MIN_LIST) return;
    if (current < list.length - AUTO_NEAR_END) return;
    runLoadMoreRebuild(getCurrentRawUrl());
  }

  function getCurrentRawUrl() {
    return list[current]?.rawUrl || null;
  }

  async function rebuildAndOpen(options = {}) {
    // 每次重新扫描前清空探测缓存，避免缓存无限增长
    contentLengthProbeCache.clear();

    // 需求5：先滚动页面触发懒加载/无限滚动，再扫描
    if (options.loadMore) {
      await scrollLoadMoreRounds();
    }

    // 重新扫描后要回到的图：点击图片打开 > 指定保留 > 当前位置
    const clickTarget = pendingClickTarget;
    pendingClickTarget = null;
    const preserveUrl = options.preserveUrl || null;

    setStatus("扫描页面图片…");
    const candidates = extractCandidates();
    const cleanSeen = new Set();
    const tmp = [];

    for (const c of candidates) {
      const cleaned = cleanUrl(c.rawUrl);

      const extPath = getExt(cleaned.clean);
      const ext = guessExtFromUrl(cleaned.clean, extPath);

      if (!passSimpleFilters(c.minSideHint || 0, ext)) continue;
      if (cleanSeen.has(cleaned.clean)) continue;
      cleanSeen.add(cleaned.clean);

      const fileName = getFileName(cleaned.clean, ext);

      tmp.push({
        rawUrl: c.rawUrl,
        cleanUrl: cleaned.clean,
        hostType: cleaned.hostType,
        ext,
        fileName,
        minSideHint: c.minSideHint || 0,
        contentLength: null,
        sourceEl: c.sourceEl || null, // 需求4：翻页时网页同步滚动
      });
    }

    list = await applySizeFilter(tmp, (s) => setStatus(s));

    // 需求3：定位到点击的那张图；否则尽量保留原位置
    let startIdx = 0;
    const targetUrl = clickTarget?.rawUrl || preserveUrl;
    if (targetUrl) {
      const idx = list.findIndex((it) => it.rawUrl === targetUrl);
      if (idx >= 0) startIdx = idx;
    }
    current = 0;

    if (!list.length) {
      setStatus("未提取到图片（可能被过滤条件筛掉）");
      const els = cachedEls || {};
      if (els.hostType) els.hostType.textContent = "";
      if (els.filename) els.filename.textContent = "";
      if (els.mainImg) els.mainImg.src = "";
      if (els.strip) els.strip.innerHTML = "";
      updateCounter();
      updateFloatingButtonText();
      return;
    }

    setStatus("");
    renderThumbnails();
    show(startIdx);
  }
  // =========================================================
  // 幻灯片 overlay 构建/事件
  // =========================================================
  function buildOverlay() {
    injectStyles();

    overlay = document.createElement("div");
    overlay.id = "tm-img-slide-overlay";
    overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.90);
            z-index: 2147483646;
            display: grid;
            grid-template-rows: auto 1fr;
            color: rgba(255,255,255,0.92);
            overflow: hidden;
        `;

    overlay.innerHTML = `
            <div class="tm-glassbar tm-topbar">
                <div class="tm-top-left">
                    <div class="tm-pill">
                      <div class="tm-kv"><span id="tm-counter">0 / 0</span> <small>图片</small></div>
                    </div>
                    <div class="tm-pill">
                      <div class="tm-kv"><span id="tm-hosttype">[no-rule]</span></div>
                    </div>
                    <div class="tm-pill" id="tm-filesize-pill" style="display:none;">
                      <div class="tm-kv"><small>📦</small> <span id="tm-filesize">-</span></div>
                    </div>
                </div>

                <div class="tm-top-right">
                    <button id="tm-loadmore" class="tm-btn" title="滚动页面到底部，触发懒加载/无限滚动后再重新扫描">加载更多</button>
                    <button id="tm-open" class="tm-btn">新标签打开</button>
                    <button id="tm-refresh" class="tm-btn">重新扫描</button>
                    <button id="tm-close" class="tm-btn tm-btn-danger">关闭</button>

                </div>

                <div id="tm-filename" class="tm-filename"></div>
            </div>


            <div class="tm-stage">
                <div class="tm-canvas" id="tm-canvas">
                    <button id="tm-prev" class="tm-navbtn">‹</button>

                    <div class="tm-image-box">
                        <img id="tm-main-img" class="tm-main-img" title="拖动：平移 · Alt+滚轮：缩放" />
                    </div>

                    <button id="tm-next" class="tm-navbtn">›</button>

<div id="tm-status" class="tm-hint" style="display:none;"></div>
                    <div id="tm-help" class="tm-hint" style="display:block; opacity: 1; transition: opacity .35s ease;">滚轮切换 · Alt+滚轮缩放 · 拖动平移 · ←/→ 切换 · Esc 关闭</div>

                </div>

                <div class="tm-strip-panel">
                    <div id="tm-strip" class="tm-strip"></div>
                </div>
            </div>
        `;
    const $ = (sel) => overlay.querySelector(sel);

    // 顶部操作提示：打开时短暂显示后自动淡出，避免遮挡看图
    const helpEl = $("#tm-help");
    if (helpEl) {
      // 先确保可见
      helpEl.style.opacity = "1";
      // 3 秒后淡出
      setTimeout(() => {
        if (!overlay || !helpEl.isConnected) return;
        helpEl.style.opacity = "0";
      }, 3000);
    }

    bindClick($("#tm-close"), closeSlideshow);

    bindClick($("#tm-prev"), () => show(current - 1));
    bindClick($("#tm-next"), () => show(current + 1));
    bindClick($("#tm-refresh"), () => rebuildAndOpen({ preserveUrl: getCurrentRawUrl() }));
    bindClick($("#tm-loadmore"), () =>
      runLoadMoreRebuild(getCurrentRawUrl())
    );

    bindClick($("#tm-open"), () => {
      if (!list.length) return;
      window.open(list[current].cleanUrl, "_blank", "noopener,noreferrer");
    });

    const copyBtnTimers = new WeakMap();
    function flashCopiedButton(btn) {
      if (!btn) return;
      const timer = copyBtnTimers.get(btn);
      if (timer) clearTimeout(timer);
      if (!btn.dataset.originalText) {
        btn.dataset.originalText = btn.textContent || "复制";
      }
      btn.textContent = "已复制";
      btn.disabled = true;
      const resetTimer = setTimeout(() => {
        btn.textContent = btn.dataset.originalText || "复制";
        btn.disabled = false;
        copyBtnTimers.delete(btn);
      }, 1200);
      copyBtnTimers.set(btn, resetTimer);
    }

    async function copyTextToClipboard(text, successText, btn) {
      const value = String(text || "").trim();
      if (!value) {
        setStatus("无可复制的链接");
        return;
      }
      try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(value);
        } else if (typeof GM_setClipboard === "function") {
          GM_setClipboard(value, "text");
        } else {
          throw new Error("No clipboard API available");
        }
        flashCopiedButton(btn);
        setStatus(successText);
      } catch (err) {
        console.error("复制链接失败：", err);
        setStatus("复制失败，请手动复制");
      }
    }


    // v1.20 两页合一：主图平移/滚轮与快捷键缩放直接在幻灯片里进行
    // （按需求移除：单击 100% 放大/还原）
    const mainImgBtn = $("#tm-main-img");
    bindMainImageZoom(mainImgBtn);

    let wheelLock = 0;
    const canvasEl = $("#tm-canvas");
    wheelHandler = (e) => {
      const dy = e.deltaY || 0;
      if (Math.abs(dy) < 2) return;

      if (e.target instanceof Element && e.target.closest(".tm-navbtn")) return;

      e.preventDefault();
      e.stopPropagation();

      // Alt + 滚轮：缩放主图（原查看器能力合并进本页）
      if (e.altKey) {
        zoomMainBy(dy < 0 ? 1.15 : 1 / 1.15);
        return;
      }

      const now = Date.now();
      if (now - wheelLock < 120) return;

      wheelLock = now;
      if (dy > 0) show(current + 1);
      else show(current - 1);
    };
    canvasEl.addEventListener("wheel", wheelHandler, { passive: false });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeSlideshow();
    });

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);

    cacheOverlayElements();

    setStatus("");
  }

  function openSlideshow(options = {}) {
    if (overlay) return;
    buildOverlay();
    autoLoadNearEndDone = false; // 每次打开画廊重新武装“接近末尾自动加载”
    const loadMore = options.loadMore || SETTINGS.autoLoadMore;
    rebuildAndOpen({ loadMore });
    updateFloatingButtonText();
  }

  function closeSlideshow() {
    if (!overlay) return;

    // ✅ 修复：先清理监听器
    const canvasEl = overlay.querySelector("#tm-canvas");
    if (canvasEl && wheelHandler) {
      canvasEl.removeEventListener("wheel", wheelHandler);
      wheelHandler = null;
    }

    // ✅ 修复：清理 observer
    if (thumbObserver) {
      thumbObserver.disconnect();
      thumbObserver = null;
    }

    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
    cachedEls = null;
    list = [];
    current = 0;
    pendingClickTarget = null;

    updateFloatingButtonText();
  }

  function toggleSlideshow() {
    overlay ? closeSlideshow() : openSlideshow();
  }

  function onKeydown(e) {
    if (!overlay) return;
    // 输入框里不拦截
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;

    const keyHandlers = {
      Escape: closeSlideshow,
      ArrowLeft: () => show(current - 1),
      ArrowRight: () => show(current + 1),
      Home: () => show(0),
      End: () => show(list.length - 1),
      // v1.20 合并页面后的缩放键（原查看器）
      "+": () => zoomMainBy(1.15),
      "=": () => zoomMainBy(1.15),
      "-": () => zoomMainBy(1 / 1.15),
      _: () => zoomMainBy(1 / 1.15),
      "0": () => resetMainZoom(),
    };

    if (keyHandlers[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      keyHandlers[e.key]();
    }
  }

  // =========================================================
  // 工具函数：事件绑定辅助
  // =========================================================
  function bindClick(el, fn) {
    if (!el || typeof fn !== "function") return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn(e);
    });
  }
  function bindEvent(el, type, fn) {
    if (!el || typeof fn !== "function") return;
    el.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn(e);
    });
  }

  function yyyymmdd(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }

  function setBtnPos(btn, left, top) {
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
    btn.style.right = "auto";
    btn.style.bottom = "auto";
  }

  function applyDefaultBtnPosition(btn) {
    btn.style.left = "auto";
    btn.style.top = "auto";
    btn.style.right = `${DEFAULT_BTN_OFFSET}px`;
    btn.style.bottom = `${DEFAULT_BTN_OFFSET}px`;
  }

  // 右下角可拖动按钮
  // =========================================================
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // 格式化文件大小显示
  function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined) return "";

    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "";
    if (n === 0) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const k = 1024;
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
    const size = (n / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0);

    return `${size} ${units[i]}`;
  }

  function applyBtnPosition(btn) {
    const pos = SETTINGS.btnPos;
    if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
      setBtnPos(btn, pos.left, pos.top);

      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = clamp(r.left, 6, vw - r.width - 6);
      const top = clamp(r.top, 6, vh - r.height - 6);
      if (left !== r.left || top !== r.top) {
        setBtnPos(btn, left, top);
        SETTINGS.btnPos = { left, top };
        GM_setValue(STORE_KEYS.BTN_POS, SETTINGS.btnPos);
      }
    } else {
      applyDefaultBtnPosition(btn);
    }
  }

  function injectButton() {
    // 仅在顶层窗口注入，避免 iframe 内重复出现
    if (window.top && window.top !== window) return;

    injectStyles();

    const existed = document.getElementById(BTN_ID);
    if (!SETTINGS.enableButton) {
      if (existed) existed.remove();
      return;
    }
    if (existed || !document.body) return;

    const btn = document.createElement("button");
    const setBtnInteractiveStyle = (state) => {
      const isLocked = SETTINGS.btnPosLocked;
      const nextState = isLocked ? state === "active" : state;
      const styleMap = {
        idle: isLocked
          ? {
              background: "rgba(28,52,86,0.82)",
              borderColor: "rgba(120,190,255,0.34)",
              boxShadow:
                "0 0 0 1px rgba(120,190,255,0.14), 0 10px 26px rgba(8,20,40,0.26)",
              transform: "translateY(0)",
            }
          : {
              background: "rgba(18,18,20,0.72)",
              borderColor: "rgba(255,255,255,0.14)",
              boxShadow: "none",
              transform: "translateY(0)",
            },
        hover: isLocked
          ? {
              background: "rgba(34,62,102,0.86)",
              borderColor: "rgba(144,205,255,0.46)",
              boxShadow:
                "0 0 0 1px rgba(120,190,255,0.18), 0 12px 28px rgba(10,24,48,0.30)",
              transform: "translateY(-1px)",
            }
          : {
              background: "rgba(28,28,32,0.82)",
              borderColor: "rgba(255,255,255,0.22)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
              transform: "translateY(-1px)",
            },
        active: {
          background: isLocked ? "rgba(32,58,96,0.88)" : "rgba(36,36,42,0.9)",
          borderColor: isLocked
            ? "rgba(144,205,255,0.52)"
            : "rgba(255,255,255,0.28)",
          boxShadow: isLocked
            ? "0 0 0 1px rgba(120,190,255,0.22), 0 8px 20px rgba(10,24,48,0.24)"
            : "0 6px 16px rgba(0,0,0,0.26)",
          transform: "translateY(0)",
        },
      };
      const style = styleMap[nextState] || styleMap.idle;
      btn.style.background = style.background;
      btn.style.borderColor = style.borderColor;
      btn.style.boxShadow = style.boxShadow;
      btn.style.transform = style.transform;
    };

    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "图片";
    btn.title = SETTINGS.btnPosLocked
      ? "图片按钮位置已锁定：可点击打开，但不可拖动"
      : "可拖动图片按钮位置";
    btn.setAttribute("aria-label", btn.title);
    btn.style.cssText = `
            position: fixed;
            z-index: 2147483645;
            padding: 12px 16px;
            border: 1px solid ${
              SETTINGS.btnPosLocked
                ? "rgba(120,190,255,0.34)"
                : "rgba(255,255,255,0.14)"
            };
            border-radius: 14px;
            background: ${
              SETTINGS.btnPosLocked
                ? "rgba(28,52,86,0.82)"
                : "rgba(18,18,20,0.72)"
            };
            color: rgba(255,255,255,0.92);
            cursor: ${SETTINGS.btnPosLocked ? "default" : "pointer"};
            box-shadow: ${
              SETTINGS.btnPosLocked
                ? "0 0 0 1px rgba(120,190,255,0.14), 0 10px 26px rgba(8,20,40,0.26)"
                : "none"
            };
            user-select: none;
            touch-action: none;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            transition: transform .15s ease, box-shadow .2s ease, background .15s ease, border-color .15s ease;
            font-family: var(--tm-font);
            font-size: 16px;
            font-weight: 900;
            letter-spacing: .4px;
        `;
    setBtnInteractiveStyle("idle");

    let dragging = false;
    let moved = false;
    let startX = 0,
      startY = 0;
    let startLeft = 0,
      startTop = 0;

    const getRectLT = () => {
      const r = btn.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    };

    bindEvent(btn, "pointerenter", () => {
      if (dragging) return;
      setBtnInteractiveStyle("hover");
    });
    bindEvent(btn, "pointerleave", () => {
      if (dragging) return;
      setBtnInteractiveStyle("idle");
    });

    bindEvent(btn, "pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType !== "touch") return;
      setBtnInteractiveStyle("active");
      if (SETTINGS.btnPosLocked) return;
      btn.setPointerCapture?.(e.pointerId);

      dragging = true;
      moved = false;

      const r = getRectLT();
      startLeft = r.left;
      startTop = r.top;
      startX = e.clientX;
      startY = e.clientY;
    });

    bindEvent(btn, "pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;

      const r = getRectLT();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let newLeft = clamp(startLeft + dx, 6, vw - r.w - 6);
      let newTop = clamp(startTop + dy, 6, vh - r.h - 6);

      setBtnPos(btn, newLeft, newTop);
    });

    const endDrag = (e) => {
      const hadPointerCapture = dragging;
      if (hadPointerCapture) {
        dragging = false;
        btn.releasePointerCapture?.(e.pointerId);
      }

      setBtnInteractiveStyle("idle");
      if (!hadPointerCapture) return;
      if (!moved) return;
      const r = getRectLT();
      SETTINGS.btnPos = { left: r.left, top: r.top };
      GM_setValue(STORE_KEYS.BTN_POS, SETTINGS.btnPos);
    };

    bindEvent(btn, "pointerup", endDrag);
    bindEvent(btn, "pointercancel", endDrag);
    bindEvent(btn, "lostpointercapture", () => {
      dragging = false;
      setBtnInteractiveStyle("idle");
    });

    bindClick(btn, () => {
      if (moved) return;
      toggleSlideshow();
    });

    document.body.appendChild(btn);
    applyBtnPosition(btn);
  }

  // =========================================================
  // v1.20 需求3：点击网页图片直接进入画廊
  // =========================================================
  const OWN_UI_SELECTOR = [
    `#${BTN_ID}`,
    "#tm-img-slide-overlay",
  ].join(",");

  function onDocumentImageClick(e) {
    if (!isClickOpenEnabled()) return;
    if (e.defaultPrevented) return;
    if (e.button !== 0 && e.button !== undefined) return;
    // 修饰键点击保留网页原本行为（新标签打开、站点自身逻辑等）
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (overlay) return;
    if (window !== window.top) return;

    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest(OWN_UI_SELECTOR)) return;

    let imgEl = null;
    if (target instanceof HTMLImageElement) imgEl = target;
    else {
      const inner = target.querySelector?.("img");
      if (inner) imgEl = inner;
      else imgEl = target.closest?.("img") || null;
    }
    if (!imgEl || !(imgEl instanceof HTMLImageElement)) return;

    const src = imgEl.currentSrc || imgEl.src || "";
    if (!src) return;

    // 太小的（图标/头像/logo）不劫持
    const rect = imgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (rect.width < 60 || rect.height < 60) return;
    } else if ((imgEl.naturalWidth || 0) < 60) {
      return;
    }

    // 不劫持明显非图片扩展名的资源
    const cleanSrc = src.split("#")[0].split("?")[0];
    if (cleanSrc && /\.(?:js|css|woff2?|ttf|mp4|webm)(?:$)/i.test(cleanSrc))
      return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }

    // 记录目标（rawUrl 原样地址，用于扫描后精确定位）
    pendingClickTarget = { rawUrl: src, el: imgEl };
    if (overlay) {
      rebuildAndOpen({ preserveUrl: src });
    } else {
      openSlideshow();
    }
  }

  function installClickImageOpen() {
    if (window !== window.top) return;
    document.addEventListener("click", onDocumentImageClick, true);
  }

  // =========================================================
  // 菜单项
  // =========================================================
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand(
      "点击图片直开画廊：加入/移出当前站点白名单",
      toggleClickOpenWhitelist
    );
  }

  // =========================================================
  // 启动
  // =========================================================
  installClickImageOpen();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectButton);
  } else {
    injectButton();
  }
})();
