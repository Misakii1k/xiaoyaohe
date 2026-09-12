// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { clearAppCache, getAppCacheSize } from '../src/sync/lan/apkTransport';

describe('cacheStorage 存储空间与缓存管理', () => {
  it('在无原生插件环境（如网页端）调用 getAppCacheSize 时应安全降级返回 0 B', async () => {
    const size = await getAppCacheSize();
    expect(size).toBeDefined();
    expect(size.bytes).toBe(0);
    expect(size.formatted).toBe('0 B');
  });

  it('在无原生插件环境（如网页端）调用 clearAppCache 时应安全降级返回成功且 0 B', async () => {
    const result = await clearAppCache();
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.freedBytes).toBe(0);
    expect(result.formatted).toBe('0 B');
  });
});
