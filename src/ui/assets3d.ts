import purpleBottleImg from '../assets/images3d/purple-bottle.png';
import clockPillImg from '../assets/images3d/clock-pill.png';
import aidBagImg from '../assets/images3d/aid-bag.png';
import pillboxBannerImg from '../assets/images3d/pillbox-banner.png';
import floatingPillImg from '../assets/images3d/floating-pill.png';
import userAvatarImg from '../assets/images3d/user-avatar.png';
import statNotebookImg from '../assets/images3d/stat-notebook.png';
import statPillboxImg from '../assets/images3d/stat-pillbox.png';
import statTargetImg from '../assets/images3d/stat-target.png';
import natureBokehImg from '../assets/images3d/nature-header-bokeh.png';
import todayFloatingCapsuleImg from '../assets/images3d/today-floating-capsule.png';
import inventoryHealthShieldImg from '../assets/images3d/inventory-health-shield.png';
import medBottle3dImg from '../assets/images3d/med-bottle-3d.png';
import medRecentMortarImg from '../assets/images3d/med-recent-mortar.png';
import medAidKit3dImg from '../assets/images3d/med-aid-kit-3d.png';
import userAvatar3dImg from '../assets/images3d/user-avatar-3d.png';

export {
  purpleBottleImg,
  clockPillImg,
  aidBagImg,
  pillboxBannerImg,
  floatingPillImg,
  userAvatarImg,
  statNotebookImg,
  statPillboxImg,
  statTargetImg,
  natureBokehImg,
  todayFloatingCapsuleImg,
  inventoryHealthShieldImg,
  medBottle3dImg,
  medRecentMortarImg,
  medAidKit3dImg,
  userAvatar3dImg,
};

const svgParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
const trackedBlobUrls = new Set<string>();

export function trackMediaBlobUrl(url: string): string {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    trackedBlobUrls.add(url);
  }
  return url;
}

export function revokeTrackedMediaBlobUrls(): void {
  for (const url of trackedBlobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  trackedBlobUrls.clear();
}

export function safeRevokeMediaUrl(url: string | null | undefined): void {
  if (url && typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
      trackedBlobUrls.delete(url);
    } catch {
      /* ignore */
    }
  }
}

export function parseSvg(rawSvg: string): SVGSVGElement {
  const fallback = () => document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  if (!svgParser) {
    return fallback();
  }
  try {
    const doc = svgParser.parseFromString(rawSvg, 'image/svg+xml');
    const parsed = doc.documentElement;
    if (
      !(parsed instanceof SVGSVGElement) ||
      parsed.nodeName.toLowerCase() === 'parsererror' ||
      doc.querySelector('parsererror')
    ) {
      return fallback();
    }
    return parsed;
  } catch {
    return fallback();
  }
}

export function cleanup3dMedia(container: HTMLElement | null | undefined): void {
  if (!container) return;
  const imgs = container.querySelectorAll('img');
  imgs.forEach((img) => {
    if (img.src && img.src.startsWith('blob:')) {
      safeRevokeMediaUrl(img.src);
    }
    img.removeAttribute('src');
    img.remove();
  });
}

export function render3dMedia(
  imageSrc: string,
  fallbackSvgFn: () => string,
  alt: string,
  className = 'asset-3d-img',
): HTMLElement {
  const container = document.createElement('div');
  container.className = `asset-3d-container ${className}-wrap`;

  if (!imageSrc) {
    try {
      container.append(parseSvg(fallbackSvgFn()));
    } catch {
      // error bounds fallback
    }
    return container;
  }

  if (imageSrc.startsWith('blob:')) {
    trackMediaBlobUrl(imageSrc);
  }

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = alt;
  img.className = className;
  img.onerror = () => {
    img.remove();
    try {
      container.append(parseSvg(fallbackSvgFn()));
    } catch {
      // error bounds fallback
    }
  };

  img.src = imageSrc;
  container.append(img);
  return container;
}

