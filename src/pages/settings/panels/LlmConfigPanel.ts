import { confirmDialog, el, toast } from '../../../ui/components';
import { openLlmProviderEditor } from '../../../ui/llmProviderEditor';
import {
  DEFAULT_LLM_CONFIG,
  getLlmHealth,
  getLlmProviderSet,
  isUsingDefaultKey,
  MAX_LLM_PROVIDERS,
  setLlmProviderSet,
  type LlmHealth,
  type LlmProvider,
} from '../../../ai/llmConfig';
import { clearAiConsents, getAiConsentRecords, revokeAiConsent } from '../../../ai/consent';
import {
  getWebSecretPersistence,
  isNativeSecretStore,
  setWebSecretPersistence,
  WEB_SECRET_STORAGE_NOTICE,
} from '../../../ai/secretStore';
import type { PanelChip, SettingsRenderPart } from '../types';
import { panel, setChip } from '../components/panelPrimitives';

/** ---------------- AI 大模型面板（支持模型自动检测 + 状态） ---------------- */
export function renderLlmPanel(): SettingsRenderPart {
  const initialHealth = getLlmHealth();
  const chip = healthToChip(initialHealth);
  const p = panel({
    title: 'AI 服务商',
    iconName: 'robot',
    iconTone: 'purple',
    chip,
    renderBody: (body) => buildLlmBody(body, (h) => setChip(p, healthToChip(h))),
  });

  // 监听启动期静默体检的回调（main.ts fire）
  const onHealth = (e: Event) => {
    const h = (e as CustomEvent<LlmHealth>).detail;
    setChip(p, healthToChip(h));
  };
  window.addEventListener('medbox:llm-health', onHealth);

  return {
    element: p,
    cleanup: () => window.removeEventListener('medbox:llm-health', onHealth),
  };
}

export function healthToChip(h: LlmHealth): PanelChip {
  if (isUsingDefaultKey()) return { text: '未配置', tone: 'muted' };
  if (h.state === 'ok') return { text: '已连接', tone: 'ok' };
  if (h.state === 'error') return { text: '不通', tone: 'warn' };
  return { text: '未检测', tone: 'muted' };
}

