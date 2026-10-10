import type { AssistantTool, AssistantToolContext } from './toolTypes';
import { countPillsFromImage } from '../../features/pillCounter';
import { findMedByName } from './toolTypes';

export const countPillsTool: AssistantTool = {
  name: 'count_pills',
  label: '视觉清点药片',
  description: '对用户上传的散落药片照片进行毫秒级视觉检测与计数。当用户发送了药片图片、或提问“帮我数药片”、“这里有多少粒药”、“还剩几颗”等问题时调用此工具。若用户未附带图片，工具会提示用户拍照或上传图片。',
  parameters: {
    type: 'object',
    properties: {
      image_data: {
        type: 'string',
        description: '可选的图片 DataURL 或 Base64。若不提供，将自动读取当前对话中用户附带的图片',
      },
      med_name: {
        type: 'string',
        description: '可选，用户提及的相关药品名称，便于比对现有库存',
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
        error: '未检测到药片图片。请在聊天框点击图片按钮上传一张散落药片的清晰照片，我马上帮您数！',
      };
    }

    try {
      const result = await countPillsFromImage(rawImage);
      const medName = typeof args.med_name === 'string' ? args.med_name.trim() : '';
      let matchedMedInfo: string | undefined;

      if (medName) {
        const { med } = await findMedByName(medName);
        if (med) {
          matchedMedInfo = `找到匹配药品「${med.name}」，当前系统记录库存为 ${med.inventory?.remaining ?? 0} ${med.inventory?.unit || '片'}`;
        }
      }

      return {
        ok: true,
        count: result.count,
        summary: `视觉清点完成：画面中共有 ${result.count} 粒药片（算法用时 ${result.elapsedMs.toFixed(1)}ms）。`,
        matched_med: matchedMedInfo,
        has_annotated_preview: Boolean(result.annotatedDataUrl),
      };
    } catch (e) {
      return {
        ok: false,
        error: `图像识别分析失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
