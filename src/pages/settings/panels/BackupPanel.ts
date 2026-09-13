import { confirmDialog, el, toast } from '../../../ui/components';
import {
  backupProviders,
  buildBackup,
  previewBackupImport,
  type BackupPreviewResult,
  type BackupProvider,
} from '../../../tools/registry';
import { assertBackupFileSize, parseSafeBackupPayload } from '../../../security/validation';
import type { SettingsRenderPart } from '../types';
import { panel } from '../components/panelPrimitives';

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface BackupImportRouteOperations {
  validateFile: (file: File) => void;
  readText: (file: File) => Promise<string>;
  parse: (text: string) => Record<string, unknown>;
  preview: (raw: unknown) => Promise<BackupPreviewResult>;
  confirm: (message: string, okText?: string) => Promise<boolean>;
  providers: readonly Pick<BackupProvider, 'label' | 'import'>[];
  notify: (message: string, duration?: number) => void;
  rerender: (signal?: AbortSignal) => void | Promise<void | (() => void)>;
}

export async function importBackupFileForRoute(
  _root: HTMLElement,
  file: File,
  signal?: AbortSignal,
  operations?: BackupImportRouteOperations,
  defaultRerender?: (signal?: AbortSignal) => void | Promise<void | (() => void)>,
): Promise<void> {
  const ops: BackupImportRouteOperations = operations ?? {
    validateFile: assertBackupFileSize,
    readText: (selectedFile) => selectedFile.text(),
    parse: (text) => parseSafeBackupPayload(JSON.parse(text)),
    preview: previewBackupImport,
    confirm: confirmDialog,
    providers: backupProviders,
    notify: toast,
    rerender: (routeSignal) => {
      if (defaultRerender) return defaultRerender(routeSignal);
    },
  };

  try {
    ops.validateFile(file);
    const text = await ops.readText(file);
    if (signal?.aborted) return;
    const raw = ops.parse(text);

    const preview = await ops.preview(raw);
    if (signal?.aborted) return;
    const totalItems = preview.providers.reduce(
      (sum, provider) => sum + provider.added + provider.updated + provider.skipped,
      0,
    );
    if (totalItems === 0) {
      ops.notify('这个备份里没有可导入的数据');
      return;
    }

    const summaryLines = preview.providers.map(
      (provider) =>
        `${provider.label}：新增 ${provider.added}，更新 ${provider.updated}，跳过 ${provider.skipped}`,
    );
    const warningText = preview.warnings.length
      ? `\n注意：${preview.warnings.slice(0, 5).join('；')}${preview.warnings.length > 5 ? `（共 ${preview.warnings.length} 条）` : ''}`
      : '';
    const confirmed = await ops.confirm(
      `导入备份？\n\n${summaryLines.join('\n')}\n只会合并更新，不会清空本地数据。${warningText}`,
      '导入',
    );
    if (signal?.aborted || !confirmed) return;

    const results: string[] = [];
    for (const provider of ops.providers) {
      const result = await provider.import(raw);
      results.push(
        `${provider.label} 新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`,
      );
    }
    if (signal?.aborted) return;

    ops.notify(results.join('；'), 4200);
    await ops.rerender(signal);
  } catch (error) {
    if (signal?.aborted) return;
    ops.notify('导入失败：' + (error instanceof Error ? error.message : String(error)), 3600);
  }
}

export function renderBackupCard(
  root: HTMLElement,
  signal?: AbortSignal,
  counts?: { meds: number; rules: number; logs: number },
  onRerender?: (signal?: AbortSignal) => void | Promise<void | (() => void)>,
): SettingsRenderPart {
  let fileInput: HTMLInputElement;
  let exportBtn: HTMLElement;
  let importBtn: HTMLElement;

  const countSummary = counts ? `${counts.meds} 药 · ${counts.logs} 记录` : '就绪';

  const element = panel({
    title: '本地数据与备份',
    iconName: 'box',
    iconTone: 'teal',
    chip: { text: countSummary, tone: 'ok' },
    renderBody: (body) => {
      body.classList.add('settings-backup-panel-body');
      if (counts) {
        body.append(el('div', {
          class: 'muted settings-backup-summary',
          text: `本机现有 ${counts.meds} 种药品、${counts.rules} 条提醒规则、${counts.logs} 条服药记录。`,
        }));
      }
      body.append(el('div', {
        class: 'muted settings-backup-note',
        text: '备份会完整包含以上数据。导入时按 ID 与更新时间合并，不会清空本地数据。',
      }));

      exportBtn = el('button', { class: 'btn tonal', type: 'button', text: '导出备份文件' });
      exportBtn.onclick = async () => {
        if (signal?.aborted) return;
        const data = await buildBackup();
        if (signal?.aborted) return;
        downloadJson(data, `xiaoyaohe-backup-${new Date().toISOString().slice(0, 10)}.json`);
      };

      importBtn = el('button', { class: 'btn', type: 'button', text: '从备份恢复数据' });
      fileInput = el('input', {
        type: 'file',
        accept: 'application/json,.json',
        style: 'display:none',
      });
      importBtn.onclick = () => {
        if (!signal?.aborted) fileInput.click();
      };
      fileInput.onchange = async () => {
        if (signal?.aborted) return;
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        await importBackupFileForRoute(root, file, signal, undefined, onRerender);
      };

      const row = el('div', { class: 'btn-row backup-actions', style: 'margin-block-start: var(--space-3);' });
      row.append(exportBtn, importBtn);
      body.append(row, fileInput);
    },
  });

  return {
    element,
    cleanup: () => {
      if (exportBtn) exportBtn.onclick = null;
      if (importBtn) importBtn.onclick = null;
      if (fileInput) {
        fileInput.onchange = null;
        fileInput.value = '';
      }
    },
  };
}
