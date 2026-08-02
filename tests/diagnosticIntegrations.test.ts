import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('diagnostic integrations', () => {
  it('records reminder startup and action failures without changing fallback flow', () => {
    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
    const transport = readFileSync(join(root, 'src/features/reminderTransport.ts'), 'utf8');

    expect(main).toContain("reportSilentFailure('reminder.initialize'");
    expect(main).toContain("reportSilentFailure('reminder.action'");
    expect(main).toContain("reportSilentFailure('reminder.scheduler-start'");
    expect(transport).toContain("reportSilentFailure('reminder.native-reconcile'");
    expect(transport).toContain("reportSilentFailure('reminder.schedule-chunk'");
  });

  it('records automatic LAN failures while preserving retries and summary counts', () => {
    const source = readFileSync(join(root, 'src/sync/lan/autoSync.ts'), 'utf8');

    expect(source).toContain("reportSilentFailure('lan.auto-join'");
    expect(source).toContain("reportSilentFailure('lan.persistent-host'");
  });

  it('records photo read, recompression and migration failures without identifiers', () => {
    const source = readFileSync(join(root, 'src/features/medPhotos.ts'), 'utf8');

    expect(source).toContain("reportSilentFailure('photo.recompress'");
    expect(source).toContain("reportSilentFailure('photo.read'");
    expect(source).toContain("reportSilentFailure('photo.migration-item'");
    expect(source).toContain("reportSilentFailure('photo.migration'");
  });
});