/** 1. 3D 药瓶与药片（药品库 - 全部分品） */
export function getMedBottle3dSvg(): string {
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-svg">
      <defs>
        <filter id="mb-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#236a55" flood-opacity="0.35"/>
        </filter>
        <linearGradient id="mb-bottle" x1="20" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#34d399"/>
          <stop offset="50%" stop-color="#2a8369"/>
          <stop offset="100%" stop-color="#236a55"/>
        </linearGradient>
        <linearGradient id="mb-cap" x1="36" y1="14" x2="64" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#e3ede6"/>
        </linearGradient>
        <linearGradient id="mb-pill" x1="55" y1="65" x2="85" y2="85" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#a7c4b5"/>
          <stop offset="100%" stop-color="#236a55"/>
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="88" rx="32" ry="7" fill="#236a55" opacity="0.18"/>
      <g filter="url(#mb-glow)">
        <rect x="28" y="28" width="44" height="52" rx="14" fill="url(#mb-bottle)"/>
        <rect x="36" y="22" width="28" height="9" rx="3" fill="#a7c4b5"/>
        <rect x="33" y="15" width="34" height="10" rx="4" fill="url(#mb-cap)"/>
        <rect x="36" y="42" width="28" height="26" rx="6" fill="#ffffff" opacity="0.92"/>
        <rect x="42" y="48" width="16" height="4" rx="2" fill="#2a8369"/>
        <rect x="44" y="55" width="12" height="3" rx="1.5" fill="#a7c4b5"/>
        <path d="M 33 34 Q 31 52 35 72" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
        <circle cx="65" cy="34" r="2.5" fill="#ffffff" opacity="0.6"/>
      </g>
      <ellipse cx="68" cy="76" rx="11" ry="7" fill="url(#mb-pill)" transform="rotate(-15 68 76)"/>
      <ellipse cx="68" cy="74" rx="10" ry="5.5" fill="#e3ede6" transform="rotate(-15 68 76)"/>
      <line x1="62" y1="72" x2="74" y2="76" stroke="#236a55" stroke-width="1.5" opacity="0.7"/>
    </svg>`;
}

/** 2. 薄荷绿 3D 闹钟与胶囊（药品库 - 近期使用） */
export function getClockPill3dSvg(): string {
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-svg">
      <defs>
        <filter id="cp-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#2dd4bf" flood-opacity="0.32"/>
        </filter>
        <linearGradient id="cp-bg" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#5eead4"/>
          <stop offset="100%" stop-color="#0d9488"/>
        </linearGradient>
        <linearGradient id="cp-rim" x1="24" y1="24" x2="76" y2="76" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#ccfbf1"/>
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="86" rx="28" ry="6" fill="#0f766e" opacity="0.16"/>
      <g filter="url(#cp-glow)">
        <circle cx="50" cy="50" r="32" fill="url(#cp-bg)"/>
        <circle cx="50" cy="50" r="26" fill="url(#cp-rim)" opacity="0.95"/>
        <circle cx="50" cy="50" r="21" fill="#ffffff"/>
        <circle cx="50" cy="50" r="3" fill="#0d9488"/>
        <line x1="50" y1="50" x2="50" y2="36" stroke="#0d9488" stroke-width="3" stroke-linecap="round"/>
        <line x1="50" y1="50" x2="60" y2="50" stroke="#14b8a6" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="50" cy="33" r="1.5" fill="#0f766e"/>
        <circle cx="67" cy="50" r="1.5" fill="#0f766e"/>
        <circle cx="50" cy="67" r="1.5" fill="#0f766e"/>
        <circle cx="33" cy="50" r="1.5" fill="#0f766e"/>
        <rect x="34" y="16" width="7" height="4" rx="2" fill="#2dd4bf" transform="rotate(-30 34 16)"/>
        <rect x="59" y="14" width="7" height="4" rx="2" fill="#2dd4bf" transform="rotate(30 59 14)"/>
      </g>
    </svg>`;
}

