import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { isStoryboardCardStatus } from '../../domain/storyboard-card-status';

export function IsStoryboardCardStatus(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    const options = validationOptions ?? {};

    registerDecorator({
      name: 'isStoryboardCardStatus',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isStoryboardCardStatus(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be one of: ideas, planned, in-progress, completed`;
        },
      },
    });
  };
}
