import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkInteractions,
  filterNewInteractions,
  acknowledgeInteractions,
  interactionKey,
  type DrugInteraction,
} from './drugInteractions';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? (this.store.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
}

const HITS: DrugInteraction[] = [
  { drugs: ['华法林', '阿司匹林'], severity: 'severe', description: '出血风险' },
  { drugs: ['布洛芬', '酒精'], severity: 'moderate', description: '胃损伤' },
];

describe('interaction acknowledgment dedup', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('interactionKey 对同组不同顺序产出同一键', () => {
    const a = interactionKey({ drugs: ['华法林', '阿司匹林'], severity: 'severe', description: '' });
    const b = interactionKey({ drugs: ['阿司匹林', '华法林'], severity: 'severe', description: '' });
    expect(a).toBe(b);
  });

  it('filterNewInteractions 首次全保留', () => {
    expect(filterNewInteractions(HITS)).toHaveLength(2);
  });

  it('acknowledge 后同组不再出现', () => {
    const acknowledged = HITS[0];
    expect(acknowledged).toBeDefined();
    if (!acknowledged) return;
    localStorage.setItem('medbox.interactions.acknowledged.v1', JSON.stringify([interactionKey(acknowledged)]));
    const fresh = filterNewInteractions(HITS);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.drugs).toEqual(['布洛芬', '酒精']);
  });

  it('acknowledgeInteractions 写入后 filter 清空', () => {
    localStorage.removeItem('medbox.interactions.acknowledged.v1');
    acknowledgeInteractions(HITS);
    expect(filterNewInteractions(HITS)).toHaveLength(0);
  });

  it('checkInteractions 仍正常工作', () => {
    expect(checkInteractions(['华法林钠片', '阿司匹林肠溶片'])).toHaveLength(1);
    expect(checkInteractions(['阿莫西林'])).toHaveLength(0);
  });
});
