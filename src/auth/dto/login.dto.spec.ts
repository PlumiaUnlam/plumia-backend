import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  const valid = { email: 'test@test.com', password: 'password123' };

  it('should pass with valid data', async () => {
    const dto = plainToInstance(LoginDto, valid);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when email is invalid', async () => {
    const dto = plainToInstance(LoginDto, { ...valid, email: 'not-an-email' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('should fail when password is shorter than 6 characters', async () => {
    const dto = plainToInstance(LoginDto, { ...valid, password: '123' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
