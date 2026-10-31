import "dotenv/config";
import { z } from "zod";
export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().default(3000),
    CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
    JWT_SECRET: z
      .string()
      .min(32)
      .refine((v) => !v.startsWith("REEMPLAZAR"), "Configura JWT_SECRET"),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  .parse(process.env);
