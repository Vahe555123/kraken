import { PrismaClient } from '@prisma/client';

// Single shared Prisma client for the whole process.
export const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

export async function disconnectDb() {
  await prisma.$disconnect().catch(() => undefined);
}
