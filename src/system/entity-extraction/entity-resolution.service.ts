import { Injectable } from '@nestjs/common';
import type {
  ConfirmedEntityLike,
  ExtractionCandidate,
  ProposalDataLike,
  PendingProposalLike,
} from './entity-extraction.types';

const TRIGRAM_THRESHOLD = 0.82;
const EMBEDDING_THRESHOLD = 0.88;

interface ResolvedCandidate {
  candidate: ExtractionCandidate;
  confirmedEntityId: string | null;
  proposalId: string | null;
  shouldCreateProposal: boolean;
}

@Injectable()
export class EntityResolutionService {
  normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  dedupeCandidates(candidates: ExtractionCandidate[]): ExtractionCandidate[] {
    const merged = new Map<string, ExtractionCandidate>();

    for (const candidate of candidates) {
      const normalizedName = this.normalize(candidate.canonicalName);
      if (!normalizedName) {
        continue;
      }

      const current = merged.get(normalizedName);
      if (!current) {
        merged.set(normalizedName, {
          ...candidate,
          aliases: [...new Set(candidate.aliases ?? [])],
          evidence: [...new Set(candidate.evidence ?? [])],
          normalizedName,
        });
        continue;
      }

      merged.set(normalizedName, {
        ...current,
        aliases: [
          ...new Set([...current.aliases, ...(candidate.aliases ?? [])]),
        ],
        description: current.description ?? candidate.description,
        confidenceScore: Math.max(
          current.confidenceScore ?? 0,
          candidate.confidenceScore ?? 0,
        ),
        evidence: [
          ...new Set([...current.evidence, ...(candidate.evidence ?? [])]),
        ],
      });
    }

    return [...merged.values()];
  }

  resolveCandidate(
    candidate: ExtractionCandidate,
    confirmedEntities: ConfirmedEntityLike[],
    pendingProposals: PendingProposalLike[],
    compareEmbedding: (text: string) => Promise<number[] | null>,
  ): Promise<ResolvedCandidate> {
    return this.resolveCandidateInternal(
      candidate,
      confirmedEntities,
      pendingProposals,
      compareEmbedding,
    );
  }

  mergeProposalData(
    current: ProposalDataLike,
    candidate: ExtractionCandidate,
    chunk?: {
      chunkId: string;
      chunkHash: string;
      chunkIndex: number;
    },
  ): ProposalDataLike {
    const aliases = new Set<string>([...current.aliases, ...candidate.aliases]);
    const chunkEvidence = new Map(
      (current.chunkEvidence ?? []).map(
        (entry) => [entry.chunkId, entry] as const,
      ),
    );

    if (chunk) {
      chunkEvidence.set(chunk.chunkId, {
        chunkId: chunk.chunkId,
        chunkHash: chunk.chunkHash,
        chunkIndex: chunk.chunkIndex,
      });
    }

    return {
      ...current,
      canonicalName: current.canonicalName ?? candidate.canonicalName,
      aliases: [...aliases],
      type: current.type ?? candidate.type,
      description: current.description ?? candidate.description,
      attributes: current.attributes ?? candidate.attributes,
      imageUrl: current.imageUrl ?? candidate.imageUrl,
      confidenceScore: Math.max(
        current.confidenceScore ?? 0,
        candidate.confidenceScore ?? 0,
      ),
      evidence: [...new Set([...current.evidence, ...candidate.evidence])],
      normalizedName: current.normalizedName ?? candidate.normalizedName ?? '',
      source: 'entity_extraction',
      sourceChunkId: current.sourceChunkId ?? chunk?.chunkId ?? null,
      sourceChunkHash: current.sourceChunkHash ?? chunk?.chunkHash ?? null,
      chunkEvidence: [...chunkEvidence.values()],
    };
  }

