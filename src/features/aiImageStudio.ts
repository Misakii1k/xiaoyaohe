/**
 * AI 药盒生图与修图双模引擎 (AI Medicine Box Image Studio)
 *
 * 同时支持两种格式与接口：
 * 1. 原图修图增强 (/images/edits, multipart/form-data):
 *    - 类似「扫描全能王」，将拍摄药盒照片替换为纯白底、矫正透视并增强字迹清晰度
 *    - 100% 保真保留原图文字、厂商 Logo 与配色
 * 2. 商业文生大图 (/images/generations, application/json):
 *    - 商业静物展台摄影 Prompt 驱动，支持有图（特征提取驱动）与无图（药品特征推测）
 *    - 兼容几乎所有主流 OpenAI 格式生图服务商（DALL·E 3、通义万相、CogView、FLUX 等）
 * 3. 自动回退策略 (Auto Mode):
 *    - 有原图时优先尝试 /images/edits 高保真修图
 *    - 若服务商不支持 edits（返回 404/405/501），自动无缝平滑回退至 /images/generations 文生大图
 * 4. 压缩保护:
 *    - 所有输出统一通过 compressBoxPhoto 限制在 720px / 220KB 内，杜绝 WebView 内存溢出
 */

import { getEffectiveImageGenConfig, getActiveLlmProvider } from '../ai/llmConfig';
import { compressBoxPhoto } from './medPhotos';
import { reportSilentFailure } from '../app/diagnostics';

export interface MedVisualFeatures {
  name: string;
  dosageText: string;
  form?: 'paper_box' | 'bottle' | 'blister_pack' | 'other';
  boxColorTheme?: string;
  featureNotes?: string;
}

export interface GeneratePackshotOptions {
  photoBlob?: Blob;
  name: string;
  dosageText?: string;
  signal?: AbortSignal;
  onProgress?: (stepText: string) => void;
}

export class ImageGenError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'ImageGenError';
  }
}

/** 模式 A (edits)：原图修图 Prompt 预设 */
export const PROMPT_CLEAN = [
  'Clean up this medicine box photo: remove the background and replace with pure white,',
  'enhance sharpness and contrast, correct perspective distortion.',
  'Keep every text character, logo, color, and layout element exactly as they appear in the original.',
  'Do not redesign, do not add or remove any visual elements.',
].join(' ');

export const PROMPT_SCANNER = [
  'Process this medicine packaging photo as a high-quality flatbed scanner would:',
  'pure white background, even lighting, no shadows, corrected perspective to perfectly rectangular,',
  'enhanced text sharpness.',
  'Preserve all original text, logos, graphics, and colors with 100% fidelity.',
  'Do not alter, redesign, or reinterpret any part of the packaging.',
].join(' ');

/** edits 模式默认生效的修图 Prompt */
const ACTIVE_EDIT_PROMPT = PROMPT_SCANNER;

/** 模式 B (generations)：构建用于商业展台摄影的 Prompt */
export function buildStudioPackshotPrompt(features: MedVisualFeatures): string {
  const title = features.name.trim() || 'Pharmaceutical Medicine';
  const spec = features.dosageText.trim() ? `with printed specification "${features.dosageText.trim()}"` : '';
  const colors = features.boxColorTheme?.trim() || 'clean clinical white and pharmaceutical green or blue';
  const notes = features.featureNotes?.trim() || 'clean minimalist clinical packaging style';
  const formDesc = features.form === 'bottle'
    ? 'cylindrical medical plastic pill bottle with white safety screw cap and clean printed label'
    : 'crisp rectangular pharmaceutical paper packaging carton box';

  return [
    `Commercial pharmaceutical product photography, studio packshot of a single ${formDesc}.`,
    `Seamless pure white background with soft subtle contact drop shadow directly beneath the base of the box.`,
    `Three-quarter isometric front perspective view, showing both the front panel and one side panel cleanly.`,
    `The packaging prominently and legibly displays the medicine name "${title}" in sharp, crisp typography, ${spec}.`,
    `Packaging color palette: ${colors}. Graphic design details: ${notes}.`,
    `Studio softbox diffuse lighting, 8k resolution, razor-sharp focus, professional medical advertisement product shot, immaculate paper texture, straight edges, no background clutter, no hands, no human.`,
  ].join(' ');
}

