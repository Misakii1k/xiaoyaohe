import type { AssistantCardBlock, AssistantCardFact } from '../assistant';
import type { AssistantTool, AssistantToolContext } from './toolTypes';
import { findMedByName } from './toolTypes';
import { renderPillDotsOnCanvas } from '../../features/pillCounter';
import { fitDimensionsWithin, runPillDetectionPipeline } from '../../features/pillCounterClient';
import type {
  PillDetectionEngineKind,
  PillDetectionMode,
  PillPoint,
} from '../../features/pillEngine';

function formatEngineLabel(engine: PillDetectionEngineKind): string {
  if (engine === 'cloud') return '云端视觉模型';
  if (engine === 'yolo_local') return '本地离线模型';
  return '本地快速算法';
}

function renderCompactAnnotatedThumbnail(
  prepared: {
    width: number;
    height: number;
    rawImgData: ImageData;
    canvas?: HTMLCanvasElement;
  },
  points: readonly PillPoint[],
): string | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const { width, height } = fitDimensionsWithin(prepared.width, prepared.height, 480);
    if (width <= 0 || height <= 0) return undefined;
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = width;
    thumbCanvas.height = height;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return undefined;

    if (prepared.canvas) {
      ctx.drawImage(prepared.canvas, 0, 0, width, height);
    } else if (typeof ctx.putImageData === 'function') {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = prepared.width;
      srcCanvas.height = prepared.height;
      const srcCtx = srcCanvas.getContext('2d');
      if (srcCtx) {
        srcCtx.putImageData(prepared.rawImgData, 0, 0);
        ctx.drawImage(srcCanvas, 0, 0, width, height);
      }
    }

    const sx = prepared.width > 0 ? width / prepared.width : 1;
    const sy = prepared.height > 0 ? height / prepared.height : 1;
    const scaledPoints = points.map((pt) => ({
      ...pt,
      x: pt.x * sx,
      y: pt.y * sy,
    }));
    renderPillDotsOnCanvas(ctx, scaledPoints);
    const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.78);
    return dataUrl && dataUrl.startsWith('data:image/') ? dataUrl : undefined;
  } catch {
    return undefined;
  }
}

export const countPillsTool: AssistantTool = {
  name: 'count_pills',
  label: '视觉清点药片',
  description:
    '对用户上传的药片照片进行视觉定位与计数，支持散落/混合药片（loose）及整板泡罩铝塑板（blister）。当用户发送药片照片、或询问“帮我数药片”、“这里有多少粒药”、“还剩几颗”时调用。若用户未附带图片，工具会提示上传照片。',
  parameters: {
    type: 'object',
    properties: {
      image_data: {
        type: 'string',
        description: '可选的图片 DataURL 或 Base64。若不提供，将自动读取当前对话中用户附带的图片',
      },
      mode: {
        type: 'string',
        enum: ['loose', 'blister'],
        description: '清点模式：散落桌面的药片或多种药混合选 loose；整板泡罩/铝塑板药片选 blister',
      },
      med_name: {
        type: 'string',
        description: '可选，用户提及的相关药品名称，便于比对现有库存并在卡片中快捷回填',
      },
    },
    additionalProperties: false,
  },
  async run(args, context?: AssistantToolContext) {
    const rawImage = typeof args.image_data === 'string' && args.image_data.trim()
      ? args.image_data.trim()
      : context?.attachment?.dataUrl;

    if (!rawImage) {
      return {
        ok: false,
        error: '未检测到药片图片。请在聊天框点击图片按钮上传一张药片照片（支持散落桌面或整板泡罩），我马上帮您数！',
      };
    }

    const mode: PillDetectionMode = args.mode === 'blister' ? 'blister' : 'loose';
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const result = await runPillDetectionPipeline({
        source: rawImage,
        mode,
        signal: context?.signal,
      });
      const elapsedMs = Math.max(
        0,
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
      );

      const medNameArg = typeof args.med_name === 'string' ? args.med_name.trim() : '';
      let matchedMedId: string | undefined;
      let matchedMedName: string | undefined;
      let matchedMedInfo: string | undefined;

      if (medNameArg) {
        const { med } = await findMedByName(medNameArg);
        if (med) {
          matchedMedId = med.id;
          matchedMedName = med.name;
          matchedMedInfo = `找到匹配药品「${med.name}」，当前系统记录库存为 ${med.inventory?.remaining ?? 0} ${med.inventory?.unit || '片'}`;
        }
      }

      const annotatedDataUrl = renderCompactAnnotatedThumbnail(result.prepared, result.points);
      const sourceDataUrl = result.prepared.jpegDataUrl || rawImage;

      const facts: AssistantCardFact[] = [
        { label: '清点模式', value: result.mode === 'blister' ? '整板药片' : '散落药片' },
        { label: '识别引擎', value: formatEngineLabel(result.engine) },
      ];
      if (result.clusters && result.clusters.length > 1) {
        facts.push({
          label: '颜色外观分类',
          value: result.clusters.map((c) => `${c.label} ${c.count}粒`).join(' · '),
        });
      }
      if (matchedMedInfo && matchedMedName) {
        facts.push({
          label: '关联药品',
          value: matchedMedName,
        });
      }

      let noticeBody: string | undefined;
      if (result.consentNeeded) {
        noticeBody = '当前使用本地轻量算法完成初算；点下方“微调并回填库存”可在抽屉里开启云端视觉识别，混合药与整板会更准。';
      } else if (result.degradedReason) {
        noticeBody = `${result.degradedReason}；如数量有出入可直接点击下方按钮微调。`;
      }

      const ui: AssistantCardBlock = {
        type: 'card',
        variant: 'summary',
        icon: 'scan',
        eyebrow: result.mode === 'blister' ? '整板泡罩清点' : '视觉清点药片',
        title: `识别出 ${result.count} 粒药片`,
        badge: `共 ${result.count} 粒`,
        tone: result.count > 0 ? 'success' : 'warning',
        ...(noticeBody ? { body: noticeBody } : {}),
        facts,
        pillPreview: {
          count: result.count,
          mode: result.mode,
          engine: result.engine,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          points: result.points,
          ...(annotatedDataUrl ? { annotatedDataUrl } : {}),
          ...(sourceDataUrl ? { sourceDataUrl } : {}),
          ...(matchedMedId ? { medId: matchedMedId } : {}),
          ...(matchedMedName ? { medName: matchedMedName } : {}),
          ...(result.consentNeeded ? { consentNeeded: true } : {}),
          ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
        },
      };

      return {
        ok: true,
        count: result.count,
        mode: result.mode,
        engine: result.engine,
        clusters: result.clusters,
        summary: `视觉清点完成（${result.mode === 'blister' ? '整板模式' : '散落模式'}，${formatEngineLabel(result.engine)}）：画面中共有 ${result.count} 粒药片（用时 ${elapsedMs.toFixed(0)}ms）。`,
        matched_med: matchedMedInfo,
        has_annotated_preview: Boolean(annotatedDataUrl),
        consent_needed: Boolean(result.consentNeeded),
        ui,
      };
    } catch (e) {
      return {
        ok: false,
        error: `图像识别分析失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