  private async resolveCandidateInternal(
    candidate: ExtractionCandidate,
    confirmedEntities: ConfirmedEntityLike[],
    pendingProposals: PendingProposalLike[],
    compareEmbedding: (text: string) => Promise<number[] | null>,
  ): Promise<ResolvedCandidate> {
    const normalizedCandidate = this.normalize(candidate.canonicalName);
    const candidateAliases = new Set(
      [candidate.canonicalName, ...candidate.aliases]
        .map((alias) => this.normalize(alias))
        .filter(Boolean),
    );

    const confirmedExact = this.findExactEntityMatch(
      normalizedCandidate,
      candidateAliases,
      confirmedEntities,
    );
    if (confirmedExact) {
      return {
        candidate,
        confirmedEntityId: confirmedExact.id,
        proposalId: null,
        shouldCreateProposal: false,
      };
    }

    const proposalExact = this.findPendingProposalMatch(
      normalizedCandidate,
      candidateAliases,
      pendingProposals,
    );
    if (proposalExact) {
      return {
        candidate,
        confirmedEntityId: null,
        proposalId: proposalExact.id,
        shouldCreateProposal: false,
      };
    }

    const trigramEntity = this.findTrigramEntityMatch(
      normalizedCandidate,
      candidateAliases,
      confirmedEntities,
    );
    if (trigramEntity) {
      return {
        candidate,
        confirmedEntityId: trigramEntity.id,
        proposalId: null,
        shouldCreateProposal: false,
      };
    }

    const trigramProposal = this.findTrigramProposalMatch(
      normalizedCandidate,
      candidateAliases,
      pendingProposals,
    );
    if (trigramProposal) {
      return {
        candidate,
        confirmedEntityId: null,
        proposalId: trigramProposal.id,
        shouldCreateProposal: false,
      };
    }

    const candidateEmbedding =
      (await compareEmbedding(candidate.canonicalName)) ?? [];
    if (candidateEmbedding.length > 0) {
      const embeddingEntity = await this.findEmbeddingEntityMatch(
        candidateEmbedding,
        confirmedEntities,
        compareEmbedding,
      );
      if (embeddingEntity) {
        return {
          candidate,
          confirmedEntityId: embeddingEntity.id,
          proposalId: null,
          shouldCreateProposal: false,
        };
      }

      const embeddingProposal = await this.findEmbeddingProposalMatch(
        candidateEmbedding,
        pendingProposals,
        compareEmbedding,
      );
      if (embeddingProposal) {
        return {
          candidate,
          confirmedEntityId: null,
          proposalId: embeddingProposal.id,
          shouldCreateProposal: false,
        };
      }
    }

    return {
      candidate,
      confirmedEntityId: null,
      proposalId: null,
      shouldCreateProposal: true,
    };
  }

  private findExactEntityMatch(
    normalizedCandidate: string,
    candidateAliases: Set<string>,
    entities: ConfirmedEntityLike[],
  ): ConfirmedEntityLike | null {
    return (
      entities.find((entity) => {
        const labels = [entity.canonicalName, ...entity.aliases]
          .map((label) => this.normalize(label))
          .filter(Boolean);
        return labels.some(
          (label) =>
            label === normalizedCandidate || candidateAliases.has(label),
        );
      }) ?? null
    );
  }

  private findPendingProposalMatch(
    normalizedCandidate: string,
    candidateAliases: Set<string>,
    proposals: PendingProposalLike[],
  ): PendingProposalLike | null {
    return (
      proposals.find((proposal) => {
        const data = proposal.proposedData as ProposalDataLike;
        const labels = [data.canonicalName ?? '', ...(data.aliases ?? [])]
          .map((label) => this.normalize(label))
          .filter(Boolean);
        return labels.some(
          (label) =>
            label === normalizedCandidate || candidateAliases.has(label),
        );
      }) ?? null
    );
  }