/** 从药名中推测默认的包装形式与色系（无原图或特征提取失败时的保底） */
export function inferDefaultVisualFeatures(name: string, dosageText?: string): MedVisualFeatures {
  const lower = (name + ' ' + (dosageText || '')).toLowerCase();
  let form: MedVisualFeatures['form'] = 'paper_box';
  let boxColorTheme = 'clean medical white and cyan-blue accents';

  if (lower.includes('瓶') || lower.includes('糖浆') || lower.includes('滴剂') || lower.includes('喷雾')) {
    form = 'bottle';
    boxColorTheme = 'amber translucent bottle with clean white printed label';
  } else if (lower.includes('胶囊')) {
    form = 'paper_box';
    boxColorTheme = 'crisp white carton with coral red and navy blue modern waves';
  } else if (lower.includes('钙') || lower.includes('维') || lower.includes('素')) {
    form = 'paper_box';
    boxColorTheme = 'crisp white carton with emerald green and sky blue medical banners';
  } else if (lower.includes('消炎') || lower.includes('头孢') || lower.includes('阿莫西林')) {
    form = 'paper_box';
    boxColorTheme = 'pure white carton with royal blue stripe and red cross logo';
  }

  return {
    name,
    dosageText: dosageText || '',
    form,
    boxColorTheme,
    featureNotes: 'standard modern Chinese pharmaceutical package styling, sleek layout',
  };
}

