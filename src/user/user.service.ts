import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export type UserEntity = User;

export interface CreateFromFirebaseParams {
  uid: string;
  email: string;
  name: string;
  lastname?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface BackfillFromFirebaseParams {
  name?: string;
  lastname?: string;
  displayName?: string;
}

/** Cuántas veces se reintenta la transacción ante un error transitorio. */
export const DELETION_TRANSACTION_ATTEMPTS = 3;

/** Cuántas veces se reintenta el borrado en Firebase ante un error transitorio. */
export const DELETION_FIREBASE_ATTEMPTS = 3;

/**
 * Espera base entre reintentos de Firebase (ms). 500 * intento = 500 ms y
 * 1000 ms, es decir ~1,5 s en total.
 *
 * No es lo mismo que los 100 ms de la transacción: un deadlock de Postgres se
 * resuelve solo en milisegundos, en cambio lo que acá se absorbe es un corte
 * de red. Con los 100 ms los tres intentos caían en ~0,6 s y no llegaban a
 * cubrir siquiera un blip real.
 */
export const FIREBASE_RETRY_BASE_DELAY_MS = 500;

/** Etiqueta que reemplaza al nombre real en contenido que no se puede borrar. */
export const ANONYMIZED_ACTOR = 'Usuario eliminado';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  updateProfile(
    id: string,
    profile: { displayName: string; avatarUrl: string | null },
  ): Promise<UserEntity> {
    return this.prisma.user.update({
      where: { id },
      data: profile,
    });
  }

