import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Publica } from '../auth/decoradores';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Publica()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: só indica que o processo responde. Usado pelo health check do Render. */
  @Get()
  @ApiOperation({ summary: 'Verifica a disponibilidade da API' })
  @ApiOkResponse({ schema: { example: { status: 'ok', timestamp: '2026-09-13T00:00:00.000Z' } } })
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness: confirma também a conexão com o banco (smoke test pós-deploy e monitoramento). */
  @Get('ready')
  @ApiOperation({ summary: 'Verifica a API e a conexão com o banco de dados' })
  @ApiOkResponse({
    schema: { example: { status: 'ok', banco: 'ok', timestamp: '2026-10-06T00:00:00.000Z' } },
  })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível');
    }
    return { status: 'ok', banco: 'ok', timestamp: new Date().toISOString() };
  }
}
