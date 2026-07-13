import { navigate } from '../router';
import { el, icon, renderPage, toast } from '../ui/components';
import { tools, type ToolDefinition, type ToolSummary } from '../tools/registry';
import {
  createPaySnapshot,
  getRunningWorkEntry,
  listWorkProfiles,
  putWorkEntry,
  workUid,
} from '../db/work';
import type { WorkEntry, WorkProfile } from '../db/schema';

const LAST_WORK_ENTRY_KEY = 'medbox.lastWorkEntry';
const MINUTE = 60_000;

interface LastWorkEntry {
  profileId: string;
  taskName?: string;
}

export async function renderToolPickerPage(root: HTMLElement): Promise<void> {
  const content = el('div', { class: 'page page-light tool-picker-page' });

  const intro = el('div', { class: 'tool-picker-head' });
  intro.append(el('div', { class: 'tool-picker-kicker', html: '日常工具箱' }));
  intro.append(el('div', { class: 'tool-picker-title', html: '选择今天要用的工具' }));
  content.append(intro);

  // 快捷入口区域：先插入骨架，再异步填充
  const quickWrap = el('div', { class: 'quick-access' });
  content.append(quickWrap);
  void fillQuickAccess(quickWrap);

  const grid = el('div', { class: 'tool-grid' });
  const summaries = await Promise.all(tools.map((tool) => tool.getSummary().catch(() => ({
    text: '摘要载入失败',
    tone: 'warn' as const,
  }))));
  tools.forEach((tool, index) => grid.append(toolCard(tool, summaries[index])));
  content.append(grid);

  renderPage({ root, title: '工具箱', activeTab: 'tools', content, showTabbar: false });
}

/** 异步填充快捷入口区域：今日待服 / 一键开始上次班次 / 正在进行的班次 */
async function fillQuickAccess(wrap: HTMLElement): Promise<void> {
  wrap.innerHTML = '';
  wrap.append(el('div', { class: 'quick-access-title', html: '快捷入口' }));
  const grid = el('div', { class: 'quick-access-grid' });
  wrap.append(grid);

  // 卡片 1：今日待服 N 项
  const todayCard = el('button', { class: 'quick-card quick-card-today', type: 'button' } as any);
  todayCard.append(quickIcon('pill'));
  todayCard.append(el('span', { class: 'quick-card-label', html: '今日待服载入中…' }));
  todayCard.onclick = () => navigate('/today');
  grid.append(todayCard);
  // 异步获取今日待服数
  tools[0]?.getSummary().then((summary) => {
    const label = todayCard.querySelector('.quick-card-label');
    if (label) label.innerHTML = escapeHtml(summary.text);
  }).catch(() => {
    const label = todayCard.querySelector('.quick-card-label');
    if (label) label.innerHTML = '今日待服';
  });

  // 卡片 3：正在进行的班次（先判断 running，因为如果有 running 就不需要展示"一键开始上次班次"）
  const running = await getRunningWorkEntry().catch(() => undefined);

  if (running) {
    // 正在上班卡片
    const runningCard = el('button', { class: 'quick-card quick-card-running', type: 'button' } as any);
    runningCard.append(quickIcon('timer'));
    const projectName = running.paySnapshot?.profileName || running.projectName;
    const durationText = formatDuration(durationMs(running, Date.now()));
    runningCard.append(el('span', { class: 'quick-card-label', html: `正在上班 · ${escapeHtml(projectName)} · ${durationText}` }));
    runningCard.onclick = () => navigate('/work');
    grid.append(runningCard);
    // 每秒刷新时长
    const timer = window.setInterval(() => {
      const label = runningCard.querySelector('.quick-card-label');
      if (!label) {
        window.clearInterval(timer);
        return;
      }
      const stillRunning = document.body.contains(runningCard);
      if (!stillRunning) {
        window.clearInterval(timer);
        return;
      }
      label.innerHTML = `正在上班 · ${escapeHtml(projectName)} · ${formatDuration(durationMs(running, Date.now()))}`;
    }, 1000);
  } else {
    // 卡片 2：一键开始上次班次
    const lastRaw = localStorage.getItem(LAST_WORK_ENTRY_KEY);
    if (lastRaw) {
      let last: LastWorkEntry | null = null;
      try {
        last = JSON.parse(lastRaw) as LastWorkEntry;
      } catch {
        last = null;
      }
      if (last && typeof last.profileId === 'string') {
        const profiles = await listWorkProfiles().catch(() => [] as WorkProfile[]);
        const profile = profiles.find((p) => p.id === last!.profileId);
        if (profile) {
          const lastCard = el('button', { class: 'quick-card quick-card-last', type: 'button' } as any);
          lastCard.append(quickIcon('briefcase'));
          const taskHint = last.taskName ? ` · ${last.taskName}` : '';
          lastCard.append(el('span', { class: 'quick-card-label', html: `一键开始 · ${escapeHtml(profile.name)}${escapeHtml(taskHint)}` }));
          lastCard.onclick = () => startLastShift(profile, last!.taskName);
          grid.append(lastCard);
        }
      }
    }
  }
}

