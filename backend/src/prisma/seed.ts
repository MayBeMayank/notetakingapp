import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  // seed data added by feature tickets
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
