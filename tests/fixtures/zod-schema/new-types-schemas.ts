import { z } from 'zod';

// z.iso.date(), z.iso.time(), z.iso.datetime()
export const eventSchema = z.object({
  title: z.string(),
  event_date: z.iso.date(),
  start_time: z.iso.time(),
  created_at: z.iso.datetime(),
  optional_date: z.iso.date().optional(),
  nullable_date: z.iso.date().nullable().optional(),
}).openapi('Event');

// z.email() standalone (Zod v4)
export const contactSchema = z.object({
  email: z.email(),
  backup_email: z.email().optional(),
}).openapi('Contact');

// z.record() with typed values
export const dictionarySchema = z.object({
  labels: z.record(z.string(), z.string()),
  scores: z.record(z.string(), z.number()),
  flags: z.record(z.string(), z.boolean()),
}).openapi('Dictionary');

// z.string().regex()
export const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).openapi('TimeRange');
