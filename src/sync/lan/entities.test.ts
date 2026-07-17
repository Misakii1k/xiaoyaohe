import { describe, expect, it } from 'vitest';
import {
  LAN_SYNC_MAX_ENTRIES,
  LAN_SYNC_MAX_JSON_BYTES,
  hashLanPayload,
  parseLanEntityPayload,
  parseLanSyncSnapshot,
  selectLanIntakePayload,
  selectLanMedicationPayload,
  verifyLanSyncSnapshotHashes,
  type LanMedicationPayload,
  type LanSyncSnapshot,
} from './entities';
import { emptyIdentity, type IntakeLog, type Medication } from '../../db/schema';

const SESSION_ID = '-12345678901234567890_';

describe('LAN sync entity boundary', () => {
  it('selects medication fields without local inventory, photo traces, or legacy fields', () => {
    const raw = medication('med_boundary', 'Boundary medicine') as Medication & Record<string, unknown>;
    raw.inventory = { remaining: 19, unit: 'tablet', lowThreshold: 3 };
    raw.deleted = true;
    raw.expiryDate = 1_900_000_000_000;
    raw.expirySourceTimestamp = raw.expiryDate;
    raw.mealRel = 'with';
    raw.identity.photoHashes = ['private-photo-hash'];
    raw.workEntries = [{ project: 'WORK_PRIVATE_MARKER', income: 88_888 }];
    raw.aiApiKey = 'secret-ai-key';
    raw.pushState = { permission: 'granted' };

    const selected = selectLanMedicationPayload(raw);
    expect(selected).toMatchObject({
      id: raw.id,
      identity: { gtins: ['gtin-1'], rawCodes: [], ocrNames: ['name-1'] },
    });
    expect(selected).not.toHaveProperty('inventory');
    expect(selected).not.toHaveProperty('deleted');
    expect(selected).not.toHaveProperty('expiryDate');
    expect(selected).not.toHaveProperty('expirySourceTimestamp');
    expect(selected).not.toHaveProperty('mealRel');
    expect(selected).not.toHaveProperty('updatedAt');
    expect(selected.identity).not.toHaveProperty('photoHashes');
    expect(JSON.stringify(selected)).not.toContain('WORK_PRIVATE_MARKER');
    expect(JSON.stringify(selected)).not.toContain('secret-ai-key');
  });

  it('rejects forbidden and unknown fields instead of silently stripping them', () => {
    const valid = medicationPayload('med_strict', 'Strict medicine');
    for (const forbidden of [
      { inventory: { remaining: 1, unit: 'tablet' } },
      { deleted: true },
      { expiryDate: 1 },
      { expirySourceTimestamp: 1 },
      { mealRel: 'with' },
      { workEntries: [{ income: 1 }] },
      { aiSecret: 'secret' },
      { pushState: {} },
      { photos: ['data:image/png;base64,private'] },
    ]) {
      expect(() => parseLanEntityPayload('medication', { ...valid, ...forbidden })).toThrow();
    }
    expect(() => parseLanEntityPayload('medication', {
      ...valid,
      identity: { ...valid.identity, photoHashes: ['private'] },
    })).toThrow();
    expect(() => parseLanEntityPayload('medication', { ...valid, updatedAt: 1 })).toThrow();

    expect(() => parseLanEntityPayload('reminderRule', {
      id: 'rule_strict',
      medId: valid.id,
      slot: 'morning',
      timeLocal: '08:00',
      enabled: true,
      escalate: { repeatEveryMin: 10, maxRepeats: 3, notifyCaregiverAfterMin: 30 },
      updatedAt: 1,
      deleted: false,
    })).toThrow();
    expect(() => parseLanEntityPayload('intake', {
      id: 'intake_pending',
      medId: valid.id,
      slot: 'morning',
      dueAt: 1,
      status: 'pending',
      updatedAt: 1,
    })).toThrow();
    expect(() => parseLanEntityPayload('intake', {
      id: 'intake_inventory_delta',
      medId: valid.id,
      slot: 'morning',
      dueAt: 1,
      status: 'taken',
      inventoryDelta: 1,
      updatedAt: 1,
    })).toThrow();
  });

  it('keeps the device-local inventory deduction out of intake payloads', () => {
    const selected = selectLanIntakePayload({
      id: 'intake_local_only_delta',
      medId: 'med_boundary',
      slot: 'morning',
      dueAt: 1,
      status: 'taken',
      ackAt: 2,
      inventoryDelta: 3,
      updatedAt: 2,
    } satisfies IntakeLog);
    expect(selected).not.toHaveProperty('inventoryDelta');
  });

  it('allows schedule upserts but rejects schedule tombstones and unsupported entities', async () => {
    const tombstoneHash = await hashLanPayload(null);
    expect(() => parseLanSyncSnapshot({
      schemaVersion: 1,
      sessionId: SESSION_ID,
      entries: [{
        entityType: 'schedule',
        entityId: 'schedule:one',
        tombstone: true,
        clock: 1,
        deviceId: 'device_a',
        payloadHash: tombstoneHash,
      }],
    })).toThrow();
    expect(() => parseLanSyncSnapshot({
      schemaVersion: 1,
      sessionId: SESSION_ID,
      entries: [{
        entityType: 'work',
        entityId: 'work_private',
        tombstone: true,
        clock: 1,
        deviceId: 'device_a',
        payloadHash: tombstoneHash,
      }],
    })).toThrow();
  });

  it('enforces the total JSON and entity-count limits', async () => {
    const tombstoneHash = await hashLanPayload(null);
    const entries = Array.from({ length: LAN_SYNC_MAX_ENTRIES + 1 }, (_, index) => ({
      entityType: 'intake',
      entityId: `intake_${index}`,
      tombstone: true,
      clock: index + 1,
      deviceId: 'device_limits',
      payloadHash: tombstoneHash,
    }));
    expect(() => parseLanSyncSnapshot({
      schemaVersion: 1,
      sessionId: SESSION_ID,
      entries,
    })).toThrow();

    const oversizedSession = `s${'x'.repeat(LAN_SYNC_MAX_JSON_BYTES)}`;
    expect(() => parseLanSyncSnapshot({
      schemaVersion: 1,
      sessionId: oversizedSession,
      entries: [],
    })).toThrow(/5 MiB/);
  });

  it('detects payload tampering after strict parsing', async () => {
    const payload = medicationPayload('med_hash', 'Original');
    const snapshot: LanSyncSnapshot = {
      schemaVersion: 1,
      sessionId: SESSION_ID,
      entries: [{
        entityType: 'medication',
        entityId: payload.id,
        tombstone: false,
        clock: 1,
        deviceId: 'device_hash',
        payloadHash: await hashLanPayload(payload),
        payload,
      }],
    };
    const parsed = parseLanSyncSnapshot(snapshot);
    await expect(verifyLanSyncSnapshotHashes(parsed)).resolves.toBeUndefined();
    (parsed.entries[0] as { payload: LanMedicationPayload }).payload.name = 'Tampered';
    await expect(verifyLanSyncSnapshotHashes(parsed)).rejects.toThrow(/hash mismatch/);
  });
});

function medication(id: string, name: string): Medication {
  return {
    id,
    name,
    dosageText: '5mg',
    amountPerDose: '1 tablet',
    doseQuantity: 1,
    doseUnit: 'tablet',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: {
      ...emptyIdentity(),
      gtins: ['gtin-1'],
      ocrNames: ['name-1'],
    },
    updatedAt: 1,
    createdAt: 1,
  };
}

function medicationPayload(id: string, name: string): LanMedicationPayload {
  return {
    id,
    name,
    dosageText: '5mg',
    amountPerDose: '1 tablet',
    doseQuantity: 1,
    doseUnit: 'tablet',
    slots: ['morning'],
    mealRels: [],
    mealRelsBySlot: {},
    daysOfWeek: [],
    identity: { gtins: [], rawCodes: [], ocrNames: [] },
    createdAt: 1,
  };
}
