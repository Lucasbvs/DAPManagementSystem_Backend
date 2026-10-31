import { z } from "zod";
export const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase().trim()),
    password: z.string().min(1).max(72),
    rememberMe: z.boolean().default(false),
  })
  .strict();
