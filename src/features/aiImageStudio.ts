/**
 * AI 药盒白底展台大图生成引擎 (AI Studio Packshot Generator)
 *
 * 两阶段管线：
 * 1. 视觉大模型（若有原图）提取药盒包装形态、品牌文字与色系；
 * 2. 商业静物摄影 Prompt 驱动生图模型（DALL·E 3、通义万相、FLUX 等）合成纯白底、微投影、字迹清晰的展台大图；
 * 3. 结果无缝通过 compressBoxPhoto 控制在 720px / 220KB 以内，杜绝内存溢出。
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

/** 构建用于商业静物展台摄影的专业 Prompt */
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

/** 从药名中推测默认的包装形式与色系（无原图时的保底） */
export function inferDefaultVisualFeatures(name: string, dosageText?: string): MedVisualFeatures {
  const lower = (name + ' ' + (dosageText || '')).toLowerCase();
  let form: MedVisualFeatures['form'] = 'paper_box';
  let boxColorTheme = 'clean medical white and cyan-blue accents';

  if (lower.includes('液') || lower.includes('糖浆') || lower.includes('滴剂') || lower.includes('喷雾')) {
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

/** 第一阶段：使用已有视觉 LLM 提取原图特征（若失败则优雅回落至默认规则推测） */
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

/** 第二阶段：调用生图 API 生成展台大图并压缩返回 */
export async function generateMedPackshot(options: GeneratePackshotOptions): Promise<Blob> {
  const { photoBlob, name, dosageText, signal, onProgress } = options;
  const config = getEffectiveImageGenConfig();

  if (!config.isConfigured) {
    throw new ImageGenError('未配置 AI 生图服务（请在「设置」中配置生图 API 或主 AI 密钥）');
  }

  let features: MedVisualFeatures;
  if (photoBlob) {
    onProgress?.('正在提取包装色彩与特征…');
    features = await extractVisualFeatures(photoBlob, name, dosageText, signal);
  } else {
    features = inferDefaultVisualFeatures(name, dosageText);
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const prompt = buildStudioPackshotPrompt(features);
  onProgress?.('正在生成商业级展台大图…');

  const imageUrl = resolveImageGenUrl(config.baseUrl);

  // 优先请求 b64_json，若服务端不支持则按常规处理
  let rawBlob: Blob | null = null;
  try {
    rawBlob = await requestImageGeneration(imageUrl, config, prompt, true, signal);
  } catch (firstErr) {
    if (signal?.aborted) throw firstErr;
    // 如果是 400 且可能是不支持 response_format，尝试普通请求
    try {
      rawBlob = await requestImageGeneration(imageUrl, config, prompt, false, signal);
    } catch {
      throw firstErr;
    }
  }

  if (!rawBlob || rawBlob.size === 0) {
    throw new ImageGenError('AI 未返回有效的图片数据');
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  onProgress?.('正在压缩优化药盒大图…');
  // 压缩控制在长边 720px / 220KB 内，保护 WebView 内存
  const compressed = await compressBoxPhoto(rawBlob);
  return compressed;
}

async function requestImageGeneration(
  url: string,
  config: { apiKey: string; model: string },
  prompt: string,
  requestB64: boolean,
  signal?: AbortSignal,
): Promise<Blob> {
  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
    n: 1,
    size: '1024x1024',
  };
  if (requestB64) {
    body.response_format = 'b64_json';
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
    if (!imgResp.ok) throw new ImageGenError(`拉取生成的图片失败（HTTP ${imgResp.status}）`);
    return await imgResp.blob();
  }

  throw new ImageGenError('未能从返回结果中解析出图片');
}

function resolveImageGenUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/images/generations')) return clean;
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
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
