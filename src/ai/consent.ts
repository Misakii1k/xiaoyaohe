import { confirmDialog } from '../ui/components';

export type AiDataKind = 'medicine-photo' | 'prescription' | 'work-data';

const approved = new Set<string>();
const KIND_LABEL: Record<AiDataKind, string> = {
  'medicine-photo': '药盒或票据图片',
  prescription: '处方、药单图片或用药文本',
  'work-data': '工资、班次和工时信息',
};

export async function requireAiConsent(kind: AiDataKind, baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  const key = `${kind}:${origin}`;
  if (approved.has(key)) return;
  const ok = await confirmDialog(
    `即将把${KIND_LABEL[kind]}发送到：\n${origin}\n\n数据由你选择的 AI 服务商处理。请确认其隐私政策后继续。`,
    '同意并继续',
  );
  if (!ok) throw new Error('已取消发送到 AI 服务');
  approved.add(key);
}