  private findTrigramEntityMatch(
    normalizedCandidate: string,
    candidateAliases: Set<string>,
    entities: ConfirmedEntityLike[],
  ): ConfirmedEntityLike | null {
    let best: { entity: ConfirmedEntityLike; score: number } | null = null;

    for (const entity of entities) {
      const labels = [entity.canonicalName, ...entity.aliases]
        .map((label) => this.normalize(label))
        .filter(Boolean);

      for (const label of labels) {
        const score = this.trigramSimilarity(normalizedCandidate, label);
        if (score >= TRIGRAM_THRESHOLD && (!best || score > best.score)) {
          best = { entity, score };
        }

        for (const alias of candidateAliases) {
          const aliasScore = this.trigramSimilarity(alias, label);
          if (
            aliasScore >= TRIGRAM_THRESHOLD &&
            (!best || aliasScore > best.score)
          ) {
            best = { entity, score: aliasScore };
          }
        }
      }
    }

    return best?.entity ?? null;
  }

  private findTrigramProposalMatch(
    normalizedCandidate: string,
    candidateAliases: Set<string>,
    proposals: PendingProposalLike[],
  ): PendingProposalLike | null {
    let best: { proposal: PendingProposalLike; score: number } | null = null;

    for (const proposal of proposals) {
      const data = proposal.proposedData as ProposalDataLike;
      const labels = [data.canonicalName ?? '', ...(data.aliases ?? [])]
        .map((label) => this.normalize(label))
        .filter(Boolean);

      for (const label of labels) {
        const score = this.trigramSimilarity(normalizedCandidate, label);
        if (score >= TRIGRAM_THRESHOLD && (!best || score > best.score)) {
          best = { proposal, score };
        }

        for (const alias of candidateAliases) {
          const aliasScore = this.trigramSimilarity(alias, label);
          if (
            aliasScore >= TRIGRAM_THRESHOLD &&
            (!best || aliasScore > best.score)
          ) {
            best = { proposal, score: aliasScore };
          }
        }
      }
    }

    return best?.proposal ?? null;
  }

  private async findEmbeddingEntityMatch(
    candidateEmbedding: number[],
    entities: ConfirmedEntityLike[],
    compareEmbedding: (text: string) => Promise<number[] | null>,
  ): Promise<ConfirmedEntityLike | null> {
    let best: { entity: ConfirmedEntityLike; score: number } | null = null;

    for (const entity of entities) {
      const embedding = (await compareEmbedding(entity.canonicalName)) ?? [];
      if (!embedding.length) {
        continue;
      }

      const score = this.cosineSimilarity(candidateEmbedding, embedding);
      if (score >= EMBEDDING_THRESHOLD && (!best || score > best.score)) {
        best = { entity, score };
      }
    }

    return best?.entity ?? null;
  }

  private async findEmbeddingProposalMatch(
    candidateEmbedding: number[],
    proposals: PendingProposalLike[],
    compareEmbedding: (text: string) => Promise<number[] | null>,
  ): Promise<PendingProposalLike | null> {
    let best: { proposal: PendingProposalLike; score: number } | null = null;

    for (const proposal of proposals) {
      const data = proposal.proposedData as ProposalDataLike;
      const embedding =
        (await compareEmbedding(data.canonicalName ?? '')) ?? [];
      if (!embedding.length) {
        continue;
      }

      const score = this.cosineSimilarity(candidateEmbedding, embedding);
      if (score >= EMBEDDING_THRESHOLD && (!best || score > best.score)) {
        best = { proposal, score };
      }
    }

    return best?.proposal ?? null;
  }

  private trigramSimilarity(a: string, b: string): number {
    if (!a || !b) {
      return 0;
    }
    if (a === b) {
      return 1;
    }

    const grams = (value: string): Set<string> => {
      const normalized = `  ${value} `;
      const result = new Set<string>();
      for (let index = 0; index < normalized.length - 2; index += 1) {
        result.add(normalized.slice(index, index + 3));
      }
      return result;
    };

    const gramsA = grams(a);
    const gramsB = grams(b);
    let intersection = 0;

    for (const gram of gramsA) {
      if (gramsB.has(gram)) {
        intersection += 1;
      }
    }

    return (2 * intersection) / (gramsA.size + gramsB.size);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);
    if (length === 0) {
      return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let index = 0; index < length; index += 1) {
      const left = a[index] ?? 0;
      const right = b[index] ?? 0;
      dot += left * right;
      normA += left * left;
      normB += right * right;
    }

    if (!normA || !normB) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
