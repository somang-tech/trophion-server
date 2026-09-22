import { PrismaClient } from '@prisma/client';

// 개발 중 --watch로 재시작될 때 커넥션이 계속 늘어나는 걸 막기 위한 흔한 싱글턴 패턴.
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
