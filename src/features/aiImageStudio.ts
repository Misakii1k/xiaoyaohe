/**
 * AI 药盒扫描增强引擎 (AI Medicine Box Photo Enhancer)
 *
 * 将手机拍摄的药盒照片通过 /images/edits API 进行增强处理：
 * - 去除杂乱背景，替换为纯白底
 * - 增强文字清晰度和对比度
 * - 矫正透视变形
 * - 100% 保真保留原始文字、商标、配色、布局
 *
 * 类似「扫描全能王」的效果：不是重新画一个药盒，而是让原照片更干净清晰。
 * 结果通过 compressBoxPhoto 控制在 720px / 220KB 以内，杜绝内存溢出。
 */

import { getEffectiveImageGenConfig } from '../ai/llmConfig';
import { compressBoxPhoto } from './medPhotos';

export interface GeneratePackshotOptions {
  photoBlob: Blob;
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

/**
 * 两版修图 Prompt，供切换测试。
 * 当前默认使用 PROMPT_SCANNER（扫描仪模拟式）。
 */

/** 版本 A：简洁指令式 */
export const PROMPT_CLEAN = [
  'Clean up this medicine box photo: remove the background and replace with pure white,',
  'enhance sharpness and contrast, correct perspective distortion.',
  'Keep every text character, logo, color, and layout element exactly as they appear in the original.',
  'Do not redesign, do not add or remove any visual elements.',
].join(' ');

/** 版本 B：扫描仪模拟式（当前默认） */
export const PROMPT_SCANNER = [
  'Process this medicine packaging photo as a high-quality flatbed scanner would:',
  'pure white background, even lighting, no shadows, corrected perspective to perfectly rectangular,',
  'enhanced text sharpness.',
  'Preserve all original text, logos, graphics, and colors with 100% fidelity.',
  'Do not alter, redesign, or reinterpret any part of the packaging.',
].join(' ');

/** 当前生效的修图 Prompt */
const ACTIVE_PROMPT = PROMPT_SCANNER;

/** 调用 /images/edits 对药盒原图做扫描增强并压缩返回 */
export async function generateMedPackshot(options: GeneratePackshotOptions): Promise<Blob> {
  const { photoBlob, name, dosageText, signal, onProgress } = options;

  if (!photoBlob || photoBlob.size === 0) {
    throw new ImageGenError('需要药盒照片才能进行增强处理，请先拍照');
  }

  const config = getEffectiveImageGenConfig();

  if (!config.isConfigured) {
    throw new ImageGenError('未配置 AI 生图服务（请在「设置」中配置生图 API 或主 AI 密钥）');
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  onProgress?.('正在增强药盒照片…');

  const editUrl = resolveImageEditUrl(config.baseUrl);

  // 构建包含药名上下文的 prompt，帮助 AI 更好地保留文字
  const contextHint = name.trim()
    ? ` The medicine name on the box is "${name.trim()}"${dosageText?.trim() ? `, specification: "${dosageText.trim()}"` : ''}.`
    : '';
  const prompt = ACTIVE_PROMPT + contextHint;

  let rawBlob: Blob;
  try {
    rawBlob = await requestImageEdit(editUrl, config, photoBlob, prompt, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ImageGenError && (error.statusCode === 404 || error.statusCode === 405)) {
      throw new ImageGenError(
        '当前 AI 服务商不支持图片编辑接口（/images/edits）。请更换为支持该接口的服务商或模型（如 GPT Image 系列）。',
        error.statusCode,
      );
    }
    throw error;
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
async function requestImageEdit(
  url: string,
  config: { apiKey: string; model: string },
  imageBlob: Blob,
  prompt: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const form = new FormData();
  // 确保文件名和 MIME type 正确，某些服务商对此敏感
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
      // 不设 content-type，让 fetch 自动生成 multipart boundary
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

function resolveImageEditUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/images/edits')) return clean;
  if (clean.endsWith('/images/generations')) return clean.replace('/images/generations', '/images/edits');
  if (clean.endsWith('/v1')) return `${clean}/images/edits`;
  return `${clean}/v1/images/edits`;
}

function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
