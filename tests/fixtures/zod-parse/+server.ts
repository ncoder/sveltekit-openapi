import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CreateUserBodySchema, UserResponseSchema } from '../zod-schema/response-schemas';

export const POST: RequestHandler = async ({ request }) => {
  const body = CreateUserBodySchema.parse(await request.json());

  return json(
    UserResponseSchema.parse({ data: { id: 1, name: body.name } }),
    { status: 201 },
  );
};
