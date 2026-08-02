/**
 * AI 生图服务与 3D 药品视觉立绘生成器 (AI 3D Medication Visual Generator)
 * 
 * 融合参考图 2 悬浮 3D 药瓶/产品与微拟物精致卡片的设计，
 * 为未上传照片的药品提供动态生成的 3D 高精视觉立绘。
 */

export interface Med3DVisualConfig {
  form: 'bottle' | 'capsule' | 'tablet' | 'syrup' | 'box';
  primaryColor: string;
  secondaryColor: string;
  label: string;
}

/** 预设高精 3D 视觉配色盘 */
const PALETTES = [
  { primary: '#818cf8', secondary: '#c084fc' }, // 薰衣草淡紫渐变
  { primary: '#38bdf8', secondary: '#818cf8' }, // 天蓝冷紫渐变
  { primary: '#f43f5e', secondary: '#fb7185' }, // 珊瑚蜜桃渐变
  { primary: '#10b981', secondary: '#34d399' }, // 薄荷翡翠渐变
  { primary: '#fbbf24', secondary: '#f59e0b' }, // 琥珀暖橙渐变
];

/** 根据药品名称哈希生成稳定的 3D 配色与造型 */
export function getMed3DConfig(medName: string, dosageText?: string): Med3DVisualConfig {
  let hash = 0;
  for (let i = 0; i < medName.length; i++) {
    hash = (hash << 5) - hash + medName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTES.length;
  const palette = PALETTES[index];

  // 根据剂量描述猜测形态
  let form: Med3DVisualConfig['form'] = 'bottle';
  const text = (medName + ' ' + (dosageText || '')).toLowerCase();
  if (text.includes('胶囊') || text.includes('capsule')) {
    form = 'capsule';
  } else if (text.includes('片') || text.includes('丸') || text.includes('tablet')) {
    form = 'tablet';
  } else if (text.includes('液') || text.includes('浆') || text.includes('滴') || text.includes('syrup')) {
    form = 'syrup';
  } else if (text.includes('盒') || text.includes('贴') || text.includes('散') || text.includes('粉')) {
    form = 'box';
  }

  const selectedPalette = palette ?? PALETTES[0];
  if (!selectedPalette) throw new Error('缺少药品视觉配色');
  return {
    form,
    primaryColor: selectedPalette.primary,
    secondaryColor: selectedPalette.secondary,
    label: medName.slice(0, 4),
  };
}

/** 生成精致的 3D 矢量视觉 SVG Data URL（无依赖秒出图，高度拟真参考图 2 悬浮产品） */
export function generate3DMedSvgDataUrl(config: Med3DVisualConfig): string {
  const { form, primaryColor, secondaryColor, label } = config;
  const gradId = `g_${Math.random().toString(36).substring(2, 8)}`;
  const shadowId = `s_${Math.random().toString(36).substring(2, 8)}`;

  let innerContent = '';

  if (form === 'bottle') {
    // 3D 亮面药瓶（对应参考图 2 摇摇杯瓶身）
    innerContent = `
      <ellipse cx="60" cy="100" rx="36" ry="10" fill="url(#${shadowId})" opacity="0.4"/>
      <rect x="42" y="24" width="36" height="14" rx="4" fill="#ffffff" opacity="0.9" />
      <rect x="46" y="20" width="28" height="6" rx="2" fill="${secondaryColor}" />
      <rect x="30" y="36" width="60" height="64" rx="18" fill="url(#${gradId})" />
      <!-- 高光面 -->
      <path d="M 36 44 Q 34 68 40 92" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.45" fill="none" />
      <!-- 瓶身贴纸 -->
      <rect x="40" y="52" width="40" height="32" rx="8" fill="#ffffff" opacity="0.92" />
      <circle cx="60" cy="64" r="6" fill="${primaryColor}" opacity="0.8"/>
      <text x="60" y="78" font-size="8" font-weight="bold" fill="${primaryColor}" text-anchor="middle">${label}</text>
    `;
  } else if (form === 'capsule') {
    // 3D 双色立体胶囊
    innerContent = `
      <ellipse cx="60" cy="98" rx="34" ry="8" fill="url(#${shadowId})" opacity="0.4"/>
      <g transform="rotate(-30 60 60)">
        <path d="M 32 30 A 24 24 0 0 1 88 30 L 88 60 L 32 60 Z" fill="url(#${gradId})" />
        <path d="M 32 60 L 88 60 L 88 90 A 24 24 0 0 1 32 90 Z" fill="#ffffff" />
        <rect x="32" y="57" width="56" height="6" fill="${secondaryColor}" opacity="0.8"/>
        <!-- 胶囊高光 -->
        <path d="M 40 28 A 16 16 0 0 1 76 28" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.5" fill="none"/>
      </g>
    `;
  } else if (form === 'tablet') {
    // 3D 药片 / 刻痕圆片
    innerContent = `
      <ellipse cx="60" cy="96" rx="38" ry="10" fill="url(#${shadowId})" opacity="0.35"/>
      <ellipse cx="60" cy="64" rx="38" ry="24" fill="${secondaryColor}" opacity="0.4" />
      <ellipse cx="60" cy="56" rx="38" ry="24" fill="url(#${gradId})" />
      <!-- 中缝刻痕与高光 -->
      <line x1="60" y1="36" x2="60" y2="76" stroke="#ffffff" stroke-width="3" opacity="0.6" stroke-linecap="round" />
      <ellipse cx="52" cy="46" rx="20" ry="10" fill="#ffffff" opacity="0.3" />
    `;
  } else {
    // 3D 立体药盒 / 包装盒
    innerContent = `
      <ellipse cx="60" cy="100" rx="40" ry="9" fill="url(#${shadowId})" opacity="0.4"/>
      <path d="M 28 36 L 60 22 L 92 36 L 92 84 L 60 96 L 28 84 Z" fill="url(#${gradId})" />
      <path d="M 60 22 L 92 36 L 60 50 L 28 36 Z" fill="#ffffff" opacity="0.3" />
      <path d="M 60 50 L 92 36 L 92 84 L 60 96 Z" fill="${secondaryColor}" opacity="0.25" />
      <rect x="38" y="52" width="44" height="24" rx="6" fill="#ffffff" opacity="0.9" />
      <circle cx="60" cy="64" r="6" fill="${primaryColor}"/>
    `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${primaryColor}" />
          <stop offset="100%" stop-color="${secondaryColor}" />
        </linearGradient>
        <radialGradient id="${shadowId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#1e202e" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#1e202e" stop-opacity="0" />
        </radialGradient>
      </defs>
      ${innerContent}
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 本地 AI 生图缓存 (medId -> 3D Image Data URL) */
const aiImageCache = new Map<string, string>();

/** 为药品生成/读取 3D 视觉立绘 Data URL */
export function getOrCreateMed3DImage(medId: string, medName: string, dosageText?: string): string {
  const cached = aiImageCache.get(medId);
  if (cached) return cached;

  const config = getMed3DConfig(medName, dosageText);
  const dataUrl = generate3DMedSvgDataUrl(config);
  aiImageCache.set(medId, dataUrl);
  return dataUrl;
}