/** 提取原图包装视觉特征（若失败则优雅回退至默认推测） */
export async function extractVisualFeatures(
  photoBlob: Blob,
  name: string,
  dosageText?: string,
  signal?: AbortSignal,
): Promise<MedVisualFeatures> {
  const fallback = inferDefaultVisualFeatures(name, dosageText);
  const activeLlm = getActiveLlmProvider();
  if (!activeLlm.baseUrl || !activeLlm.apiKey) return fallback;

  try {
    const base64 = await blobToBase64(photoBlob);
    if (signal?.aborted) return fallback;

    const chatUrl = resolveChatEndpoint(activeLlm.baseUrl);
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + activeLlm.apiKey,
      },
      body: JSON.stringify({
        model: activeLlm.model,
        messages: [
          {
            role: 'system',
            content:
              '你是医药包装视觉分析助手。观察该药盒照片，提取其外观特征并仅输出严格 JSON，不要 markdown、不要解释。'
              + '格式：{"name":"药名，可参考用户提供","dosageText":"规格","boxColorTheme":"包装主辅配色描述，如：纯白底配蓝绿条纹","form":"paper_box或bottle","featureNotes":"包装主要图案特征用英文简述，如：green wave pattern with silver logo"}',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `已知药名: ${name || '未知'}, 规格: ${dosageText || '未知'}。请分析图中的药盒包装外观。`,
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64}` },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    });

    if (!resp.ok) return fallback;
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content) as Partial<MedVisualFeatures>;
    return {
      name: (parsed.name || name || fallback.name).trim(),
      dosageText: (parsed.dosageText || dosageText || fallback.dosageText).trim(),
      form: parsed.form === 'bottle' ? 'bottle' : 'paper_box',
      boxColorTheme: parsed.boxColorTheme || fallback.boxColorTheme,
      featureNotes: parsed.featureNotes || fallback.featureNotes,
    };
  } catch (error) {
    reportSilentFailure('aiImageStudio.extractFeatures', error);
    return fallback;
  }
}

/** 核心调度入口：根据配置与入参调用 edits 或 generations 接口，并自动平滑回退 */
export async function generateMedPackshot(options: GeneratePackshotOptions): Promise<Blob> {
  const { photoBlob, name, dosageText, signal, onProgress } = options;

  const config = getEffectiveImageGenConfig();
  if (!config.isConfigured) {
    throw new ImageGenError('未配置 AI 生图服务（请在「设置」中配置生图 API 或主 AI 密钥）');
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const mode = config.endpointMode || 'auto';
  const cleanBaseUrl = config.baseUrl.trim();

  // 文生大图工作流（支持可选参考图进行图生图）
  const runGenerations = async (referencePhotoBase64?: string): Promise<Blob> => {
    let features: MedVisualFeatures;
    if (photoBlob && photoBlob.size > 0) {
      onProgress?.('正在分析药盒外观特征…');
      features = await extractVisualFeatures(photoBlob, name, dosageText, signal);
    } else {
      features = inferDefaultVisualFeatures(name, dosageText);
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const prompt = buildStudioPackshotPrompt(features);
    onProgress?.(referencePhotoBase64 ? '正在通过图生图生成展台药盒…' : '正在生成商业级展台大图…');

    const imageUrl = resolveImageGenUrl(cleanBaseUrl);
    let raw: Blob;
    try {
      raw = await requestImageGeneration(imageUrl, config, prompt, true, signal, referencePhotoBase64);
    } catch (firstErr) {
      if (signal?.aborted) throw firstErr;
      // 若携带参考图图生图失败，回退尝试纯文生图
      if (referencePhotoBase64) {
        try {
          return await runGenerations(undefined);
        } catch {
          // 继续向下尝试无 b64 的普通模式
        }
      }
      // 部分服务商不支持 Base64，回退至普通 url 模式
      try {
        raw = await requestImageGeneration(imageUrl, config, prompt, false, signal);
      } catch {
        throw firstErr;
      }
    }
    return raw;
  };

  // 原图修图工作流
  const runEdits = async (): Promise<Blob> => {
    if (!photoBlob || photoBlob.size === 0) {
      throw new ImageGenError('修图模式需要药盒照片，请先拍照或选图');
    }
    onProgress?.('正在通过修图接口增强药盒照片…');
    const editUrl = resolveImageEditUrl(cleanBaseUrl);
    const contextHint = name.trim()
      ? ` The medicine name on the box is "${name.trim()}"${dosageText?.trim() ? `, specification: "${dosageText.trim()}"` : ''}.`
      : '';
    const prompt = ACTIVE_EDIT_PROMPT + contextHint;
    return await requestImageEdit(editUrl, config, photoBlob, prompt, signal);
  };

  let rawBlob: Blob;
  const modelLower = config.model.toLowerCase();
  const isAgnes = modelLower.includes('agnes');

  if (mode === 'generations' || cleanBaseUrl.endsWith('/images/generations')) {
    const photoB64 = (photoBlob && photoBlob.size > 0 && isAgnes) ? await blobToBase64(photoBlob) : undefined;
    rawBlob = await runGenerations(photoB64);
  } else if (mode === 'edits' || cleanBaseUrl.endsWith('/images/edits')) {
    try {
      rawBlob = await runEdits();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof ImageGenError && (error.statusCode === 404 || error.statusCode === 405)) {
        throw new ImageGenError(
          '当前 AI 服务商不支持图片编辑接口（/images/edits）。请在设置中切换为「文生大图」模式或更换为支持该接口的模型（如 GPT Image 系列）。',
          error.statusCode,
        );
      }
      throw error;
    }
  } else {
    // 自动模式 (auto)
    if (photoBlob && photoBlob.size > 0) {
      if (isAgnes) {
        // Agnes 原生在 /images/generations 中通过 extra_body.image 实现图生图
        onProgress?.('正在通过图生图接口增强药盒照片…');
        const photoB64 = await blobToBase64(photoBlob);
        rawBlob = await runGenerations(photoB64);
      } else {
        try {
          rawBlob = await runEdits();
        } catch (error) {
          if (signal?.aborted) throw error;
          onProgress?.('当前服务商不支持修图接口，正在自动切换为图生图/文生大图…');
          const photoB64 = await blobToBase64(photoBlob);
          try {
            rawBlob = await runGenerations(photoB64);
          } catch {
            rawBlob = await runGenerations(undefined);
          }
        }
      }
    } else {
      // 没有原图时直接文生大图
      rawBlob = await runGenerations();
    }
  }

  if (!rawBlob || rawBlob.size === 0) {
    throw new ImageGenError('AI 未返回有效的图片数据');
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  onProgress?.('正在压缩优化药盒图片…');
  const compressed = await compressBoxPhoto(rawBlob);
  return compressed;
}

/** 通过 multipart/form-data 调用 /images/edits 接口 */
export async function requestImageEdit(
  url: string,
  config: { apiKey: string; model: string },
  imageBlob: Blob,
  prompt: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const form = new FormData();
  const imageFile = new File(
    [imageBlob],
    'medicine_box.png',
    { type: imageBlob.type || 'image/png' },
  );
  form.append('image', imageFile);
  form.append('prompt', prompt);
  form.append('model', config.model);
  form.append('n', '1');
  form.append('size', '1024x1024');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + config.apiKey,
    },
    body: form,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({})) as { error?: { message?: string } | string };
    const msg = typeof errorData.error === 'string'
      ? errorData.error
      : errorData.error?.message || `图片编辑服务返回异常（HTTP ${resp.status}）`;
    throw new ImageGenError(msg, resp.status);
  }

  const json = await resp.json() as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const item = json.data?.[0];
  if (!item) throw new ImageGenError('服务商返回的数据中没有包含图片');

  if (item.b64_json) {
    return base64ToBlob(item.b64_json, 'image/png');
  }

  if (item.url) {
    const imgResp = await fetch(item.url, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!imgResp.ok) throw new ImageGenError(`拉取增强后的图片失败（HTTP ${imgResp.status}）`);
    return await imgResp.blob();
  }

  throw new ImageGenError('未能从返回结果中解析出图片');
}

/** 通过 JSON 调用 /images/generations 接口 */
export async function requestImageGeneration(
  url: string,
  config: { apiKey: string; model: string },
  prompt: string,
  requestB64: boolean,
  signal?: AbortSignal,
  inputImageBase64?: string,
): Promise<Blob> {
  const modelLower = config.model.toLowerCase();
  const isAgnes = modelLower.includes('agnes');
  const isOpenAiStandard = modelLower.startsWith('dall-e') || modelLower.startsWith('gpt-image');

  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
  };

  if (isAgnes) {
    body.size = '1K';
    body.ratio = '1:1';
    if (requestB64) {
      body.return_base64 = true;
      body.extra_body = { response_format: 'b64_json' };
    }
    if (inputImageBase64) {
      const dataUri = inputImageBase64.startsWith('data:')
        ? inputImageBase64
        : `data:image/jpeg;base64,${inputImageBase64}`;
      const extra = (body.extra_body as Record<string, unknown>) || {};
      extra.image = [dataUri];
      body.extra_body = extra;
    }
  } else if (isOpenAiStandard) {
    body.size = '1024x1024';
    body.n = 1;
    if (requestB64) {
      body.response_format = 'b64_json';
    }
  } else {
    // 通用兼容模式（中转、Flux、CogView 等）
    body.size = '1024x1024';
    if (requestB64) {
      body.return_base64 = true;
      body.response_format = 'b64_json';
      body.extra_body = { response_format: 'b64_json' };
    }
    if (inputImageBase64) {
      const dataUri = inputImageBase64.startsWith('data:')
        ? inputImageBase64
        : `data:image/jpeg;base64,${inputImageBase64}`;
      const extra = (body.extra_body as Record<string, unknown>) || {};
      extra.image = [dataUri];
      body.extra_body = extra;
    }
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + config.apiKey,
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({})) as { error?: { message?: string } | string };
    const msg = typeof errorData.error === 'string'
      ? errorData.error
      : errorData.error?.message || `生图服务返回异常（HTTP ${resp.status}）`;
    throw new ImageGenError(msg, resp.status);
  }

  const json = await resp.json() as {
    data?: Array<{ b64_json?: string; url?: string; image?: string; b64?: string }>;
    image?: string;
  };

  const item = json.data?.[0];
  const b64 = item?.b64_json || item?.image || item?.b64 || (typeof json.image === 'string' ? json.image : undefined);

  if (b64) {
    return base64ToBlob(b64, 'image/png');
  }

  if (item?.url) {
    const urlStr = item.url;
    try {
      const imgResp = await fetch(urlStr, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      });
      if (!imgResp.ok) throw new ImageGenError(`拉取生成的图片失败（HTTP ${imgResp.status}）`);
      return await imgResp.blob();
    } catch (fetchErr) {
      if (signal?.aborted) throw fetchErr;
      if (urlStr.includes('storage.googleapis.com')) {
        throw new ImageGenError('AI 服务商返回了 Google Cloud Storage 图片直链，当前网络环境或跨域限制无法直接下载。建议配置支持 Base64 返回的模型或中转。');
      }
      throw new ImageGenError(`拉取生成的图片失败: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
    }
  }

  throw new ImageGenError('未能从返回结果中解析出图片');
}

export function resolveImageEditUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/images/edits')) return clean;
  if (clean.endsWith('/images/generations')) return clean.replace('/images/generations', '/images/edits');
  if (clean.endsWith('/v1')) return `${clean}/images/edits`;
  return `${clean}/v1/images/edits`;
}

export function resolveImageGenUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/images/generations')) return clean;
  if (clean.endsWith('/images/edits')) return clean.replace('/images/edits', '/images/generations');
  if (clean.endsWith('/v1')) return `${clean}/images/generations`;
  return `${clean}/v1/images/generations`;
}

function resolveChatEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
  const cleanBase64 = base64.includes(',') ? (base64.split(',')[1] || '') : base64;
  const byteChars = atob(cleanBase64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
