import { el, toast } from '../../../ui/components';
import { clearAppCache, getAppCacheSize } from '../../../sync/lan/apkTransport';
import type { SettingsRenderPart } from '../types';
import { panel, setChip } from '../components/panelPrimitives';

export function renderCacheStoragePanel(signal?: AbortSignal): SettingsRenderPart {
  let cacheSizeTextEl: HTMLElement | null = null;
  let clearBtn: HTMLButtonElement | null = null;
  let isClearing = false;

  const p = panel({
    title: '存储空间与缓存',
    iconName: 'trash',
    iconTone: 'teal',
    chip: { text: '计算中...', tone: 'muted' },
    renderBody: (body) => {
      body.classList.add('settings-cache-panel-body');

      const summaryEl = el('div', { class: 'settings-cache-summary-card' });
      const labelEl = el('div', { class: 'settings-cache-label', text: '临时与缓存占用' });
      cacheSizeTextEl = el('div', { class: 'settings-cache-size', text: '...' });
      summaryEl.append(labelEl, cacheSizeTextEl);

      const noteEl = el('div', {
        class: 'muted settings-cache-note',
        text: '仅清理历史安装包、增量包解压残留与页面临时缓存。所有药品档案、服药记录与闹钟提醒均安全保留在本地数据库中，绝不丢失。',
      });

      clearBtn = el('button', {
        class: 'btn tonal btn-full settings-cache-clear-btn',
        type: 'button',
        text: '一键清理缓存',
      }) as HTMLButtonElement;

      clearBtn.onclick = async () => {
        if (isClearing || signal?.aborted) return;
        isClearing = true;
        if (clearBtn) {
          clearBtn.disabled = true;
          clearBtn.textContent = '正在清理...';
        }
        try {
          const result = await clearAppCache();
          const freedStr = result.freedBytes > 0 ? result.formatted : '已全部释放';
          toast(`已清理完成，释放 ${freedStr} 空间`, 3000);
          await refreshSize();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          toast(msg || '清理失败，请稍后重试');
        } finally {
          isClearing = false;
          if (clearBtn) {
            clearBtn.disabled = false;
            clearBtn.textContent = '一键清理缓存';
          }
        }
      };

      body.append(summaryEl, noteEl, clearBtn);
      queueMicrotask(refreshSize);
    },
  });

  async function refreshSize() {
    if (signal?.aborted) return;
    try {
      const info = await getAppCacheSize();
      if (signal?.aborted) return;
      if (cacheSizeTextEl) {
        cacheSizeTextEl.textContent = info.formatted;
      }
      setChip(p, {
        text: info.bytes > 0 ? info.formatted : '已是最佳状态',
        tone: info.bytes > 50 * 1024 * 1024 ? 'warn' : 'ok',
      });
    } catch {
      if (cacheSizeTextEl) cacheSizeTextEl.textContent = '0 B';
      setChip(p, { text: '已是最佳状态', tone: 'ok' });
    }
  }

  return {
    element: p,
    cleanup: () => {
      if (clearBtn) clearBtn.onclick = null;
    },
  };
}
