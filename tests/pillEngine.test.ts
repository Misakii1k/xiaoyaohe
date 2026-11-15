import { describe, expect, it } from 'vitest';
import { consentCategoryFor } from '../src/ai/consent';
import {
  getRegisteredLocalYoloProvider,
  normalizePillPoints,
  registerLocalYoloProvider,
  type LocalYoloProvider,
  type PillDetectionMode,
} from '../src/features/pillEngine';

describe('pillEngine contracts & consent', () => {
  it('maps pill-photo to health consent category', () => {
    expect(consentCategoryFor('pill-photo')).toBe('health');
  });

  it('normalizes [0..1] cloud points to pixel coords and deduplicates near-identical points', () => {
    const mode: PillDetectionMode = 'loose';
    const pts = normalizePillPoints(
      [
        { x: 0.5, y: 0.5 },
        { x: 0.503, y: 0.502 },
        { x: 0.2, y: 0.25 },
      ],
      1000,
      800,
      { mode },
    );
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ x: 500, y: 400, isManual: false });
    expect(pts[1]).toMatchObject({ x: 200, y: 200, isManual: false });
  });

  it('exposes optional phase-2 YOLO hook defaulting to null and allows register/unregister', () => {
    expect(getRegisteredLocalYoloProvider()).toBeNull();
    const dummy: LocalYoloProvider = {
      id: 'yolo-test',
      label: 'YOLO v11',
      isReady: () => true,
      detect: async () => ({ points: [] }),
    };
    registerLocalYoloProvider(dummy);
    expect(getRegisteredLocalYoloProvider()).toBe(dummy);
    registerLocalYoloProvider(null);
    expect(getRegisteredLocalYoloProvider()).toBeNull();
  });
});
