import { z } from 'zod';
import {
  isoDateTimeSchema,
  providerIdSchema,
  schemaVersionSchema,
  unknownRecordSchema
} from './common.js';

export const tokenRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    accountId: z.string(),
    provider: providerIdSchema,
    email: z.string(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    tokenType: z.string(),
    tokenPayload: unknownRecordSchema
  })
  .strict();

export const tokenFileSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    tokens: z.array(tokenRecordSchema)
  })
  .strict();

export type TokenRecordContract = z.infer<typeof tokenRecordSchema>;
export type TokenFileContract = z.infer<typeof tokenFileSchema>;