/** 一键开始上次班次：创建新 entry 并跳转 /work */
async function startLastShift(profile: WorkProfile, taskName?: string): Promise<void> {
  try {
    const active = await getRunningWorkEntry();
    if (active) {
      toast('已有班次在进行，已为你跳转');
      navigate('/work');
      return;
    }
    const entry = newEntryFromProfile(profile, Date.now(), undefined, taskName || '');
    await putWorkEntry(entry);
    // 更新最近班次记录（taskName 可能从空变成自定义值）
    saveLastWorkEntry(profile.id, taskName);
    toast('已开始班次');
    navigate('/work');
  } catch (e) {
    toast('开始班次失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

function newEntryFromProfile(profile: WorkProfile, startAt: number, endAt?: number, taskName = ''): WorkEntry {
  return {
    id: workUid(),
    profileId: profile.id,
    projectName: profile.name,
    taskName,
    paySnapshot: createPaySnapshot(profile),
    startAt,
    endAt,
    breakMinutes: profile.defaultBreakMinutes || 0,
    status: endAt ? 'stopped' : 'running',
    settlementStatus: 'pending',
    updatedAt: Date.now(),
  };
}

function quickIcon(iconName: Parameters<typeof icon>[0]): HTMLElement {
  const wrap = el('span', { class: 'quick-card-icon' });
  wrap.append(icon(iconName));
  return wrap;
}

function toolCard(tool: ToolDefinition, summary: ToolSummary): HTMLElement {
  const card = el('button', { class: 'tool-card', type: 'button' } as any);
  const mark = el('span', { class: 'tool-card-icon' });
  mark.append(icon(tool.icon));
  card.append(mark);
  card.append(el('span', { class: 'tool-card-title', html: tool.title }));
  card.append(el('span', { class: 'tool-card-meta', html: tool.meta }));
  card.append(el('span', { class: `tool-card-summary tone-${summary.tone || 'muted'}`, html: summary.text }));
  card.onclick = () => navigate(tool.homeRoute);
  return card;
}

/** 写入最近一次班次信息（供 ToolPicker 一键开始） */
function saveLastWorkEntry(profileId: string, taskName?: string): void {
  try {
    const payload: LastWorkEntry = { profileId, taskName };
    localStorage.setItem(LAST_WORK_ENTRY_KEY, JSON.stringify(payload));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

function durationMs(entry: WorkEntry, now: number): number {
  const end = entry.endAt ?? now;
  return Math.max(0, end - entry.startAt - (entry.breakMinutes || 0) * MINUTE);
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / MINUTE);
  return `${Math.floor(minutes / 60)}小时${String(minutes % 60).padStart(2, '0')}分`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
