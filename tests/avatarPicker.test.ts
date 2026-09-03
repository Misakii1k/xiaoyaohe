// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAvatarList,
  getActiveAvatarId,
  setActiveAvatarId,
  getAvatarById,
  getUserAvatarSvg,
} from '../src/ui/avatars';
import { openAvatarPicker } from '../src/ui/AvatarPicker';

describe('avatars.ts & AvatarPicker.ts - 16套统一风格3D头像库契约', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.replaceChildren();
  });

  it('头像库恰好包含 16 款统一角色，ID 全部唯一且包含合法 SVG', () => {
    const list = getAvatarList();
    expect(list).toHaveLength(16);

    const ids = new Set(list.map((item) => item.id));
    expect(ids.size).toBe(16);

    for (const item of list) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.role.length).toBeGreaterThan(0);
      expect(item.svg).toContain('<svg');
      expect(item.svg).toContain('viewBox="0 0 100 100"');
      expect(item.svg).toContain('class="asset-3d-avatar"');
    }
  });

  it('默认头像为 grandma_glasses，支持持久化更新与自定义事件派发', () => {
    expect(getActiveAvatarId()).toBe('grandma_glasses');

    let eventFired = false;
    window.addEventListener('medbox:avatar-change', (e: any) => {
      if (e.detail?.id === 'doctor_male') eventFired = true;
    });

    setActiveAvatarId('doctor_male');
    expect(getActiveAvatarId()).toBe('doctor_male');
    expect(window.localStorage.getItem('medbox_user_avatar_id')).toBe('doctor_male');
    expect(eventFired).toBe(true);
  });

  it('getAvatarById 在 ID 不存在时优雅回退至首个默认头像', () => {
    const defaultAvatar = getAvatarById('unknown_id_123');
    expect(defaultAvatar.id).toBe('grandma_glasses');
  });

  it('getUserAvatarSvg 能动态输出当前选中的头像 SVG', () => {
    setActiveAvatarId('golden_retriever');
    const svg = getUserAvatarSvg();
    expect(svg).toContain('av14-fur');
  });

  it('openAvatarPicker 会在 DOM 中展开包含 16 款头像的底部抽屉，并标出当前激活项', () => {
    setActiveAvatarId('smart_pill_bot');
    const onSelect = vi.fn();
    const handle = openAvatarPicker(onSelect);

    const sheet = document.querySelector('.avatar-picker-sheet');
    expect(sheet).not.toBeNull();

    const cards = document.querySelectorAll('.avatar-picker-card');
    expect(cards).toHaveLength(16);

    const activeCard = document.querySelector('.avatar-picker-card.active');
    expect(activeCard).not.toBeNull();
    expect(activeCard?.getAttribute('aria-label')).toContain('药盒伙伴');

    // 点击另一个头像
    const targetCard = Array.from(cards).find((c) => c.getAttribute('aria-label')?.includes('仁心医生')) as HTMLElement;
    expect(targetCard).toBeDefined();
    targetCard.click();

    expect(getActiveAvatarId()).toBe('doctor_male');
    expect(onSelect).toHaveBeenCalledWith('doctor_male');

    handle.close();
  });
});
