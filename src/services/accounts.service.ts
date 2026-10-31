import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./prisma.service.js";
import { AppError } from "../utils/AppError.js";

const accountSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z
    .string()
    .min(12)
    .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Máximo 72 bytes UTF-8"),
});
export async function createAccount(input: unknown) {
  const data = accountSchema.parse(input);
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 12),
    },
    select: { id: true, name: true, email: true, active: true },
  });
}
export async function deactivateAccount(email: string) {
  const normalized = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .parse(email);
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) throw new AppError(404, "NOT_FOUND", "No existe esa cuenta");
  return prisma.user.update({
    where: { id: user.id },
    data: { active: false },
    select: { email: true, active: true },
  });
}
