import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
// Prisma 7 utiliza el adaptador de PostgreSQL. Reutilizar conexiones en desarrollo.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
 adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});
if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
