import type { Medication, ReminderRule, IntakeLog } from '../src/db/schema.ts';

export interface Env {
  MEDBOX: KVNamespace;
  SYNC_SECRET?: string;
  SYNC_V1_READONLY_ENABLED?: string;
  SYNC_V2_ENABLED?: string;
  SYNC_V2_ALLOWED_ORIGINS?: string;
  SYNC_V2_HOUSEHOLDS?: DurableObjectNamespace;
  SYNC_V2_RATE_LIMITER?: DurableObjectNamespace;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
}

export type { Medication, ReminderRule, IntakeLog };

export interface CloudSnapshot {
  meds: Medication[];
  rules: ReminderRule[];
  logs?: IntakeLog[];
  updatedAt: number;
}

export const kvKey = {
  data: (household: string) => `data:${household}`,
  log: (household: string, yyyymmdd: string) => `log:${household}:${yyyymmdd}`,
  push: (household: string, logId: string) => `push:${household}:${logId}`,
};
