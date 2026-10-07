import { ESCOPO_ADMIN } from '../../test/escopos-teste';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SituacaoFoto } from '@prisma/client';
import { FotosService } from './fotos.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

function criarPrismaFalso() {
  return {
    foto: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
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
    (prisma.foto.upsert as jest.Mock).mockResolvedValue({});
    const service = new FotosService(prisma, storage);

    const resposta = await service.solicitarEnvio(
      {
        id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        tipoMidia: 'image/jpeg',
        tamanhoBytes: 1000,
      },
      ESCOPO_ADMIN,
    );

    expect(resposta.urlEnvio).toBe('https://exemplo.invalid/envio');
    expect(prisma.foto.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejeita confirmação de foto inexistente com 404', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new FotosService(prisma, storage);

    await expect(service.confirmar('id-inexistente', ESCOPO_ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejeita confirmação quando o arquivo ainda não chegou ao armazenamento', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue(null);
    const service = new FotosService(prisma, storage);

    await expect(service.confirmar('f1', ESCOPO_ADMIN)).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirma a foto quando o arquivo já está no armazenamento', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue({
      tamanhoBytes: 1000,
      tipoMidia: 'image/jpeg',
    });
    (prisma.foto.update as jest.Mock).mockResolvedValue({});
    const service = new FotosService(prisma, storage);

    const resposta = await service.confirmar('f1', ESCOPO_ADMIN);

    expect(resposta.situacao).toBe(SituacaoFoto.CONFIRMADA);
  });

  it('reenvio idempotente: confirmar uma foto já confirmada não chama o storage de novo', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.CONFIRMADA,
      caminhoArmazenamento: 'admissao/f1.jpg',
    });
    const service = new FotosService(prisma, storage);

    const resposta = await service.confirmar('f1', ESCOPO_ADMIN);

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
    const service = new FotosService(prisma, storage);

    await expect(
      service.solicitarEnvio(
        {
          id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
          tipoMidia: 'image/png',
          tamanhoBytes: 1000,
        },
        ESCOPO_ADMIN,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.criarUrlEnvio).not.toHaveBeenCalled();
    expect(prisma.foto.upsert).not.toHaveBeenCalled();
  });

  it('rejeita e remove arquivo real maior que o limite, mesmo que o tamanho declarado fosse válido', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      tipoMidia: 'image/jpeg',
      caminhoArmazenamento: 'admissao/f1.jpg',
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue({
      tamanhoBytes: 20 * 1024 * 1024,
      tipoMidia: 'image/jpeg',
    });
    const service = new FotosService(prisma, storage);

    await expect(service.confirmar('f1', ESCOPO_ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.removerArquivo).toHaveBeenCalledWith('admissao/f1.jpg');
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
    });
    (storage.obterMetadados as jest.Mock).mockResolvedValue({
      tamanhoBytes: 1000,
      tipoMidia: 'application/pdf',
    });
    const service = new FotosService(prisma, storage);

    await expect(service.confirmar('f1', ESCOPO_ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });
});
