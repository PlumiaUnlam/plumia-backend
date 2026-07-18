import { EntityType } from '../../../src/knowledge/domain/entity-type';
import { EntityResolutionService } from '../../../src/system/entity-extraction/entity-resolution.service';
import type {
  ConfirmedEntityLike,
  ExtractionCandidate,
  PendingProposalLike,
  ProposalDataLike,
} from '../../../src/system/entity-extraction/entity-extraction.types';

describe('EntityResolutionService', () => {
  let service: EntityResolutionService;

  beforeEach(() => {
    service = new EntityResolutionService();
  });

  it('normalizes names and dedupes candidates by canonical form', () => {
    const result = service.dedupeCandidates([
      {
        canonicalName: '\u00c1na',
        aliases: ['Ani'],
        type: EntityType.CHARACTER,
        description: null,
        attributes: {},
        imageUrl: null,
        confidenceScore: 0.6,
        evidence: ['first mention'],
      },
      {
        canonicalName: 'Ana',
        aliases: ['Nia'],
        type: EntityType.CHARACTER,
        description: 'Lead',
        attributes: {},
        imageUrl: null,
        confidenceScore: 0.9,
        evidence: ['second mention'],
      },
    ]);

    expect(service.normalize('\u00c1na Del R\u00edo')).toBe('ana del rio');
    expect(result).toEqual([
      {
        canonicalName: '\u00c1na',
        aliases: ['Ani', 'Nia'],
        type: EntityType.CHARACTER,
        description: 'Lead',
        attributes: {},
        imageUrl: null,
        confidenceScore: 0.9,
        evidence: ['first mention', 'second mention'],
        normalizedName: 'ana',
      },
    ]);
  });

  it('merges proposal data while keeping chunk evidence', () => {
    const current: ProposalDataLike = {
      canonicalName: 'Ana',
      aliases: ['A'],
      type: EntityType.CHARACTER,
      description: null,
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.4,
      evidence: ['old'],
      normalizedName: 'ana',
      sourceChunkId: 'chunk-1',
      sourceChunkHash: 'hash-1',
      chunkEvidence: [
        {
          chunkId: 'chunk-1',
          chunkHash: 'hash-1',
          chunkIndex: 0,
        },
      ],
      source: 'entity_extraction',
    };
    const candidate: ExtractionCandidate = {
      canonicalName: 'Ana',
      aliases: ['Anita'],
      type: EntityType.CHARACTER,
      description: 'Hero',
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.8,
      evidence: ['new'],
      normalizedName: 'ana',
    };

    const result = service.mergeProposalData(current, candidate, {
      chunkId: 'chunk-2',
      chunkHash: 'hash-2',
      chunkIndex: 1,
    });

    expect(result.aliases).toEqual(['A', 'Anita']);
    expect(result.confidenceScore).toBe(0.8);
    expect(result.chunkEvidence).toEqual([
      { chunkId: 'chunk-1', chunkHash: 'hash-1', chunkIndex: 0 },
      { chunkId: 'chunk-2', chunkHash: 'hash-2', chunkIndex: 1 },
    ]);
    expect(result.sourceChunkId).toBe('chunk-1');
  });

  it('resolves against confirmed entities before creating proposals', async () => {
    const candidate = buildCandidate('Sir Rowan', ['Rowan']);
    const confirmedEntities: ConfirmedEntityLike[] = [
      {
        id: 'entity-1',
        canonicalName: 'Sir Rowan',
        aliases: ['Rowan'],
        type: EntityType.CHARACTER,
        description: null,
      },
    ];

    const result = await service.resolveCandidate(
      candidate,
      confirmedEntities,
      [],
      () => Promise.resolve(null),
    );

    expect(result).toEqual({
      candidate,
      confirmedEntityId: 'entity-1',
      proposalId: null,
      shouldCreateProposal: false,
    });
  });

  it('resolves against pending proposals before creating a new one', async () => {
    const candidate = buildCandidate('Old Harbor', []);
    const proposals: PendingProposalLike[] = [
      {
        id: 'proposal-1',
        confidenceScore: 0.5,
        proposedData: {
          canonicalName: 'Old Harbor',
          aliases: ['Harbor'],
          type: EntityType.LOCATION,
          description: null,
          attributes: {},
          imageUrl: null,
          confidenceScore: 0.5,
          evidence: [],
          normalizedName: 'old harbor',
        } satisfies ProposalDataLike,
      },
    ];

    const result = await service.resolveCandidate(
      candidate,
      [],
      proposals,
      () => Promise.resolve(null),
    );

    expect(result.proposalId).toBe('proposal-1');
    expect(result.shouldCreateProposal).toBe(false);
  });

  it('uses embedding similarity when no exact or trigram match exists', async () => {
    const candidate = buildCandidate('The Crimson Keep', []);
    const confirmedEntities: ConfirmedEntityLike[] = [
      {
        id: 'entity-2',
        canonicalName: 'Crimson Fortress',
        aliases: [],
        type: EntityType.LOCATION,
        description: null,
      },
    ];

    const result = await service.resolveCandidate(
      candidate,
      confirmedEntities,
      [],
      (text) => {
        if (text === 'The Crimson Keep') {
          return Promise.resolve([1, 0]);
        }
        if (text === 'Crimson Fortress') {
          return Promise.resolve([0.95, 0.05]);
        }
        return Promise.resolve(null);
      },
    );

    expect(result.confirmedEntityId).toBe('entity-2');
    expect(result.shouldCreateProposal).toBe(false);
  });

  it('requests proposal creation when no strategy matches', async () => {
    const candidate = buildCandidate('Unknown Relic', ['Relic']);

    const result = await service.resolveCandidate(candidate, [], [], () =>
      Promise.resolve([]),
    );

    expect(result).toEqual({
      candidate,
      confirmedEntityId: null,
      proposalId: null,
      shouldCreateProposal: true,
    });
  });
});

function buildCandidate(
  canonicalName: string,
  aliases: string[],
): ExtractionCandidate {
  return {
    canonicalName,
    aliases,
    type: EntityType.CHARACTER,
    description: null,
    attributes: {},
    imageUrl: null,
    confidenceScore: 0.7,
    evidence: ['evidence'],
  };
}
