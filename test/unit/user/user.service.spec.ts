import { Test, type TestingModule } from '@nestjs/testing';
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { FirebaseAdminService } from '../../../src/auth/firebase-admin.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { StorageService } from '../../../src/storage/storage.service';
import {
  ANONYMIZED_ACTOR,
  DELETION_FIREBASE_ATTEMPTS,
  DELETION_TRANSACTION_ATTEMPTS,
  UserService,
  type UserEntity,
} from '../../../src/user/user.service';
const rec = (key: string, order: string[]): jest.Mock =>
  jest.fn(() => {
    order.push(key);
    return Promise.resolve({ count: 0 });
  });
interface PrismaMock {
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  project: { findMany: jest.Mock; deleteMany: jest.Mock };
  version: { findMany: jest.Mock; deleteMany: jest.Mock };
  exportJob: { findMany: jest.Mock; deleteMany: jest.Mock };
  generatedImage: { findMany: jest.Mock };
  storyboardNote: { findMany: jest.Mock; deleteMany: jest.Mock };
  entity: { findMany: jest.Mock; deleteMany: jest.Mock };
  scene: { findMany: jest.Mock };
  imageGenerationJob: { findMany: jest.Mock };
  readerComment: { updateMany: jest.Mock; deleteMany: jest.Mock };
  readerCommentReply: { updateMany: jest.Mock };
  readerCommentStatusEvent: { updateMany: jest.Mock };
  entityProposal: { updateMany: jest.Mock; deleteMany: jest.Mock };
  relationshipProposal: { updateMany: jest.Mock; deleteMany: jest.Mock };
  auditAlert: { updateMany: jest.Mock; deleteMany: jest.Mock };
  auditFalsePositive: { deleteMany: jest.Mock };
  shareLink: { updateMany: jest.Mock; deleteMany: jest.Mock };
  authorAnnotation: { deleteMany: jest.Mock };
  subscription: { deleteMany: jest.Mock };
  tokenLedger: { deleteMany: jest.Mock };
  summaryGenerationJob: { deleteMany: jest.Mock };
  summary: { deleteMany: jest.Mock };
  writingSession: { deleteMany: jest.Mock };
  writingGoal: { deleteMany: jest.Mock };
  relationship: { deleteMany: jest.Mock };
  chunk: { deleteMany: jest.Mock };
  timelineEvent: { deleteMany: jest.Mock };
  storyboardArc: { deleteMany: jest.Mock };
  exportSettings: { deleteMany: jest.Mock };
  editorTextStyle: { deleteMany: jest.Mock };
  chatThread: { deleteMany: jest.Mock };
  book: { deleteMany: jest.Mock };
  userApiKey: { deleteMany: jest.Mock };
  outbox: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
}

