import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';

describe('SourcesController', () => {
  let controller: SourcesController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      create: vi
        .fn()
        .mockResolvedValue({ id: 'src-1', name: 'web-1', apiKey: 'sa_x' }),
      findAll: vi.fn().mockResolvedValue([{ id: 'src-1', name: 'web-1' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SourcesController],
      providers: [{ provide: SourcesService, useValue: service }],
    }).compile();

    controller = module.get(SourcesController);
  });

  it('POST /sources creates a source and returns its API key', async () => {
    await expect(controller.create({ name: 'web-1' })).resolves.toMatchObject({
      apiKey: 'sa_x',
    });
    expect(service.create).toHaveBeenCalledWith({ name: 'web-1' });
  });

  it('GET /sources lists sources', async () => {
    await expect(controller.findAll()).resolves.toHaveLength(1);
  });

  it('is admin only for every route', () => {
    expect(new Reflector().get(ROLES_KEY, SourcesController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
