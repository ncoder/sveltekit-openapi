import { z } from 'zod';

export const CreateUserBodySchema = z.object({
  name: z.string().min(1),
}).openapi('CreateUserBodySchema');

export const UserApiSchema = z.object({
  id: z.number().int(),
  name: z.string(),
}).openapi('UserApiSchema');

export const UserResponseSchema = z.object({
  data: UserApiSchema,
}).openapi('UserResponseSchema');
