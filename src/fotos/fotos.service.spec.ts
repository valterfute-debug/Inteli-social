import { ConflictException, NotFoundException } from '@nestjs/common';
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
    arquivoExiste: jest.fn(),
  } as unknown as SupabaseStorageService;
}

describe('FotosService', () => {
  it('solicita a URL de envio e registra a foto como pendente', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (storage.criarUrlEnvio as jest.Mock).mockResolvedValue({ urlEnvio: 'https://exemplo.invalid/envio' });
    (prisma.foto.upsert as jest.Mock).mockResolvedValue({});
    const service = new FotosService(prisma, storage);

    const resposta = await service.solicitarEnvio({
      id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
      tipoMidia: 'image/jpeg',
      tamanhoBytes: 1000,
    });

    expect(resposta.urlEnvio).toBe('https://exemplo.invalid/envio');
    expect(prisma.foto.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejeita confirmação de foto inexistente com 404', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new FotosService(prisma, storage);

    await expect(service.confirmar('id-inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejeita confirmação quando o arquivo ainda não chegou ao armazenamento', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      caminhoArmazenamento: 'admissao/f1.jpg',
    });
    (storage.arquivoExiste as jest.Mock).mockResolvedValue(false);
    const service = new FotosService(prisma, storage);

    await expect(service.confirmar('f1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirma a foto quando o arquivo já está no armazenamento', async () => {
    const prisma = criarPrismaFalso();
    const storage = criarStorageFalso();
    (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
      id: 'f1',
      situacao: SituacaoFoto.PENDENTE,
      caminhoArmazenamento: 'admissao/f1.jpg',
    });
    (storage.arquivoExiste as jest.Mock).mockResolvedValue(true);
    (prisma.foto.update as jest.Mock).mockResolvedValue({});
    const service = new FotosService(prisma, storage);

    const resposta = await service.confirmar('f1');

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

    const resposta = await service.confirmar('f1');

    expect(resposta.situacao).toBe(SituacaoFoto.CONFIRMADA);
    expect(storage.arquivoExiste).not.toHaveBeenCalled();
  });
});
