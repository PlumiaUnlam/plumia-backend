export const rec = (key: string, order: string[]): jest.Mock =>
  jest.fn(() => {
    order.push(key);
    return Promise.resolve({ count: 0 });
  });

export interface PrismaMock {
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

export function buildPrisma(order: string[]): PrismaMock {
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
