import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Publica } from '../auth/decoradores';
import { PrismaService } from '../prisma/prisma.service';
import { SituacaoBucket, SupabaseStorageService } from '../storage/supabase-storage.service';

@ApiTags('Health')
@Publica()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  /** Liveness: só indica que o processo responde. Usado pelo health check do Render. */
  @Get()
  @ApiOperation({ summary: 'Verifica a disponibilidade da API' })
  @ApiOkResponse({ schema: { example: { status: 'ok', timestamp: '2026-09-13T00:00:00.000Z' } } })
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Readiness: confirma o banco e que o bucket de fotos continua privado
   * (smoke test pós-deploy e monitoramento).
   */
  @Get('ready')
  @ApiOperation({ summary: 'Verifica a API, o banco de dados e a privacidade do bucket de fotos' })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        banco: 'ok',
        armazenamento: 'privado',
        timestamp: '2026-10-06T00:00:00.000Z',
      },
    },
  })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível');
    }

    let armazenamento: SituacaoBucket;
    try {
      armazenamento = await this.storage.situacaoBucket();
    } catch {
      throw new ServiceUnavailableException('Armazenamento de fotos indisponível');
    }
    if (armazenamento === 'publico') {
      throw new ServiceUnavailableException(
        'Bucket de fotos está público: fotos acessíveis sem login',
      );
    }

    return { status: 'ok', banco: 'ok', armazenamento, timestamp: new Date().toISOString() };
  }
}
