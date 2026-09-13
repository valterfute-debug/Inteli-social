// Valores exclusivos dos testes; ignora o arquivo local e não acessa banco.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://teste:teste@127.0.0.1:1/isolado';
process.env.DIRECT_URL = process.env.DATABASE_URL;
