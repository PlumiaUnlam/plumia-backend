import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { type User } from '@prisma/client';
import { UserService } from '../user/user.service';
import { FirebaseAdminService } from './firebase-admin.service';

/**
 * Contrato con el frontend (`services/api.service.ts`): marca que la fila quedó
 * como tombstone por una baja de cuenta aunque el token de Firebase que entró
 * sigue siendo válido. El frontend lo traduce a "Tu cuenta ya fue eliminada."
 * para que quien volvió a intentar entrar no se pelee con un error de sesión
 * genérico.
 */
export const ACCOUNT_DELETED_MESSAGE = 'Account deleted';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  async login(
    idToken: string,
    profile?: { firstName?: string; lastName?: string; username?: string },
  ): Promise<User> {
    let decoded;
    try {
      decoded = await this.firebaseAdmin.verifyToken(idToken);
    } catch (error) {
      const code = firebaseErrorCode(error);
      this.logger.warn(`Firebase ID token rejected${code ? ` (${code})` : ''}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.validateFirebaseUser(decoded, profile);
  }

  async validateFirebaseUser(
    firebaseUser: {
      uid: string;
      email?: string;
      name?: string;
      picture?: string | null;
    },
    profile?: { firstName?: string; lastName?: string; username?: string },
  ): Promise<User> {
    const existing = await this.userService.findById(firebaseUser.uid);
    if (existing) {
      this.assertNotDeletedForLogin(existing);
      return this.backfillExistingUser(existing, firebaseUser.name, profile);
    }

    if (firebaseUser.email) {
      const existingByEmail = await this.userService.findByEmail(
        firebaseUser.email,
      );
      if (existingByEmail) {
        this.assertNotDeletedForLogin(existingByEmail);
        return this.backfillExistingUser(
          existingByEmail,
          firebaseUser.name,
          profile,
        );
      }
    }

    return this.userService.createFromFirebase({
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? '',
      name: profile?.firstName ?? firebaseUser.name ?? '',
      lastname: profile?.lastName ?? '',
      displayName: profile?.username ?? firebaseUser.name ?? null,
      avatarUrl: firebaseUser.picture ?? null,
    });
  }

  /**
   * Solo completa campos vacíos: name/lastname únicamente si el request trae
   * perfil, porque en un sign-in normal el claim `name` de Firebase es el
   * nombre de usuario y escribirlo en `name` dejaría un valor basura que ya
   * nunca se corregiría. displayName sí puede usar ese claim como fallback.
   */
  private async backfillExistingUser(
    existing: User,
    firebaseName: string | undefined,
    profile?: { firstName?: string; lastName?: string; username?: string },
  ): Promise<User> {
    const patch: {
      name?: string;
      lastname?: string;
      displayName?: string;
    } = {};

    if (existing.name === '' && profile?.firstName) {
      patch.name = profile.firstName;
    }

    if (existing.lastname === '' && profile?.lastName) {
      patch.lastname = profile.lastName;
    }

    if (existing.displayName === null) {
      const displayName = profile?.username ?? firebaseName;
      if (displayName) {
        patch.displayName = displayName;
      }
    }

    if (Object.keys(patch).length === 0) {
      return existing;
    }

    return this.userService.backfillFromFirebase(existing.id, patch);
  }

  async resolveExistingUserId(firebaseUser: {
    uid: string;
    email?: string;
  }): Promise<string> {
    const existing = await this.userService.findById(firebaseUser.uid);
    if (existing) {
      this.assertNotDeleted(existing);
      return existing.id;
    }

    if (firebaseUser.email) {
      const existingByEmail = await this.userService.findByEmail(
        firebaseUser.email,
      );
      if (existingByEmail) {
        this.assertNotDeleted(existingByEmail);
        return existingByEmail.id;
      }
    }

    return firebaseUser.uid;
  }

  /**
   * Una cuenta suprimida (Ley 25.326, art. 16) queda como tombstone con
   * `deletedAt`. Se responde igual que un token inválido para no delatar que
   * el correo alguna vez existió acá.
   */
  private assertNotDeleted(user: User): void {
    if (user.deletedAt) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * El mismo bloqueo, pero en el camino de login: es el único punto donde quien
   * llega ya demostró tener un ID token de Firebase vigente para esa cuenta
   * (sin eso la rama no se alcanza), así que avisarle que su cuenta fue
   * eliminada no le enseña nada que no pueda comprobar por su cuenta. Y hace
   * falta: es lo que distingue "volvió a intentar entrar después de la baja"
   * de un error genérico de sesión.
   *
   * Solo acá. `resolveExistingUserId` sigue devolviendo 401, porque en una ruta
   * protegida lo único que importa es que la sesión no vale.
   */
  private assertNotDeletedForLogin(user: User): void {
    if (user.deletedAt) {
      throw new ForbiddenException(ACCOUNT_DELETED_MESSAGE);
    }
  }
}

function firebaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
