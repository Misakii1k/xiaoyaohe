import { el, icon } from '../../../ui/components';
import { openAvatarPicker } from '../../../ui/AvatarPicker';
import { getAvatarById, getActiveAvatarId } from '../../../ui/avatars';
import {
  getUserAvatar3dSvg,
  parseSvg,
} from '../../../ui/assets3d';
import type { IntakeLog, Medication } from '../../../db/schema';
export { createProfileStatCard, renderStatsGrid } from './StatsGrid';

export function renderProfileHero(
  meds: readonly Medication[],
  logs: readonly IntakeLog[],
): HTMLElement {
  // 计算真实管理天数
  let daysManaging = 0;
  const timestamps: number[] = [];
  for (const log of logs) {
    if (log.ackAt) timestamps.push(log.ackAt);
    else if (log.dueAt) timestamps.push(log.dueAt);
    else if (log.updatedAt) timestamps.push(log.updatedAt);
  }
  for (const med of meds) {
    if (med.createdAt) timestamps.push(med.createdAt);
    else if (med.updatedAt) timestamps.push(med.updatedAt);
  }
  if (timestamps.length > 0) {
    const earliest = Math.min(...timestamps);
    const diffMs = Math.max(0, Date.now() - earliest);
    daysManaging = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const profileHero = el('div', { class: 'profile-hero-card' });
  const userRow = el('div', { class: 'profile-user-row' });
  const avatarWrap = el('button', {
    class: 'profile-avatar-wrap',
    type: 'button',
    'aria-label': '更换头像',
    title: '点击更换头像',
  });

  function renderAvatar(): void {
    const item = getAvatarById(getActiveAvatarId());
    avatarWrap.style.backgroundColor = item.bgColor;
    const avatarEl = item.imgUrl
      ? el('img', { class: 'profile-avatar-img', src: item.imgUrl, alt: item.name })
      : parseSvg(getUserAvatar3dSvg());
    const editBadge = el('div', { class: 'profile-avatar-edit-badge' });
    editBadge.append(icon('camera'));
    avatarWrap.replaceChildren(avatarEl, editBadge);
  }
  renderAvatar();

  avatarWrap.onclick = () => {
    openAvatarPicker(() => {
      renderAvatar();
    });
  };

  const userInfo = el('div', { class: 'profile-user-info' });
  userInfo.append(
    el('div', { class: 'profile-user-name', text: '小药盒用户' }),
    el('div', {
      class: 'profile-user-sub',
      text: daysManaging > 0 ? `用药管理 第 ${daysManaging} 天` : '开启科学用药管理',
    }),
  );
  userRow.append(avatarWrap, userInfo);

  const takenCount = logs.filter((l) => l.status === 'taken').length || logs.length;
  const streakBadge = el('div', { class: 'profile-streak-badge' });
  streakBadge.append(icon('check'));
  streakBadge.append(el('span', {
    text: `已记录 ${takenCount} 次服药`,
  }));

  profileHero.append(userRow, streakBadge);
  return profileHero;
}