/** 3. 珊瑚粉 3D 急救箱/袋（药品库 - 需要补充） */
export function getAidBag3dSvg(): string {
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-svg">
      <defs>
        <filter id="ab-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#f43f5e" flood-opacity="0.32"/>
        </filter>
        <linearGradient id="ab-box" x1="20" y1="28" x2="80" y2="88" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fda4af"/>
          <stop offset="50%" stop-color="#fb7185"/>
          <stop offset="100%" stop-color="#e11d48"/>
        </linearGradient>
        <linearGradient id="ab-handle" x1="38" y1="16" x2="62" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#ffe4e6"/>
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="86" rx="30" ry="6" fill="#be123c" opacity="0.18"/>
      <g filter="url(#ab-glow)">
        <path d="M 40 28 Q 50 20 60 28" stroke="url(#ab-handle)" stroke-width="6" stroke-linecap="round" fill="none"/>
        <rect x="22" y="28" width="56" height="50" rx="14" fill="url(#ab-box)"/>
        <rect x="25" y="32" width="50" height="42" rx="11" fill="#ffffff" opacity="0.12"/>
        <rect x="44" y="40" width="12" height="26" rx="4" fill="#ffffff"/>
        <rect x="37" y="47" width="26" height="12" rx="4" fill="#ffffff"/>
        <circle cx="50" cy="53" r="3" fill="#fb7185"/>
      </g>
    </svg>`;
}

/** 4. 3D 智能分药机 / 药盒横幅插画（分药助手） */
export function getPillboxMachine3dSvg(): string {
  return `<svg viewBox="0 0 240 120" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-banner-svg">
      <defs>
        <filter id="pm-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#236a55" flood-opacity="0.25"/>
        </filter>
        <linearGradient id="pm-body" x1="40" y1="20" x2="200" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#34d399"/>
          <stop offset="100%" stop-color="#236a55"/>
        </linearGradient>
        <linearGradient id="pm-tray" x1="60" y1="40" x2="180" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#e3ede6"/>
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="108" rx="85" ry="10" fill="#175940" opacity="0.25"/>
      <g filter="url(#pm-glow)">
        <rect x="40" y="24" width="160" height="80" rx="20" fill="url(#pm-body)"/>
        <rect x="48" y="32" width="144" height="42" rx="12" fill="url(#pm-tray)"/>
        <line x1="84" y1="32" x2="84" y2="74" stroke="#a7c4b5" stroke-width="2"/>
        <line x1="120" y1="32" x2="120" y2="74" stroke="#a7c4b5" stroke-width="2"/>
        <line x1="156" y1="32" x2="156" y2="74" stroke="#a7c4b5" stroke-width="2"/>
        <!-- 药盒内彩色小药丸 -->
        <circle cx="66" cy="53" r="7" fill="#fb7185"/>
        <circle cx="102" cy="53" r="6.5" fill="#38bdf8"/>
        <circle cx="138" cy="53" r="7" fill="#facc15"/>
        <circle cx="174" cy="53" r="6.5" fill="#34d399"/>
        <!-- 下方控制指示灯与按钮 -->
        <circle cx="70" cy="88" r="4" fill="#34d399"/>
        <circle cx="85" cy="88" r="4" fill="#60a5fa"/>
        <rect x="130" y="82" width="55" height="12" rx="6" fill="#ffffff" opacity="0.9"/>
        <rect x="135" y="85" width="20" height="6" rx="3" fill="#236a55"/>
      </g>
    </svg>`;
}

/** 5. 3D 浮动胶囊药丸（服药确认弹窗） */
export function getTakeMedPill3dSvg(): string {
  return `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-floating-pill">
      <defs>
        <filter id="tp-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#236a55" flood-opacity="0.35"/>
        </filter>
        <linearGradient id="tp-cap-left" x1="20" y1="20" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#34d399"/>
          <stop offset="100%" stop-color="#236a55"/>
        </linearGradient>
        <linearGradient id="tp-cap-right" x1="60" y1="60" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#0284c7"/>
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="106" rx="36" ry="8" fill="#175940" opacity="0.25"/>
      <g filter="url(#tp-glow)" transform="rotate(-30 60 60)">
        <rect x="30" y="38" width="60" height="44" rx="22" fill="url(#tp-cap-right)"/>
        <path d="M 30 60 A 22 22 0 0 1 52 38 L 60 38 L 60 82 L 52 82 A 22 22 0 0 1 30 60 Z" fill="url(#tp-cap-left)"/>
        <line x1="60" y1="38" x2="60" y2="82" stroke="#ffffff" stroke-width="2.5" opacity="0.85"/>
        <ellipse cx="48" cy="46" rx="9" ry="3" fill="#ffffff" opacity="0.5" transform="rotate(-15 48 46)"/>
      </g>
    </svg>`;
}

import { getUserAvatarSvg, getActiveAvatarId, getAvatarList, setActiveAvatarId, type AvatarItem } from './avatars';
export { getUserAvatarSvg, getActiveAvatarId, getAvatarList, setActiveAvatarId, type AvatarItem };

/** 6. 3D 用户头像（我的 / 首页顶栏）- 动态根据用户当前选中角色渲染 */
export function getUserAvatar3dSvg(): string {
  return getUserAvatarSvg();
}

/** 7. 3D 统计卡片图标 - 用药记录 (蓝色记事本) */
export function getStatLog3dSvg(): string {
  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="stat-3d-icon">
      <rect x="10" y="8" width="28" height="34" rx="7" fill="#3b82f6"/>
      <rect x="14" y="14" width="14" height="4" rx="2" fill="#ffffff" opacity="0.9"/>
      <rect x="14" y="22" width="20" height="3" rx="1.5" fill="#dbeafe"/>
      <rect x="14" y="28" width="16" height="3" rx="1.5" fill="#dbeafe"/>
      <circle cx="28" cy="34" r="4" fill="#60a5fa"/>
      <path d="M 26.5 34 L 27.5 35 L 29.5 33" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

/** 8. 3D 统计卡片图标 - 分药记录 (橙色分药箱) */
export function getStatBox3dSvg(): string {
  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="stat-3d-icon">
      <rect x="8" y="12" width="32" height="26" rx="6" fill="#f59e0b"/>
      <line x1="24" y1="12" x2="24" y2="38" stroke="#ffffff" stroke-width="2" opacity="0.7"/>
      <line x1="8" y1="25" x2="40" y2="25" stroke="#ffffff" stroke-width="2" opacity="0.7"/>
      <circle cx="16" cy="18" r="2.5" fill="#ffffff" opacity="0.9"/>
      <circle cx="32" cy="31" r="2.5" fill="#ffffff" opacity="0.9"/>
    </svg>`;
}