function buildPrisma(order: string[]): PrismaMock {
  const del = (name: string): jest.Mock => rec(`${name}.deleteMany`, order);
  const updateMany = (name: string): jest.Mock =>
    rec(`${name}.updateMany`, order);

  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: rec('user.update', order),
    },
    project: {
      findMany: jest.fn(),
      deleteMany: rec('project.deleteMany', order),
    },
    version: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: del('version'),
    },
    exportJob: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: del('exportJob'),
    },
    generatedImage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    storyboardNote: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: del('storyboardNote'),
    },
    entity: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: del('entity'),
    },
    scene: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    imageGenerationJob: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    readerComment: {
      updateMany: updateMany('readerComment'),
      deleteMany: del('readerComment'),
    },
    readerCommentReply: { updateMany: updateMany('readerCommentReply') },
    readerCommentStatusEvent: {
      updateMany: updateMany('readerCommentStatusEvent'),
    },
    entityProposal: {
      updateMany: updateMany('entityProposal'),
      deleteMany: del('entityProposal'),
    },
    relationshipProposal: {
      updateMany: updateMany('relationshipProposal'),
      deleteMany: del('relationshipProposal'),
    },
    auditAlert: {
      updateMany: updateMany('auditAlert'),
      deleteMany: del('auditAlert'),
    },
    auditFalsePositive: { deleteMany: del('auditFalsePositive') },
    shareLink: {
      updateMany: updateMany('shareLink'),
      deleteMany: del('shareLink'),
    },
    authorAnnotation: { deleteMany: del('authorAnnotation') },
    subscription: { deleteMany: del('subscription') },
    tokenLedger: { deleteMany: del('tokenLedger') },
    summaryGenerationJob: { deleteMany: del('summaryGenerationJob') },
    summary: { deleteMany: del('summary') },
    writingSession: { deleteMany: del('writingSession') },
    writingGoal: { deleteMany: del('writingGoal') },
    relationship: { deleteMany: del('relationship') },
    chunk: { deleteMany: del('chunk') },
    timelineEvent: { deleteMany: del('timelineEvent') },
    storyboardArc: { deleteMany: del('storyboardArc') },
    exportSettings: { deleteMany: del('exportSettings') },
    editorTextStyle: { deleteMany: del('editorTextStyle') },
    chatThread: { deleteMany: del('chatThread') },
    book: { deleteMany: del('book') },
    userApiKey: { deleteMany: del('userApiKey') },
    outbox: { deleteMany: del('outbox') },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => {
      for (const operation of operations) {
        await operation;
      }
      order.push('$transaction');
      return operations;
    }),
  };
}
describe('UserService', () => {
  let userService: UserService;
  let prisma: PrismaMock;
  let order: string[];
  let storage: {
    extractKeyFromUrl: jest.Mock;
    deleteObject: jest.Mock;
    listObjects: jest.Mock;
  };
  let firebaseAdmin: { deleteUser: jest.Mock };

  const mockUser: UserEntity = {
    id: 'firebase-uid-1',
    name: 'John',
    lastname: 'Doe',
    email: 'test@test.com',
    createdAt: new Date(),
    updatedAt: new Date(),
    displayName: null,
    avatarUrl: null,
    role: 'AUTHOR' as const,
    plan: 'FREE' as const,
    autoAnalyzeOnAutosave: true,
    deletedAt: null,
  };

  const findIndexOf = (key: string): number => {
    const index = order.indexOf(key);
    if (index === -1) {
      throw new Error(
        `La operación ${key} no se registró. Orden: ${order.join(', ')}`,
      );
    }
    return index;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    order = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: buildPrisma(order) },
        {
          provide: StorageService,
          useValue: {
            extractKeyFromUrl: jest.fn((url: string) => {
              const marker = 'bucket/';
              const index = url.indexOf(marker);
              if (index === -1) {
                throw new Error('Could not extract key from image URL');
              }
              return url.slice(index + marker.length);
            }),
            deleteObject: rec('storage.deleteObject', order),
            listObjects: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: FirebaseAdminService,
          useValue: {
            deleteUser: jest.fn(() => {
              order.push('firebase.deleteUser');
              return Promise.resolve(undefined);
            }),
          },
        },
      ],
    }).compile();

    userService = module.get(UserService);
    prisma = module.get(PrismaService);
    storage = module.get(StorageService);
    firebaseAdmin = module.get(FirebaseAdminService);
  });

  describe('findByEmail', () => {
    it('should return the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await userService.findByEmail('test@test.com');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
    });

    it('should return null when no user matches the email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await userService.findByEmail('missing@test.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await userService.findById('firebase-uid-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'firebase-uid-1' },
      });
    });

    it('should return null when no user matches the id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await userService.findById('firebase-uid-999');

      expect(result).toBeNull();
    });
  });

  describe('createFromFirebase', () => {
    it('should create a user from Firebase data', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await userService.createFromFirebase({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
        name: 'John',
        lastname: 'Doe',
        displayName: 'john.doe',
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          id: 'firebase-uid-1',
          email: 'test@test.com',
          name: 'John',
          lastname: 'Doe',
          displayName: 'john.doe',
          avatarUrl: 'https://example.com/avatar.png',
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should default displayName to null when it is not provided', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      await userService.createFromFirebase({
        uid: 'firebase-uid-2',
        email: 'no-display@test.com',
        name: 'Ada',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          id: 'firebase-uid-2',
          email: 'no-display@test.com',
          name: 'Ada',
          lastname: '',
          displayName: null,
          avatarUrl: null,
        },
      });
    });
  });

  describe('updateProfile', () => {
    it('persists the display name and avatar', async () => {
      prisma.user.update.mockResolvedValue(mockUser);

      await userService.updateProfile('firebase-uid-1', {
        displayName: 'Ailen',
        avatarUrl: 'https://cdn.example/avatar.png',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'firebase-uid-1' },
        data: {
          displayName: 'Ailen',
          avatarUrl: 'https://cdn.example/avatar.png',
        },
      });
    });
  });

  describe('deleteAccount', () => {
    const userWithProjects = (): void => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.project.findMany.mockResolvedValue([{ id: 'project-1' }]);
    };

    it('rejects when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(userService.deleteAccount('ghost', 'ghost')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when the account is already tombstoned', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      });

      await expect(
        userService.deleteAccount('firebase-uid-1', 'firebase-uid-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('purges our database first and only then destroys the Firebase identity', async () => {
      userWithProjects();

      // La fila y el uid del token difieren, que es lo que pasa cuando
      // validateFirebaseUser encontró la cuenta por email. Borrar en Firebase
      // tiene que ir con el uid del token, nunca con el id de la fila.
      await userService.deleteAccount('firebase-uid-1', 'firebase-token-uid');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Invariante: nuestra base se suprime SIEMPRE antes que la identidad en
      // Firebase. Así el fallo probable (el de nuestro backend, que es menos
      // robusto que Google) ocurre antes de tocar nada de ningún lado y deja
      // la cuenta intacta; y jamás queda el estado "ya no existe en Firebase
      // pero nuestros datos siguen acá".
      expect(findIndexOf('$transaction')).toBeLessThan(
        findIndexOf('firebase.deleteUser'),
      );

      // El rastro en obras de terceros se anonimiza antes de cualquier borrado.
      expect(prisma.readerComment.updateMany).toHaveBeenCalledWith({
        where: { authorUserId: 'firebase-uid-1' },
        data: { displayName: ANONYMIZED_ACTOR, authorUserId: null },
      });
      expect(prisma.shareLink.updateMany).toHaveBeenCalledWith({
        where: { invitedEmail: 'test@test.com' },
        data: { invitedEmail: null },
      });

      // Orden de borrado: hoja primero y el proyecto recién al final.
      expect(findIndexOf('readerComment.deleteMany')).toBeLessThan(
        findIndexOf('version.deleteMany'),
      );
      expect(findIndexOf('entity.deleteMany')).toBeLessThan(
        findIndexOf('book.deleteMany'),
      );
      expect(findIndexOf('book.deleteMany')).toBeLessThan(
        findIndexOf('project.deleteMany'),
      );
      expect(findIndexOf('project.deleteMany')).toBeLessThan(
        findIndexOf('userApiKey.deleteMany'),
      );
      expect(findIndexOf('userApiKey.deleteMany')).toBeLessThan(
        findIndexOf('user.update'),
      );

      // Todo el contenido propio queda acotado a los proyectos del usuario.
      expect(prisma.relationship.deleteMany).toHaveBeenCalledWith({
        where: { projectId: { in: ['project-1'] } },
      });
      expect(prisma.project.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'firebase-uid-1' },
      });

      // Tombstone anonimizado, sin borrar la fila.
      const updateCalls = prisma.user.update.mock.calls as Array<
        [{ where: { id: string }; data: Record<string, unknown> }]
      >;
      const tombstone = updateCalls.at(-1)?.[0];
      expect(tombstone?.where).toEqual({ id: 'firebase-uid-1' });
      expect(tombstone?.data).toMatchObject({
        email: 'deleted-firebase-uid-1@plumia.invalid',
        name: ANONYMIZED_ACTOR,
        lastname: ANONYMIZED_ACTOR,
        displayName: null,
        avatarUrl: null,
      });
      expect(tombstone?.data['deletedAt']).toBeInstanceOf(Date);

      expect(firebaseAdmin.deleteUser).toHaveBeenCalledWith(
        'firebase-token-uid',
      );
    });

    it('purges outbox events by their real aggregate ids, never by the Firebase uid', async () => {
      userWithProjects();
      const ids = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
      ];
      prisma.scene.findMany.mockResolvedValue([{ id: ids[0] }]);
      prisma.storyboardNote.findMany.mockResolvedValue([{ id: ids[1] }]);
      prisma.exportJob.findMany.mockResolvedValue([{ id: ids[2] }]);
      prisma.imageGenerationJob.findMany.mockResolvedValue([{ id: ids[3] }]);

      await userService.deleteAccount('firebase-uid-1', 'firebase-uid-1');

      // Match exacto: la lista son SOLO los aggregateId reales (UUIDs), nunca el
      // uid de Firebase, que haría fallar la consulta en el cliente sin llegar
      // a la base.
      expect(prisma.outbox.deleteMany).toHaveBeenCalledWith({
        where: { aggregateId: { in: ids } },
      });
      // Las escenas se piden atravesando chapter -> book -> project.
      expect(prisma.scene.findMany).toHaveBeenCalledWith({
        where: { chapter: { book: { projectId: { in: ['project-1'] } } } },
        select: { id: true },
      });
      // Se colecta ANTES de la transacción: después ya estarían borradas.
      const collectedAt =
        prisma.scene.findMany.mock.invocationCallOrder[0] ?? 0;
      const transactedAt = prisma.$transaction.mock.invocationCallOrder[0] ?? 0;
      expect(collectedAt).toBeGreaterThan(0);
      expect(collectedAt).toBeLessThan(transactedAt);
    });

    it('purges R2 objects and ignores external URLs', async () => {
      userWithProjects();
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        avatarUrl: 'https://cdn.example/bucket/profiles/firebase-uid-1/a.png',
      });
      prisma.version.findMany.mockResolvedValue([
        { storageKey: 'scenes/project-1/v1.json' },
      ]);
      prisma.entity.findMany.mockResolvedValue([
        { imageUrl: 'https://lh3.google.com/avatar.png' },
      ]);
      storage.listObjects.mockResolvedValue([
        'profiles/firebase-uid-1/old.png',
      ]);

      await userService.deleteAccount('firebase-uid-1', 'firebase-uid-1');

      expect(storage.deleteObject).toHaveBeenCalledWith(
        'profiles/firebase-uid-1/a.png',
      );
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'scenes/project-1/v1.json',
      );
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'profiles/firebase-uid-1/old.png',
      );
      // La URL externa no genera clave: no debe intentarse purgarla.
      expect(storage.deleteObject).not.toHaveBeenCalledWith(
        expect.stringContaining('lh3.google.com'),
      );
      // La purga de R2 también corre antes de tocar la identidad: si Firebase
      // queda a medias, al menos ya no quedan objetos apuntando a contenido
      // que ya no existe.
      expect(findIndexOf('storage.deleteObject')).toBeLessThan(
        findIndexOf('firebase.deleteUser'),
      );
    });

    it('treats an already-deleted Firebase user as success', async () => {
      userWithProjects();
      firebaseAdmin.deleteUser.mockRejectedValue({
        code: 'auth/user-not-found',
      });

      await expect(
        userService.deleteAccount('firebase-uid-1', 'firebase-uid-1'),
      ).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('purges our side first, retries Firebase and then reports the 502', async () => {
      userWithProjects();
      firebaseAdmin.deleteUser.mockRejectedValue(
        new Error('backend unavailable'),
      );

      const rejection = await userService
        .deleteAccount('firebase-uid-1', 'firebase-uid-1')
        .catch((error: unknown) => error);

      // 502: la supresión de nuestro lado ya quedó confirmada y solo quedó a
      // medias la identidad de Firebase. Ese es el único estado permitido a
      // medias y la copia lo cuenta tal cual.
      expect(rejection).toBeInstanceOf(BadGatewayException);
      expect(rejection).toMatchObject({
        status: 502,
        message: 'Tu cuenta fue eliminada. Tu sesión se cerró.',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);

      // Un corte de red transitorio no debería costarle la baja: se rinden los
      // N intentos antes de responder 502.
      expect(firebaseAdmin.deleteUser).toHaveBeenCalledTimes(
        DELETION_FIREBASE_ATTEMPTS,
      );
    });

    it('does not fail the whole deletion when a storage purge fails', async () => {
      userWithProjects();
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        avatarUrl: 'https://cdn.example/bucket/profiles/firebase-uid-1/a.png',
      });
      storage.deleteObject.mockRejectedValue(new Error('r2 unavailable'));

      await expect(
        userService.deleteAccount('firebase-uid-1', 'firebase-uid-1'),
      ).resolves.toBeUndefined();
      expect(firebaseAdmin.deleteUser).toHaveBeenCalled();
    });

    it('retries the transaction before giving up', async () => {
      userWithProjects();
      prisma.$transaction
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        userService.deleteAccount('firebase-uid-1', 'firebase-uid-1'),
      ).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('fails with 500 when the deletion transaction keeps blowing up', async () => {
      userWithProjects();
      prisma.$transaction.mockRejectedValue(new Error('fk violation'));

      await expect(
        userService.deleteAccount('firebase-uid-1', 'firebase-uid-1'),
      ).rejects.toThrow('No se pudo eliminar la cuenta');
      // No se intentó siquiera: si no se committeó nada de nuestro lado, la
      // identidad en Firebase queda donde estaba y al usuario le queda su
      // cuenta completa para reintentar.
      expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(
        DELETION_TRANSACTION_ATTEMPTS,
      );
    });
  });
});
