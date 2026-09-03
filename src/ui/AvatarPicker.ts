// 头像选择抽屉：展示 16 款统一 3D 黏土/皮克斯质感全家福头像，支持即选即换并持久化
import { el, icon, toast } from './components';
import { parseSvg } from './assets3d';
import { openBottomSheet, type BottomSheetHandle } from './primitives/BottomSheet';
import { getAvatarList, getActiveAvatarId, setActiveAvatarId } from './avatars';

export function openAvatarPicker(onSelect?: (newId: string) => void): BottomSheetHandle {
  const currentId = getActiveAvatarId();
  let handle: BottomSheetHandle | undefined;

  const container = el('div', { class: 'avatar-picker-content' });

  // 顶部拖拽把手与标题
  const handleBar = el('div', { class: 'bottom-sheet-handle' });
  const header = el('div', { class: 'avatar-picker-header' });
  const title = el('h3', { class: 'avatar-picker-title', text: '选择头像' });
  const subtitle = el('p', { class: 'avatar-picker-subtitle', text: '挑选专属于您的药盒角色头像' });
  header.append(title, subtitle);

  // 4x4 头像网格
  const grid = el('div', { class: 'avatar-picker-grid' });
  const list = getAvatarList();

  for (const item of list) {
    const isSelected = item.id === currentId;
    const card = el('button', {
      class: `avatar-picker-card${isSelected ? ' active' : ''}`,
      type: 'button',
      'aria-label': `${item.name} (${item.role})`,
    } as any);

    const avatarWrap = el('div', {
      class: 'avatar-picker-img-wrap',
      style: `background-color: ${item.bgColor};`,
    });
    if (item.imgUrl) {
      const img = el('img', {
        class: 'avatar-picker-img',
        src: item.imgUrl,
        alt: item.name,
      });
      avatarWrap.append(img);
    } else {
      avatarWrap.append(parseSvg(item.svg));
    }

    const info = el('div', { class: 'avatar-picker-info' });
    const name = el('span', { class: 'avatar-picker-name', text: item.name });
    const role = el('span', { class: 'avatar-picker-role', text: item.role });
    info.append(name, role);

    card.append(avatarWrap, info);

    if (isSelected) {
      const checkBadge = el('div', { class: 'avatar-picker-badge' });
      checkBadge.append(icon('check'));
      card.append(checkBadge);
    }

    card.onclick = () => {
      setActiveAvatarId(item.id);
      toast(`已切换头像为「${item.name}」`);
      onSelect?.(item.id);
      handle?.close();
    };

    grid.append(card);
  }

  container.append(handleBar, header, grid);

  handle = openBottomSheet({
    label: '选择头像',
    content: container,
    className: 'avatar-picker-sheet',
  });

  return handle;
}
