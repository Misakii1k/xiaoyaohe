import { describe, expect, it } from 'vitest';
import { emptyIdentity, inflateMed } from '../src/db/schema';

describe('medication reminder mode migration', () => {
  it('defaults legacy medications to strong reminders', () => {
    const legacy = inflateMed({
      id: 'legacy',
      name: '旧药',
      slots: [],
      mealRels: [],
      mealRelsBySlot: {},
      daysOfWeek: [],
      identity: emptyIdentity(),
    });
    expect(legacy.reminderMode).toBe('strong');
  });

  it('preserves supported full-screen modes and rejects unknown values', () => {
    expect(inflateMed({ reminderMode: 'fullscreen-short' }).reminderMode).toBe('fullscreen-short');
    expect(inflateMed({ reminderMode: 'loudest' }).reminderMode).toBe('strong');
  });
});