export function buildLlmBody(body: HTMLElement, onHealthChange: (h: LlmHealth) => void): void {
  body.append(
    el('div', {
      class: 'muted',
      html: '在「编辑药品」里用一句话描述，AI 自动填写药名、规格、用量、时段、提醒时间。可以保存多家服务商，当前一家连不上时按列表顺序自动换下一家。',
    }),
  );

  const missingKey = isUsingDefaultKey();
  if (missingKey) {
    body.append(
      el('div', { class: 'banner info mt-3' }, [
        el('span', {
          html: isNativeSecretStore()
            ? '还没填 AI 密钥。手机 App 会把它存进系统安全存储替您保管。'
            : '还没填 AI 密钥。网页版只能把它明文存在这台电脑的浏览器里，请看下方的保存方式说明。',
        }),
      ]),
    );
  }

  // 网页端没有系统安全存储可用，密钥只能明文留在浏览器里。如实告知 + 给一个真正有效的选项。
  if (!isNativeSecretStore()) {
    const webSecretCard = el('div', { class: 'settings-subcard' });
    const secHead = el('div', { class: 'settings-subcard-header' });
    secHead.append(
      el('div', { class: 'settings-subcard-title', text: '网页端密钥存储方式' }),
      el('span', {
        class: 'settings-subcard-badge',
        style: 'background: rgba(245, 158, 11, 0.15); color: #b45309;',
        text: '浏览器存储',
      }),
    );
    webSecretCard.append(
      secHead,
      el('div', { class: 'banner warn' }, [
        el('span', { text: WEB_SECRET_STORAGE_NOTICE }),
      ]),
      buildWebSecretPersistenceRow(),
    );
    body.append(webSecretCard);
  }

  const providerCard = el('div', { class: 'settings-subcard' });
  const cardHead = el('div', { class: 'settings-subcard-header' });
  const titleWrap = el('div', { class: 'settings-subcard-title-wrap' });
  titleWrap.append(el('div', { class: 'settings-subcard-title', text: 'AI 服务商管理' }));
  const countBadge = el('span', {
    class: 'settings-subcard-badge',
    style: 'background: rgba(99, 102, 241, 0.12); color: #6366f1;',
    text: '智能容灾调度',
  });
  cardHead.append(titleWrap, countBadge);
  providerCard.append(cardHead);

  const listWrap = el('div', { class: 'llm-provider-list' });
  const failoverRow = el('div', { class: 'settings-toggle-row' });
  providerCard.append(listWrap, failoverRow);
  body.append(providerCard);

  const persistAndRender = async (
    providers: LlmProvider[],
    activeId: string,
    failover: boolean,
  ): Promise<void> => {
    await persistProviderSet(providers, activeId, failover, onHealthChange);
    renderList();
  };
  const runProviderMutation = async (mutation: () => Promise<void>): Promise<void> => {
    try {
      await mutation();
    } catch (error) {
      toast('保存失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const renderList = () => {
    const set = getLlmProviderSet();
    listWrap.replaceChildren();

    set.providers.forEach((provider, index) => {
      const row = el('div', { class: `llm-provider-row${provider.id === set.activeId ? ' is-active' : ''}` });
      const head = el('div', { class: 'llm-provider-head' });
      const title = el('div', { class: 'llm-provider-title' });
      const rankBadge = el('span', { class: 'llm-provider-rank', text: `#${index + 1}` });
      title.append(
        rankBadge,
        el('span', { class: 'llm-provider-name', text: provider.label }),
      );
      head.append(title);

      const badges = el('div', { class: 'llm-provider-badges' });
      if (provider.id === set.activeId) {
        badges.append(el('span', { class: 'llm-provider-badge', text: '当前' }));
      }

      const host = hostOf(provider.baseUrl);
      const health = getLlmHealth(provider.id);
      let statusText = '未检测';
      let statusCls = 'pending';
      if (!provider.apiKey) {
        statusText = '未填密钥';
        statusCls = 'warn';
      } else if (health.state === 'ok') {
        statusText = '已连接';
        statusCls = 'ok';
      } else if (health.state === 'error') {
        statusText = '不通';
        statusCls = 'error';
      }

      const statusBadge = el('span', { class: `llm-provider-status ${statusCls}` });
      statusBadge.append(
        el('span', { class: 'llm-status-dot' }),
        el('span', { class: 'llm-status-text', text: statusText }),
      );
      badges.append(statusBadge);
      head.append(badges);
      row.append(head);

      const meta = el('div', { class: 'llm-provider-meta' });
      meta.append(
        el('span', { class: 'llm-meta-host', text: host }),
        el('span', { class: 'llm-meta-sep', text: '·' }),
        el('span', { class: 'llm-meta-model', text: provider.model }),
      );
      row.append(meta);

      const actions = el('div', { class: 'llm-provider-actions' });
      const actionsLeft = el('div', { class: 'llm-actions-left' });
      const actionsRight = el('div', { class: 'llm-actions-right' });

      if (index > 0) {
        const up = el('button', { class: 'btn tonal small', type: 'button', html: '↑ 上移' });
        up.title = '优先级上移';
        up.onclick = () => void runProviderMutation(async () => {
          const latest = getLlmProviderSet();
          const currentIndex = latest.providers.findIndex((item) => item.id === provider.id);
          if (currentIndex <= 0) return;
          const next = [...latest.providers];
          const upper = next[currentIndex - 1]!;
          const lower = next[currentIndex]!;
          next[currentIndex - 1] = lower;
          next[currentIndex] = upper;
          await persistAndRender(next, latest.activeId, latest.failover);
        });
        actionsLeft.append(up);
      }

      if (provider.id !== set.activeId) {
        const activate = el('button', { class: 'btn tonal small llm-activate-btn', type: 'button', html: '设为当前' });
        activate.onclick = () => void runProviderMutation(async () => {
          const latest = getLlmProviderSet();
          await persistAndRender(latest.providers, provider.id, latest.failover);
        });
        actionsRight.append(activate);
      }

      const edit = el('button', { class: 'btn tonal small', type: 'button', html: '编辑' });
      edit.onclick = () => void openLlmProviderEditor(provider, async (draft) => {
        const latest = getLlmProviderSet();
        const next = latest.providers.map((item) => (item.id === draft.id ? draft : item));
        await persistAndRender(next, latest.activeId, latest.failover);
      });
      actionsRight.append(edit);

      if (set.providers.length > 1) {
        const remove = el('button', { class: 'btn text small danger-text', type: 'button', html: '删除' });
        remove.onclick = async () => {
          const ok = await confirmDialog(`删除服务商「${provider.label}」？删除后密钥一并清除。`, '删除', true);
          if (!ok) return;
          await runProviderMutation(async () => {
            const latest = getLlmProviderSet();
            const next = latest.providers.filter((item) => item.id !== provider.id);
            await persistAndRender(next, latest.activeId === provider.id ? next[0]!.id : latest.activeId, latest.failover);
          });
        };
        actionsRight.append(remove);
      }

      actions.append(actionsLeft, actionsRight);
      row.append(actions);
      listWrap.append(row);
    });

    if (set.providers.length >= MAX_LLM_PROVIDERS) {
      listWrap.append(el('div', { class: 'muted', text: `最多保存 ${MAX_LLM_PROVIDERS} 家服务商。` }));
    } else {
      const add = el('button', { class: 'btn tonal mt-3', type: 'button', html: '+ 添加服务商' });
      add.onclick = () => void openLlmProviderEditor(undefined, async (draft) => {
        const latest = getLlmProviderSet();
        await persistAndRender([...latest.providers, draft], draft.id, latest.failover);
      });
      listWrap.append(add);
    }
  };

  const failoverToggle = el('input', { type: 'checkbox', role: 'switch', 'aria-label': '自动切换服务商' });
  failoverToggle.checked = getLlmProviderSet().failover;
  failoverToggle.onchange = async () => {
    const set = getLlmProviderSet();
    try {
      await persistProviderSet(set.providers, set.activeId, failoverToggle.checked, onHealthChange);
      toast(failoverToggle.checked ? '已开启自动切换：当前服务商连不上时自动换下一家' : '已关闭自动切换：只使用当前选中的服务商');
    } catch (error) {
      failoverToggle.checked = set.failover;
      toast('保存失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };
  failoverRow.append(
    el('div', { class: 'settings-toggle-copy' }, [
      el('div', { class: 'settings-toggle-title', text: '自动切换服务商' }),
      el('div', {
        class: 'settings-toggle-desc',
        text: '当前服务商连不上（超时、服务端错误、限流）时，按列表顺序自动试下一家；切换会在界面提示。',
      }),
    ]),
    failoverToggle,
  );

  renderList();

  body.append(
    el('div', {
      class: 'settings-hint',
      html:
        '· 支持 DeepSeek、智谱等主流 AI 服务商；\n' +
        `· 最多可添加 ${MAX_LLM_PROVIDERS} 家服务商，自动按列表顺序智能故障转移；\n` +
        `· 当前推荐模型 ${DEFAULT_LLM_CONFIG.model}；\n` +
        (isNativeSecretStore()
          ? '· 密钥保存在这台手机的系统安全存储中。'
          : '· 网页版没有系统安全存储可用，密钥在浏览器里是明文保存的。'),
    }),
  );
}

export async function persistProviderSet(
  providers: LlmProvider[],
  activeId: string,
  failover: boolean,
  onHealthChange: (h: LlmHealth) => void,
): Promise<void> {
  await setLlmProviderSet({ providers, activeId, failover });
  // 换到新服务商后，把它的体检结果刷到面板标题和状态栏。
  onHealthChange(getLlmHealth(activeId));
}

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

/**
 * 网页端密钥存放方式的开关。
 *
 * 这里不提供「加密保存」这种选项：密钥和解开它所需的一切都在同一个浏览器里，
 * 前端加密拦不住任何真正能读到存储的人，只会给用户虚假的安全感。
 * 真正有意义的区别只有「关掉标签页还在不在」，所以就只给这一个选择。
 */
export function buildWebSecretPersistenceRow(): HTMLElement {
  const sessionOnly = getWebSecretPersistence() === 'session';
  const row = el('div', { class: 'settings-toggle-row' });
  const copy = el('div', { class: 'settings-toggle-copy' });
  copy.append(
    el('div', { class: 'settings-toggle-title', text: '仅本次会话保存密钥' }),
    el('div', {
      class: 'settings-toggle-desc',
      text: sessionOnly
        ? '关掉这个标签页密钥就没了，下次要重新填。适合公用电脑。'
        : '密钥会留在这台电脑上，关掉浏览器再打开还在。',
    }),
  );
  const toggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '仅本次会话保存密钥',
  });
  toggle.checked = sessionOnly;
  toggle.onchange = async () => {
    const requestedMode = toggle.checked ? 'session' : 'device';
    toggle.disabled = true;
    try {
      // 已填的密钥会被就地搬到新位置，用户不必重输
      await setWebSecretPersistence(requestedMode);
      toast(requestedMode === 'session' ? '密钥改为仅本次会话保存' : '密钥将保留在这台电脑上');
      const desc = copy.querySelector<HTMLElement>('.settings-toggle-desc');
      if (desc) {
        desc.textContent = requestedMode === 'session'
          ? '关掉这个标签页密钥就没了，下次要重新填。适合公用电脑。'
          : '密钥会留在这台电脑上，关掉浏览器再打开还在。';
      }
    } catch {
      toggle.checked = getWebSecretPersistence() === 'session';
      toast('密钥存放方式切换失败，请重试');
    } finally {
      toggle.disabled = false;
    }
  };
  row.append(copy, toggle);
  return row;
}

export function aiConsentChip(): PanelChip {
  const count = getAiConsentRecords().length;
  return count > 0
    ? { text: `${count} 项授权`, tone: 'ok' }
    : { text: '首次询问', tone: 'muted' };
}

export function renderAiConsentPanel(): HTMLElement {
  let panelElement!: HTMLElement;
  panelElement = panel({
    title: 'AI 外发授权',
    iconName: 'lock',
    iconTone: 'gold',
    chip: aiConsentChip(),
    renderBody: (body) => {
      const card = el('div', { class: 'settings-subcard' });
      const head = el('div', { class: 'settings-subcard-header' });
      head.append(
        el('div', { class: 'settings-subcard-title', text: '已授权的服务商列表' }),
        el('span', {
          class: 'settings-subcard-badge',
          style: 'background: rgba(245, 158, 11, 0.15); color: #b45309;',
          text: '隐私保护',
        }),
      );
      card.append(
        head,
        el('div', {
          class: 'muted settings-subcard-desc',
          text: '药盒、药单和用药信息会按“健康”类别授权；小助手对话和联网搜索按“助手”类别授权。同一服务商同一类别只会首次询问。',
        }),
        renderAiConsentControls(() => setChip(panelElement, aiConsentChip())),
      );
      body.append(card);
    },
  });
  return panelElement;
}

export function renderAiConsentControls(onChanged: () => void): HTMLElement {
  const wrap = el('div', { class: 'ai-consent-controls' });
  const title = el('div', { class: 'section-title', html: '已授权的 AI 服务商' });
  const list = el('div', { class: 'ai-consent-list' });
  const clear = el('button', { class: 'btn text small', type: 'button', text: '撤销全部授权' });
  const render = () => {
    list.replaceChildren();
    const records = getAiConsentRecords();
    clear.hidden = records.length === 0;
    if (records.length === 0) {
      list.append(el('div', { class: 'muted', html: '尚未保存外发数据授权。首次识别或分析时会显示服务商域名。' }));
      return;
    }
    for (const record of records) {
      const row = el('div', { class: 'ai-consent-row' });
      const text = el('div');
      text.append(el('strong', { text: record.origin }));
      text.append(el('div', {
        class: 'muted',
        text: record.category === 'health'
          ? '吃药相关（药盒、药单、用药信息）'
          : '小助手对话与联网搜索',
      }));
      const revoke = el('button', { class: 'btn text small', type: 'button', text: '撤销' });
      revoke.onclick = () => {
        revokeAiConsent(record.origin, record.category);
        render();
        onChanged();
        toast('已撤销该服务商授权');
      };
      row.append(text, revoke);
      list.append(row);
    }
  };
  clear.onclick = () => {
    clearAiConsents();
    render();
    onChanged();
    toast('已撤销全部 AI 外发授权');
  };
  wrap.append(title, list, clear);
  render();
  return wrap;
}
