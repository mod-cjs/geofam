import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

// Global : le PrismaService est injectable partout sans re-import.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
