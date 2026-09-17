import { confirmDialog, el, toast } from '../../../ui/components';
import {
  clearDiagnosticLogs,
  copyDiagnosticLogs,
  listDiagnosticLogs,
} from '../../../app/diagnostics';
import type { PanelChip } from '../types';
import { panel, setChip } from '../components/panelPrimitives';

export interface DiagnosticsPanelOperations {
  notify: (message: string) => void;
  confirm: (message: string, okText?: string, danger?: boolean) => Promise<boolean>;
  copy: () => Promise<number>;
}

export function diagnosticsChip(): PanelChip {
  const count = listDiagnosticLogs().length;
  return { text: `${count} 条`, tone: count > 0 ? 'info' : 'muted' };
}

export function renderDiagnosticsPanel(
  operations?: Partial<DiagnosticsPanelOperations>,
): HTMLElement {
  const ops: DiagnosticsPanelOperations = {
    notify: operations?.notify ?? toast,
    confirm: operations?.confirm ?? confirmDialog,
    copy: operations?.copy ?? copyDiagnosticLogs,
  };
  let refreshContent = () => {};
  const p = panel({
    title: '诊断记录',
    iconName: 'info',
    iconTone: 'cyan',
    chip: diagnosticsChip(),
    renderBody: (body) => {
      const card = el('div', { class: 'settings-subcard' });
      const head = el('div', { class: 'settings-subcard-header' });
      const titleWrap = el('div', { class: 'settings-subcard-title-wrap' });
      titleWrap.append(el('div', { class: 'settings-subcard-title', text: '后台失败日志摘要' }));
      const badge = el('span', {
        class: 'settings-subcard-badge',
        style: 'background: rgba(6, 182, 212, 0.12); color: #0891b2;',
        text: '安全脱敏',
      });
      head.append(titleWrap, badge);
      card.append(head);

      const description = el('div', {
        class: 'muted settings-subcard-desc',
        text: '仅保留最近 50 条脱敏后的后台失败摘要，不包含密钥、令牌或完整药品正文。',
      });
      const output = el('pre', { class: 'diagnostics-log', tabIndex: 0 });
      const copyButton = el('button', { class: 'btn tonal', type: 'button', text: '复制' });
      const clearButton = el('button', { class: 'btn text', type: 'button', text: '清空' });
      const actions = el('div', { class: 'btn-row diagnostics-actions' });
      actions.append(copyButton, clearButton);

      card.append(description, output, actions);

      refreshContent = () => {
        const entries = listDiagnosticLogs();
        output.textContent = entries.length === 0
          ? '暂无诊断记录'
          : entries.map((entry) => `${new Date(entry.at).toLocaleString()}  [${entry.scope}]  ${entry.summary}`).join('\n');
        copyButton.disabled = entries.length === 0;
        clearButton.disabled = entries.length === 0;
      };
      copyButton.onclick = async () => {
        try {
          const count = await ops.copy();
          ops.notify(`已复制 ${count} 条诊断记录`);
        } catch {
          ops.notify('复制失败，请检查剪贴板权限');
        }
      };
      clearButton.onclick = async () => {
        if (!await ops.confirm('清空全部诊断记录？此操作无法撤销。', '清空', true)) return;
        clearDiagnosticLogs();
        refreshContent();
        setChip(p, diagnosticsChip());
        ops.notify('诊断记录已清空');
      };
      body.append(card);
    },
  });
  refreshContent();
  return p;
}
