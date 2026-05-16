import { z } from 'zod';
import {
  accountStatusSchema,
  isoDateTimeSchema,
  nullableIsoDateTimeSchema,
  providerIdSchema,
  schemaVersionSchema,
  usedPercentageSchema
} from './common.js';

export const historyEntrySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    timestamp: isoDateTimeSchema,
    provider: providerIdSchema,
    email: z.string(),
    quotaWindow: z.string(),
    usedPercentage: usedPercentageSchema,
    resetAt: nullableIsoDateTimeSchema,
    status: accountStatusSchema
  })
  .strict();

export type HistoryEntryContract = z.infer<typeof historyEntrySchema>;