  createFromFirebase(params: CreateFromFirebaseParams): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        id: params.uid,
        email: params.email,
        name: params.name,
        lastname: params.lastname ?? '',
        displayName: params.displayName ?? null,
        avatarUrl: params.avatarUrl ?? null,
      },
    });
  }

  /**
   * Completa únicamente los campos que están vacíos. Se usa para reparar
   * registros creados por un sign-in que llegó antes que el perfil del registro,
   * sin pisar nunca un valor que el usuario ya haya editado.
   */
  backfillFromFirebase(
    id: string,
    params: BackfillFromFirebaseParams,
  ): Promise<UserEntity> {
    return this.prisma.user.update({
      where: { id },
      data: params,
    });
  }

  /**
   * Supresión total de la cuenta (Ley 25.326, art. 16).
   *
   * `userId` es el id de nuestra fila y `firebaseUid` el uid real del token
   * recién verificado. Casi siempre son el mismo string, pero no siempre:
   * `validateFirebaseUser` cae al fallback por email cuando `findById(uid)` no
   * matchea, así que la fila que se encontró puede pertenecer a otra
   * identidad. Borrar en Firebase con el id de la fila devolvería
   * `auth/user-not-found`, que acá se trata como éxito, y dejaría la identidad
   * viva sin que nadie se entere: el uid tiene que venir del token.
   *
   * Orden y por qué:
   * 1. Recopila lo que hay que leer antes de borrar las filas: las claves de R2
   *    y los `aggregateId` del outbox que apuntan a escenas y jobs propios.
   * 2. Transacción única:
   *    a. Anonimiza el rastro del usuario en contenido que vive en proyectos
   *       de terceros (no se puede borrar sin perjudicar al dueño — art. 16.5).
   *    b. Borra en cascada todo el contenido propio, hoja primero, respetando
   *       los FK `RESTRICT` del esquema.
   *    c. Deja la fila `User` como tombstone anonimizado (regla de casa: nunca
   *       hard-delete) con `deletedAt` seteado y un email sintético, lo que
   *       libera el `@unique` de `email` para el re-registro.
   *    Se reintenta ante un error transitorio; si persiste, no se committeó
   *    nada y la cuenta queda intacta y reintentable.
   * 3. Purga los objetos de R2 asociados (best-effort, nunca lanza).
   * 4. Recién al final destruye la identidad en Firebase.
   *
   * **Nuestra base va siempre antes que Firebase**: es lo que garantiza que
   * jamás exista el estado "Firebase ya no encuentra al usuario pero nuestros
   * datos siguen ahí". El efecto sobre quien recibe el error:
   *  - 500 de la transacción -> no se borró nada en ningún lado. La cuenta sigue
   *    viva, así que dejar al usuario dentro del sistema es correcto y puede
   *    reintentar.
   *  - 502 de Firebase       -> ya se suprimió todo lo nuestro y el usuario
   *    queda 401 en todo. Le decimos que su cuenta fue eliminada y se le cierra
   *    la sesión; el uid queda en el log por si hay que sacar la identidad de
   *    la consola de Firebase a mano.
   *
   * Es idempotente: `auth/user-not-found` se trata como éxito y tanto la
   * anonimización como el `deleteMany` son no-ops la segunda vez, así que un
   * reintento después de un fallo parcial termina el trabajo.
   */
  async deleteAccount(userId: string, firebaseUid: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      // El usuario está autenticado, así que esto solo pasa si la fila ya no
      // existe o si es un tombstone de una baja anterior (doble click).
      throw new NotFoundException(
        'No encontramos la cuenta. Puede que ya se haya eliminado.',
      );
    }

    const projects = await this.prisma.project.findMany({
      where: { userId },
      select: { id: true },
    });
    const projectIds = projects.map((project) => project.id);

    const storageKeys = await this.collectStorageKeys(user, projectIds);
    const outboxAggregateIds = await this.collectOutboxAggregateIds(projectIds);

    await this.runDeletionTransaction(user, projectIds, outboxAggregateIds);

    // Va antes de Firebase: si la identidad no se puede destruir, que al menos
    // los objetos ya no sigan apuntando a contenido que ya no existe.
    await this.purgeStorage(storageKeys, userId);

    // Lo último que se toca, y por lo tanto lo único que puede quedar a medias.
    await this.deleteFirebaseUser(firebaseUid);
  }

  /**
   * Recopila las claves de R2 **antes** de borrar las filas que las referencian.
   * `extractKeyFromUrl` tira si la URL no es del bucket (ej. avatar de Google),
   * en ese caso no hay nada que purgar.
   */
  private async collectStorageKeys(
    user: UserEntity,
    projectIds: string[],
  ): Promise<Set<string>> {
    const keys = new Set<string>();

    const addUrl = (url: string | null): void => {
      if (!url) {
        return;
      }
      try {
        keys.add(this.storage.extractKeyFromUrl(url));
      } catch {
        // URL externa: no es un objeto nuestro.
      }
    };

    const inOwnProjects = { projectId: { in: projectIds } };

    const [versions, exportJobs, images, notes, entities] = await Promise.all([
      this.prisma.version.findMany({
        where: inOwnProjects,
        select: { storageKey: true },
      }),
      this.prisma.exportJob.findMany({
        where: inOwnProjects,
        select: { storageKey: true },
      }),
      this.prisma.generatedImage.findMany({
        where: { entity: { projectId: { in: projectIds } } },
        select: { storageKey: true },
      }),
      this.prisma.storyboardNote.findMany({
        where: inOwnProjects,
        select: { audioStorageKey: true },
      }),
      this.prisma.entity.findMany({
        where: inOwnProjects,
        select: { imageUrl: true },
      }),
    ]);

    for (const row of versions) {
      if (row.storageKey) {
        keys.add(row.storageKey);
      }
    }
    for (const row of exportJobs) {
      if (row.storageKey) {
        keys.add(row.storageKey);
      }
    }
    for (const row of images) {
      keys.add(row.storageKey);
    }
    for (const row of notes) {
      if (row.audioStorageKey) {
        keys.add(row.audioStorageKey);
      }
    }
    for (const row of entities) {
      addUrl(row.imageUrl);
    }
    addUrl(user.avatarUrl);

    // Avatares de versiones anteriores: ya no tienen fila que los referencie.
    try {
      const profileKeys = await this.storage.listObjects(
        `profiles/${user.id}/`,
      );
      for (const key of profileKeys) {
        keys.add(key);
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo listar objetos de profiles/${user.id}: ${stringify(error)}`,
      );
    }

    return keys;
  }

  /**
   * Colecta los `aggregateId` del outbox que apuntan a entidades propias, **antes**
   * de que la transacción las borre. `outbox` no tiene FK hacia esas tablas, así
   * que Prisma no puede resolverlo con un subquery: hay que traer los ids.
   *
   * Son exactamente los que escriben los cuatro `outbox.create` del código:
   * Scene, StoryboardNote, ExportJob e ImageGenerationJob.
   *
   * Nunca agregar `user.id`: `aggregateId` es UUID y el uid de Firebase no lo es.
   */
  private async collectOutboxAggregateIds(
    projectIds: string[],
  ): Promise<string[]> {
    const inOwnProjects = { projectId: { in: projectIds } };

    const [scenes, notes, exportJobs, imageJobs] = await Promise.all([
      this.prisma.scene.findMany({
        where: { chapter: { book: { projectId: { in: projectIds } } } },
        select: { id: true },
      }),
      this.prisma.storyboardNote.findMany({
        where: inOwnProjects,
        select: { id: true },
      }),
      this.prisma.exportJob.findMany({
        where: inOwnProjects,
        select: { id: true },
      }),
      // `ImageGenerationJob` no figura en `buildOperations`: lo borra el cascade
      // de `entity` (onDelete: Cascade), así que hay que pedirlo por su entidad.
      this.prisma.imageGenerationJob.findMany({
        where: { entity: { projectId: { in: projectIds } } },
        select: { id: true },
      }),
    ]);

    return [
      ...scenes.map((row) => row.id),
      ...notes.map((row) => row.id),
      ...exportJobs.map((row) => row.id),
      ...imageJobs.map((row) => row.id),
    ];
  }

  private async runDeletionTransaction(
    user: UserEntity,
    projectIds: string[],
    outboxAggregateIds: string[],
  ): Promise<void> {
    const inOwnProjects = { projectId: { in: projectIds } };

    // Se reconstruye en cada intento: un `PrismaPromise` ya evaluado no se
    // reutiliza después de que la transacción falle.
    const buildOperations = (): Prisma.PrismaPromise<unknown>[] => [
      // --- 1. Anonimiza el rastro en proyectos de terceros -------------------
      this.prisma.readerComment.updateMany({
        where: { authorUserId: user.id },
        data: { displayName: ANONYMIZED_ACTOR, authorUserId: null },
      }),
      this.prisma.readerComment.updateMany({
        where: { resolvedById: user.id },
        data: { resolvedById: null },
      }),
      this.prisma.readerCommentReply.updateMany({
        where: { authorId: user.id },
        data: { displayName: ANONYMIZED_ACTOR, authorId: null },
      }),
      this.prisma.readerCommentStatusEvent.updateMany({
        where: { changedById: user.id },
        data: { changedByName: ANONYMIZED_ACTOR, changedById: null },
      }),
      this.prisma.entityProposal.updateMany({
        where: { reviewedById: user.id },
        data: { reviewedById: null },
      }),
      this.prisma.relationshipProposal.updateMany({
        where: { reviewedById: user.id },
        data: { reviewedById: null },
      }),
      this.prisma.auditAlert.updateMany({
        where: { resolvedById: user.id },
        data: { resolvedById: null },
      }),
      this.prisma.shareLink.updateMany({
        where: { createdById: user.id },
        data: { createdById: null },
      }),
      this.prisma.shareLink.updateMany({
        where: { acceptedById: user.id },
        data: { acceptedById: null },
      }),
      ...(user.email
        ? [
            this.prisma.shareLink.updateMany({
              where: { invitedEmail: user.email },
              data: { invitedEmail: null },
            }),
          ]
        : []),

      // --- 2. Contenido propio, hoja primero ---------------------------------
      this.prisma.authorAnnotation.deleteMany({ where: { authorId: user.id } }),
      this.prisma.subscription.deleteMany({ where: { userId: user.id } }),
      // `versionId` es RESTRICT: hay que vaciarlo antes de tocar `version`.
      this.prisma.readerComment.deleteMany({
        where: { shareLink: { projectId: { in: projectIds } } },
      }),
      this.prisma.shareLink.deleteMany({ where: inOwnProjects }),
      this.prisma.relationship.deleteMany({ where: inOwnProjects }),
      this.prisma.entityProposal.deleteMany({ where: inOwnProjects }),
      this.prisma.auditAlert.deleteMany({ where: inOwnProjects }),
      this.prisma.auditFalsePositive.deleteMany({ where: inOwnProjects }),
      this.prisma.tokenLedger.deleteMany({
        where: { OR: [inOwnProjects, { userId: user.id }] },
      }),
      this.prisma.summaryGenerationJob.deleteMany({ where: inOwnProjects }),
      this.prisma.summary.deleteMany({ where: inOwnProjects }),
      this.prisma.exportJob.deleteMany({ where: inOwnProjects }),
      this.prisma.writingSession.deleteMany({ where: inOwnProjects }),
      this.prisma.writingGoal.deleteMany({ where: inOwnProjects }),
      this.prisma.storyboardNote.deleteMany({ where: inOwnProjects }),
      // Cascades `entity_state` (RESTRICT -> scene) y `fact` (RESTRICT -> scene),
      // así que tiene que ir antes de que `book` borre las escenas.
      this.prisma.entity.deleteMany({ where: inOwnProjects }),
      this.prisma.relationshipProposal.deleteMany({ where: inOwnProjects }),
      this.prisma.chunk.deleteMany({ where: inOwnProjects }),
      this.prisma.timelineEvent.deleteMany({ where: inOwnProjects }),
      this.prisma.storyboardArc.deleteMany({ where: inOwnProjects }),
      this.prisma.exportSettings.deleteMany({ where: inOwnProjects }),
      this.prisma.editorTextStyle.deleteMany({ where: inOwnProjects }),
      this.prisma.chatThread.deleteMany({ where: inOwnProjects }),
      this.prisma.version.deleteMany({ where: inOwnProjects }),
      // Cascades chapter -> scene -> scene_version, chunk, author_annotation.
      this.prisma.book.deleteMany({ where: inOwnProjects }),
      this.prisma.project.deleteMany({ where: { userId: user.id } }),
      this.prisma.userApiKey.deleteMany({ where: { userId: user.id } }),
      // Los eventos de outbox de esta cuenta. `outbox` es una tabla suelta, sin
      // FK hacia escenas ni jobs, así que no hay subquery posible: los ids se
      // colectan antes de borrar, en `collectOutboxAggregateIds`.
      //
      // Nunca meter `user.id` acá. `aggregateId` es UUID y el uid de Firebase no
      // lo es (28 chars alfanuméricos); Prisma lo rechaza en el cliente antes de
      // consultar, revuelve toda la transacción, agota los 3 reintentos y
      // devuelve 500 sin haber borrado nada.
      this.prisma.outbox.deleteMany({
        where: { aggregateId: { in: outboxAggregateIds } },
      }),

      // --- 3. Tombstone anonimizado ------------------------------------------
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: tombstoneEmail(user.id),
          name: ANONYMIZED_ACTOR,
          lastname: ANONYMIZED_ACTOR,
          displayName: null,
          avatarUrl: null,
          deletedAt: new Date(),
        },
      }),
    ];

    for (let attempt = 1; attempt <= DELETION_TRANSACTION_ATTEMPTS; attempt++) {
      try {
        await this.prisma.$transaction(buildOperations());
        return;
      } catch (error) {
        this.logger.error(
          `Falló la transacción de borrado de cuenta ${user.id} (intento ${attempt}/${DELETION_TRANSACTION_ATTEMPTS}): ${stringify(error)}`,
        );

        if (attempt === DELETION_TRANSACTION_ATTEMPTS) {
          // No se committeó nada y Firebase todavía no se tocó (se borra al
          // final): la cuenta sigue completa. Dejar al usuario dentro del
          // sistema es correcto, porque así puede reintentar la supresión.
          throw new InternalServerErrorException(
            'No se pudo eliminar la cuenta',
          );
        }

        await sleep(100 * attempt);
      }
    }
  }

  /**
   * Se ejecuta **al final**, después de que toda la supresión de nuestro lado
   * quedó confirmada, y es lo único que puede quedar a medias.
   *
   * Reintenta ante un error transitorio (`DELETION_FIREBASE_ATTEMPTS` con
   * `FIREBASE_RETRY_BASE_DELAY_MS * intento` de espera). `auth/user-not-found`
   * es éxito en cualquier intento: permite reintentar una supresión ya
   * parcialmente hecha sin que el idéntico error dispare un 502.
   *
   * Si se agotan los intentos, el usuario ya no está en la base pero su
   * identidad sigue en Firebase: se responde 502 y el uid queda en el log, que
   * es lo que permite terminar el borrado desde la consola de Firebase a mano.
   * El estado que queda es la única zona permitida a medias y la copia no miente:
   * la cuenta de nuestro lado sí existe como tombstone anonimizado y el usuario
   * recibe 401 en todo.
   */
  private async deleteFirebaseUser(userId: string): Promise<void> {
    for (let attempt = 1; attempt <= DELETION_FIREBASE_ATTEMPTS; attempt++) {
      try {
        await this.firebaseAdmin.deleteUser(userId);
        return;
      } catch (error) {
        if (firebaseErrorCode(error) === 'auth/user-not-found') {
          return;
        }

        this.logger.error(
          `No se pudo borrar el usuario de Firebase ${userId} (intento ${attempt}/${DELETION_FIREBASE_ATTEMPTS}): ${stringify(error)}`,
        );

        if (attempt === DELETION_FIREBASE_ATTEMPTS) {
          throw new BadGatewayException(
            'Tu cuenta fue eliminada. Tu sesión se cerró.',
          );
        }

        await sleep(FIREBASE_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  private async purgeStorage(
    storageKeys: Set<string>,
    userId: string,
  ): Promise<void> {
    for (const key of storageKeys) {
      try {
        await this.storage.deleteObject(key);
      } catch (error) {
        this.logger.warn(
          `No se pudo purgar ${key} (usuario ${userId}): ${stringify(error)}`,
        );
      }
    }
  }
}

function tombstoneEmail(userId: string): string {
  const safeUid = userId.replace(/[^a-zA-Z0-9._-]/g, '');
  return `deleted-${safeUid}@plumia.invalid`;
}

function firebaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function stringify(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
