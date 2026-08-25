import { ChatEmbeddingIndexService } from '../../../src/chat/chat-embedding-index.service';
import type { EmbeddingProvider } from '../../../src/chat/ports/embedding-provider.port';
import type { StaleChunkStore } from '../../../src/chat/ports/stale-chunk-store.port';
import type { VectorStore } from '../../../src/chat/ports/vector-store.port';

describe('ChatEmbeddingIndexService', () => {
  let staleChunkStore: jest.Mocked<StaleChunkStore>;
  let embeddingProvider: jest.Mocked<EmbeddingProvider>;
  let vectorStore: jest.Mocked<VectorStore>;
  let service: ChatEmbeddingIndexService;

  beforeEach(() => {
    staleChunkStore = { findStaleChunks: jest.fn().mockResolvedValue([]) };
    embeddingProvider = {
      model: 'gemini-embedding-2',
      isConfigured: jest.fn().mockReturnValue(true),
      embedDocuments: jest.fn(),
      embedQuery: jest.fn(),
    };
    vectorStore = {
      upsertChunk: jest.fn(),
      updateChunkEmbedding: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([]),
    };
    service = new ChatEmbeddingIndexService(
      embeddingProvider,
      vectorStore,
      staleChunkStore,
    );
  });

  it('skips every external and database call when embeddings are not configured', async () => {
    embeddingProvider.isConfigured.mockReturnValue(false);

    await expect(service.search('project-1', 'question')).resolves.toEqual([]);

    expect(staleChunkStore.findStaleChunks).not.toHaveBeenCalled();
    expect(embeddingProvider.embedQuery).not.toHaveBeenCalled();
    expect(vectorStore.search).not.toHaveBeenCalled();
  });

  it('indexes stale chunks by content hash before semantic search', async () => {
    staleChunkStore.findStaleChunks.mockResolvedValue([
      { id: 'chunk-1', content: 'Primer fragmento', contentHash: 'hash-1' },
      { id: 'chunk-2', content: 'Segundo fragmento', contentHash: 'hash-2' },
    ]);
    embeddingProvider.embedDocuments.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    embeddingProvider.embedQuery.mockResolvedValue([0.5, 0.6]);
    vectorStore.search.mockResolvedValue([
      {
        chunkId: 'chunk-2',
        sceneId: 'scene-2',
        content: 'Segundo fragmento',
        distance: 0.08,
      },
    ]);

    const result = await service.search('project-1', 'consulta semántica');

    expect(embeddingProvider.embedDocuments).toHaveBeenCalledWith([
      'Primer fragmento',
      'Segundo fragmento',
    ]);
    expect(vectorStore.updateChunkEmbedding).toHaveBeenNthCalledWith(1, {
      chunkId: 'chunk-1',
      embedding: [0.1, 0.2],
      contentHash: 'hash-1',
      model: 'gemini-embedding-2',
    });
    expect(vectorStore.updateChunkEmbedding).toHaveBeenNthCalledWith(2, {
      chunkId: 'chunk-2',
      embedding: [0.3, 0.4],
      contentHash: 'hash-2',
      model: 'gemini-embedding-2',
    });
    expect(vectorStore.search).toHaveBeenCalledWith({
      projectId: 'project-1',
      embedding: [0.5, 0.6],
      model: 'gemini-embedding-2',
      limit: 24,
    });
    expect(result[0]?.chunkId).toBe('chunk-2');
  });

  it('searches existing vectors without requesting document embeddings when the index is fresh', async () => {
    embeddingProvider.embedQuery.mockResolvedValue([0.1]);

    await service.search('project-1', 'consulta');

    expect(embeddingProvider.embedDocuments).not.toHaveBeenCalled();
    expect(vectorStore.updateChunkEmbedding).not.toHaveBeenCalled();
    expect(embeddingProvider.embedQuery).toHaveBeenCalledWith('consulta');
  });

  it('drops invalid and distant semantic noise at the retrieval boundary', async () => {
    embeddingProvider.embedQuery.mockResolvedValue([0.1]);
    vectorStore.search.mockResolvedValue([
      { chunkId: 'near', sceneId: 'scene-1', content: 'Near', distance: 0.2 },
      { chunkId: 'far', sceneId: 'scene-2', content: 'Far', distance: 0.8 },
      {
        chunkId: 'invalid',
        sceneId: 'scene-3',
        content: 'Invalid',
        distance: Number.NaN,
      },
    ]);

    const result = await service.search('project-1', 'consulta');

    expect(result.map((match) => match.chunkId)).toEqual(['near']);
  });

  it.each([
    [
      'document embedding failure',
      () => {
        staleChunkStore.findStaleChunks.mockResolvedValue([
          { id: 'chunk-1', content: 'Texto', contentHash: 'hash-1' },
        ]);
        embeddingProvider.embedDocuments.mockRejectedValue(
          new Error('embedding unavailable'),
        );
      },
    ],
    [
      'query embedding failure',
      () => {
        embeddingProvider.embedQuery.mockRejectedValue(
          new Error('query unavailable'),
        );
      },
    ],
    [
      'vector store failure',
      () => {
        embeddingProvider.embedQuery.mockResolvedValue([0.1]);
        vectorStore.search.mockRejectedValue(new Error('pgvector unavailable'));
      },
    ],
  ])('degrades to an empty semantic result on %s', async (_name, arrange) => {
    arrange();

    await expect(service.search('project-1', 'consulta')).resolves.toEqual([]);
  });

  it('does not write partial batches when the embedding provider response is incomplete', async () => {
    staleChunkStore.findStaleChunks.mockResolvedValue([
      { id: 'chunk-1', content: 'Uno', contentHash: 'hash-1' },
      { id: 'chunk-2', content: 'Dos', contentHash: 'hash-2' },
    ]);
    embeddingProvider.embedDocuments.mockResolvedValue([[0.1]]);

    await expect(service.search('project-1', 'consulta')).resolves.toEqual([]);

    expect(vectorStore.updateChunkEmbedding).not.toHaveBeenCalled();
    expect(vectorStore.search).not.toHaveBeenCalled();
  });

  it('coalesces concurrent indexing for the same project', async () => {
    staleChunkStore.findStaleChunks.mockResolvedValue([
      { id: 'chunk-1', content: 'Texto', contentHash: 'hash-1' },
    ]);
    let releaseEmbedding: ((value: number[][]) => void) | undefined;
    embeddingProvider.embedDocuments.mockImplementation(
      () =>
        new Promise<number[][]>((resolve) => {
          releaseEmbedding = resolve;
        }),
    );
    embeddingProvider.embedQuery.mockResolvedValue([0.2]);

    const first = service.search('project-1', 'primera consulta');
    const second = service.search('project-1', 'segunda consulta');
    await Promise.resolve();
    releaseEmbedding?.([[0.1]]);
    await Promise.all([first, second]);

    expect(staleChunkStore.findStaleChunks).toHaveBeenCalledTimes(1);
    expect(embeddingProvider.embedDocuments).toHaveBeenCalledTimes(1);
    expect(vectorStore.updateChunkEmbedding).toHaveBeenCalledTimes(1);
    expect(embeddingProvider.embedQuery).toHaveBeenCalledTimes(2);
  });

  it('stops waiting for a shared indexing batch when the request is aborted', async () => {
    staleChunkStore.findStaleChunks.mockResolvedValue([
      { id: 'chunk-1', content: 'Texto', contentHash: 'hash-1' },
    ]);
    let releaseEmbedding: ((value: number[][]) => void) | undefined;
    embeddingProvider.embedDocuments.mockImplementation(
      () =>
        new Promise<number[][]>((resolve) => {
          releaseEmbedding = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = service.search('project-1', 'consulta', controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(vectorStore.updateChunkEmbedding).not.toHaveBeenCalled();

    releaseEmbedding?.([[0.1]]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vectorStore.updateChunkEmbedding).toHaveBeenCalledTimes(1);
  });
});