/** 9. 3D 统计卡片图标 - 服药率 (青绿日历与打卡标) */
export function getStatRate3dSvg(): string {
  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="stat-3d-icon">
      <rect x="9" y="10" width="30" height="30" rx="7" fill="#236a55"/>
      <rect x="9" y="10" width="30" height="9" rx="4" fill="#175940"/>
      <circle cx="16" cy="8" r="2" fill="#e3ede6"/>
      <circle cx="32" cy="8" r="2" fill="#e3ede6"/>
      <circle cx="24" cy="27" r="7" fill="#ffffff" opacity="0.92"/>
      <path d="M 21.5 27 L 23 28.5 L 26.5 25" stroke="#236a55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

/** 10. 3D 统计卡片图标 - 节省费用 (珊瑚红 3D 储蓄袋与浮动金币) */
export function getStatSavings3dSvg(): string {
  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="stat-3d-icon">
      <defs>
        <linearGradient id="st-sav-grad" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fb7185"/>
          <stop offset="100%" stop-color="#e11d48"/>
        </linearGradient>
        <linearGradient id="st-coin-grad" x1="16" y1="16" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fef08a"/>
          <stop offset="100%" stop-color="#eab308"/>
        </linearGradient>
      </defs>
      <rect x="8" y="9" width="32" height="32" rx="8" fill="url(#st-sav-grad)"/>
      <rect x="10" y="11" width="28" height="28" rx="6" stroke="#ffffff" stroke-width="1.2" opacity="0.35"/>
      <circle cx="24" cy="25" r="9" fill="url(#st-coin-grad)"/>
      <circle cx="24" cy="25" r="7.5" stroke="#ffffff" stroke-width="1" opacity="0.8"/>
      <text x="24" y="29" font-size="11" font-weight="900" fill="#713f12" text-anchor="middle" font-family="system-ui, sans-serif">¥</text>
    </svg>`;
}

/** 11. 3D 库存健康盾牌 (翡翠绿与发光打勾) */
export function getInventoryHealthShield3dSvg(): string {
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-svg">
      <defs>
        <linearGradient id="hs-grad" x1="20" y1="15" x2="80" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#34d399"/>
          <stop offset="60%" stop-color="#10b981"/>
          <stop offset="100%" stop-color="#047857"/>
        </linearGradient>
      </defs>
      <path d="M 50 16 L 76 26 C 76 56 50 82 50 82 C 50 82 24 56 24 26 Z" fill="url(#hs-grad)"/>
      <path d="M 40 48 L 47 55 L 63 39" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

/** 12. 3D 今日浮动胶囊 (蓝白高光 45° 倾角) */
export function getTodayFloatingCapsule3dSvg(): string {
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-svg">
      <defs>
        <linearGradient id="fc-blue" x1="25" y1="25" x2="55" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#60a5fa"/>
          <stop offset="100%" stop-color="#2563eb"/>
        </linearGradient>
      </defs>
      <g transform="rotate(-30 50 50)">
        <rect x="25" y="32" width="50" height="36" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
        <path d="M 25 50 A 18 18 0 0 1 43 32 L 50 32 L 50 68 L 43 68 A 18 18 0 0 1 25 50 Z" fill="url(#fc-blue)"/>
      </g>
    </svg>`;
}

