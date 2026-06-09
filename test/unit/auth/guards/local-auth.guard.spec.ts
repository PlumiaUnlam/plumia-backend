import { Test, type TestingModule } from '@nestjs/testing';
import { LocalAuthGuard } from '../../../../src/auth/guards/local-auth.guard';

describe('LocalAuthGuard', () => {
  let guard: LocalAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LocalAuthGuard],
    }).compile();

    guard = module.get(LocalAuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });
});
