import { auditoriaFalsa, comTransacao } from '../../test/auditoria-teste';
import { CHAVE_TESTE, idempotenciaFalsa } from '../../test/idempotencia-teste';
import { ESCOPO_ADMIN } from '../../test/escopos-teste';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SituacaoFoto } from '@prisma/client';
import { FotosService } from './fotos.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

function criarPrismaFalso() {
  return {
    foto: {
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    remocaoArquivo: { findFirst: jest.fn().mockResolvedValue(null) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  } as unknown as PrismaService;
}

function criarStorageFalso() {
  return {
    criarUrlEnvio: jest.fn(),
    obterMetadados: jest.fn(),
    removerArquivo: jest.fn(),
  } as unknown as SupabaseStorageService;
}

describe('FotosService', () => {
  it('solicita a URL de envio e registra a foto como pendente', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (storage.criarUrlEnvio as jest.Mock).mockResolvedValue({
      urlEnvio: 'https://exemplo.invalid/envio',
    });
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    const resposta = await service.solicitarEnvio(
      {
        id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        tipoMidia: 'image/jpeg',
        tamanhoBytes: 1000,
      },
      ESCOPO_ADMIN,
      CHAVE_TESTE,
    );

    expect(resposta.urlEnvio).toBe('https://exemplo.invalid/envio');
    expect(prisma.foto.create).toHaveBeenCalledTimes(1);
    const prazo = Date.parse(resposta.expiraEm) - Date.now();
    expect(prazo).toBeGreaterThan(119 * 60 * 1000);
    expect(prazo).toBeLessThanOrEqual(120 * 60 * 1000);
  });

  it('rejeita confirmação de foto inexistente com 404', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    await expect(
      service.confirmar('id-inexistente', ESCOPO_ADMIN, CHAVE_TESTE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejeita confirmação quando o arquivo ainda não chegou ao armazenamento', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
      expiraEm: new Date(Date.now() + 120 * 60 * 1000),
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue(null);
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    await expect(service.confirmar('f1', ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('confirma a foto quando o arquivo já está no armazenamento', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
      expiraEm: new Date(Date.now() + 120 * 60 * 1000),
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue({
      tamanhoBytes: 1000,
      tipoMidia: 'image/jpeg',
    });
    (prisma.foto.update as jest.Mock).mockResolvedValue({});
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    const resposta = await service.confirmar('f1', ESCOPO_ADMIN, CHAVE_TESTE);

    expect(resposta.situacao).toBe(SituacaoFoto.CONFIRMADA);
  });

  it('reenvio idempotente: confirmar uma foto já confirmada não chama o storage de novo', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.CONFIRMADA,
      caminhoArmazenamento: 'admissao/f1.jpg',
      expiraEm: new Date('2020-01-01'),
    });
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    const resposta = await service.confirmar('f1', ESCOPO_ADMIN, CHAVE_TESTE);

    expect(resposta.situacao).toBe(SituacaoFoto.CONFIRMADA);
    expect(storage.obterMetadados).not.toHaveBeenCalled();
  });

  it('não permite reescrever uma foto já confirmada (evita ficha apontando para arquivo inexistente)', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.CONFIRMADA,
    });
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    await expect(
      service.solicitarEnvio(
        {
          id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
          tipoMidia: 'image/png',
          tamanhoBytes: 1000,
        },
        ESCOPO_ADMIN,
        CHAVE_TESTE,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.criarUrlEnvio).not.toHaveBeenCalled();
    expect(prisma.foto.create).not.toHaveBeenCalled();
  });

  it('rejeita arquivo maior que o limite sem excluí-lo fora da manutenção transacional', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
      expiraEm: new Date(Date.now() + 120 * 60 * 1000),
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue({
      tamanhoBytes: 20 * 1024 * 1024,
      tipoMidia: 'image/jpeg',
    });
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    await expect(service.confirmar('f1', ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.removerArquivo).not.toHaveBeenCalled();
    expect(prisma.foto.update).not.toHaveBeenCalled();
  });

  it('rejeita arquivo cujo tipo real difere do declarado', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
      expiraEm: new Date(Date.now() + 120 * 60 * 1000),
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue({
      tamanhoBytes: 1000,
      tipoMidia: 'application/pdf',
    });
    const service = new FotosService(
      comTransacao(prisma),
      storage,
      idempotenciaFalsa(prisma),
      auditoriaFalsa(),
    );

    await expect(service.confirmar('f1', ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.removerArquivo).not.toHaveBeenCalled();
    expect(prisma.foto.update).not.toHaveBeenCalled();
  });

  it('não confirma foto pendente expirada nem consulta ou remove o arquivo', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
      expiraEm: new Date('2020-01-01'),
    });
    const idempotencia = idempotenciaFalsa(prisma);
    const service = new FotosService(comTransacao(prisma), storage, idempotencia, auditoriaFalsa());
    await expect(service.confirmar('f1', ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toThrow(
      'Prazo de envio expirado',
    );
    expect(storage.obterMetadados).not.toHaveBeenCalled();
    expect(storage.removerArquivo).not.toHaveBeenCalled();
    expect(idempotencia.executar).not.toHaveBeenCalled();
    expect(prisma.foto.update).not.toHaveBeenCalled();
  });
});
