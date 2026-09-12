import { el } from '../../../ui/components';
import {
  statNotebookImg,
  statPillboxImg,
  statTargetImg,
  getStatLog3dSvg,
  getStatBox3dSvg,
  getStatRate3dSvg,
  parseSvg,
  render3dMedia,
} from '../../../ui/assets3d';
import { navigate } from '../../../router';
import type { IntakeLog, Medication, ReminderRule } from '../../../db/schema';

export function createProfileStatCard(
  label: string,
  val: string,
  sub: string,
  img: string,
  svgFn: () => string,
  onClick?: () => void,
): HTMLElement {
  const card = el('button', {
    class: 'profile-stat-card',
    type: 'button',
  });

  const iconWrap = el('div', { class: 'profile-stat-icon' });
  if (img) {
    iconWrap.append(render3dMedia(img, svgFn, label, 'profile-stat-icon-img'));
  } else {
    iconWrap.append(parseSvg(svgFn()));
  }

  const info = el('div', { class: 'profile-stat-info' });
  info.append(
    el('div', { class: 'profile-stat-label', text: label }),
    el('div', { class: 'profile-stat-val', text: val }),
  );
  if (sub) {
    info.append(el('div', { class: 'profile-stat-sub', text: sub }));
  }
  card.append(iconWrap, info);
  if (onClick) {
    card.onclick = onClick;
  }
  return card;
}

export function renderStatsGrid(
  meds: readonly Medication[],
  rules: readonly ReminderRule[],
  logs: readonly IntakeLog[],
): HTMLElement {
  const activeRulesCount = rules.filter((rule) => rule.enabled && !rule.deleted).length;
  const takenCount = logs.filter((l) => l.status === 'taken').length || logs.length;

  const statsSection = el('div', { class: 'profile-stats-section' });
  statsSection.append(el('h2', { class: 'profile-section-title', text: '我的数据' }));

  const statsGrid = el('div', { class: 'profile-stats-grid' });
  statsGrid.append(
    createProfileStatCard('全部药品', `${meds.length} 种`, '在库管理', statPillboxImg, getStatBox3dSvg, () => {
      navigate('/meds');
    }),
    createProfileStatCard('用药计划', `${activeRulesCount} 条`, '今日待服', statNotebookImg, getStatLog3dSvg, () => {
      navigate('/today');
    }),
    createProfileStatCard('打卡记录', `${takenCount} 次`, '历史日历', statTargetImg, getStatRate3dSvg, () => {
      navigate('/history');
    }),
  );
  statsSection.append(statsGrid);
  return statsSection;
}
