import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  const valid = {
    name: 'John',
    lastname: 'Doe',
    email: 'test@test.com',
    password: 'password123',
  };

  it('should pass with valid data', async () => {
    const dto = plainToInstance(RegisterDto, valid);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when name is empty', async () => {
    const dto = plainToInstance(RegisterDto, { ...valid, name: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('should fail when lastname is empty', async () => {
    const dto = plainToInstance(RegisterDto, { ...valid, lastname: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'lastname')).toBe(true);
  });

  it('should fail when email is invalid', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...valid,
      email: 'not-an-email',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('should fail when password is shorter than 8 characters', async () => {
    const dto = plainToInstance(RegisterDto, { ...valid, password: 'short' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
