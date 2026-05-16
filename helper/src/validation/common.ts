import { z } from 'zod';
import { ACCOUNT_STATUSES, PROVIDER_IDS } from '../domain/index.js';

export const schemaVersionSchema = z.literal('1');
export const providerIdSchema = z.enum(PROVIDER_IDS);
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
export const usedPercentageSchema = z.number().min(0).max(100).nullable();
export const unknownRecordSchema = z.record(z.string(), z.unknown());
