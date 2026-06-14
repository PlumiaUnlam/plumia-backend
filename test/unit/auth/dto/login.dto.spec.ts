import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from '../../../../src/auth/dto/login.dto';

describe('LoginDto', () => {
  const valid = { idToken: 'firebase-id-token' };

  it('should pass with valid data', async () => {
    const dto = plainToInstance(LoginDto, valid);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when idToken is empty', async () => {
    const dto = plainToInstance(LoginDto, { idToken: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'idToken')).toBe(true);
  });
});
