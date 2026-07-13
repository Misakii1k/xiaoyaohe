// Worker 环境类型与 KV 键名约定。
// 数据类型直接复用前端 src/db/schema.ts（import type，编译期擦除，运行时零依赖）——前后端契约零漂移。
import type { Medication, ReminderRule, IntakeLog } from '../src/db/schema.ts';

export interface Env {
  /** KV：同步主体 + 服药记录 + 推送状态 */
  MEDBOX: KVNamespace;
  /** 同步共享密钥（wrangler secret put SYNC_SECRET）。可选：未设则不校验 */
  SYNC_SECRET?: string;
  /** AI 视觉接口 API key（wrangler secret put AI_API_KEY） */
  AI_API_KEY?: string;
  /** AI base url，OpenAI 兼容；如阿里 https://dashscope.aliyuncs.com/compatible-mode/v1 */
  AI_BASE_URL?: string;
  /** AI 模型名，如 qwen-vl-max / glm-4v / gpt-4o-mini */
  AI_MODEL?: string;
}

export type { Medication, ReminderRule, IntakeLog };

/** 云端同步快照（KV: data:{household}） */
export interface CloudSnapshot {
  meds: Medication[];
  rules: ReminderRule[];
  logs?: IntakeLog[];
  updatedAt: number;
}

// ---- KV 键名 ----
export const kvKey = {
  data: (household: string) => `data:${household}`,
  log: (household: string, yyyymmdd: string) => `log:${household}:${yyyymmdd}`,
  push: (household: string, logId: string) => `push:${household}:${logId}`,
};
