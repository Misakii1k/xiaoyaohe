import { el, icon, type IconName } from '../../../ui/components';
import appIconUrl from '../../../assets/images3d/app-icon.png';

export function renderAboutSection(): HTMLElement {
  const aboutSection = el('section', { class: 'settings-group-section settings-about-section' });

  const aboutCard = el('div', { class: 'settings-group-card settings-about-card settings-about-center' });

  // 1. 居中 App 图标与光晕底座
  const logoWrap = el('div', { class: 'settings-about-logo-wrap' });
  const logo = el('img', {
    class: 'settings-about-logo',
    src: appIconUrl,
    alt: '小药盒 App 图标',
    loading: 'lazy',
    decoding: 'async',
  });
  logoWrap.append(logo);

  // 2. 居中标题与副标
  const title = el('h2', { class: 'settings-about-app-name', text: '小药盒' });
  const subtitle = el('div', { class: 'settings-about-app-sub', text: '家庭健康用药管家' });

  // 3. 优雅版本药丸胶囊
  const badgeWrap = el('div', { class: 'settings-about-badge-wrap' });
  const versionBadge = el('span', { class: 'settings-about-badge', text: `v${__APP_VERSION__} (正式版)` });
  badgeWrap.append(versionBadge);

  // 4. 品牌简介
  const intro = el('div', {
    class: 'settings-about-intro',
    text: '用于家庭日常用药管理。服药提醒、药品信息与库存记录均保存在本地设备中，不展示广告，无需注册账号。',
  });

  // 5. 2x2 精致特性磁贴
  const createTile = (tileTitle: string, tileDesc: string, iconName: IconName, tone: string) => {
    const tile = el('div', { class: `settings-about-tile tone-${tone}` });
    const tileHead = el('div', { class: 'settings-about-tile-head' });
    const tileIcon = el('span', { class: 'settings-about-tile-icon' });
    tileIcon.append(icon(iconName));
    const titleEl = el('span', { class: 'settings-about-tile-title', text: tileTitle });
    tileHead.append(tileIcon, titleEl);
    const descEl = el('span', { class: 'settings-about-tile-desc', text: tileDesc });
    tile.append(tileHead, descEl);
    return tile;
  };

  const highlights = el('div', { class: 'settings-about-grid' }, [
    createTile('定时服药', '准时提醒与打卡记录', 'bell', 'amber'),
    createTile('药箱余量', '低余量智能实时预警', 'box', 'emerald'),
    createTile('纯净本地', '全量数据保存在本地设备', 'shield', 'teal'),
    createTile('家庭同步', '局域网面对面免流量互传', 'cloud', 'blue'),
  ]);

  // 6. 底部健康免责声明
  const disclaimer = el('div', {
    class: 'settings-about-disclaimer muted',
    text: '健康声明：小药盒的服药提醒与助手建议仅供日常健康管理参考，不构成处方或临床诊断意见。如有不适，请咨询专业医生。',
  });

  aboutCard.append(logoWrap, title, subtitle, badgeWrap, intro, highlights, disclaimer);
  aboutSection.append(aboutCard);
  return aboutSection;
}
