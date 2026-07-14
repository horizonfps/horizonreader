// Server-only client for the internal Suwayomi-Server GraphQL engine.
// Operations verified against Suwayomi-WebUI (src/lib/graphql/**) and the
// Suwayomi-Server Kotlin resolvers (v2.3.x).

const BASE = process.env.SUWAYOMI_URL || "http://localhost:4567";
const ENDPOINT = `${BASE}/api/graphql`;

export type BrowseType = "POPULAR" | "LATEST" | "SEARCH";

export type SuwayomiSource = {
  id: string;
  name: string;
  displayName: string;
  lang: string;
  iconUrl: string;
  supportsLatest: boolean;
  isConfigurable: boolean;
};

export type SuwayomiManga = {
  id: number;
  title: string;
  thumbnailUrl?: string | null;
  inLibrary: boolean;
  initialized?: boolean;
  sourceId?: string;
  realUrl?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  genre?: string[] | null;
  status?: string | null;
  unreadCount?: number;
  downloadCount?: number;
  chapters?: { totalCount: number };
  source?: { id: string; name?: string; displayName?: string; lang?: string } | null;
};

export type SuwayomiChapter = {
  id: number;
  name: string;
  mangaId: number;
  scanlator?: string | null;
  sourceOrder: number;
  chapterNumber: number;
  isRead: boolean;
  isDownloaded: boolean;
  isBookmarked?: boolean;
  pageCount?: number;
  uploadDate?: string;
  fetchedAt?: string;
};

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Suwayomi ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

// ---- image URLs (proxied through the app so the browser never hits Suwayomi) ----
export function proxied(path: string): string {
  return `/api/image?path=${encodeURIComponent(path)}`;
}
export function coverUrl(manga: { id: number; thumbnailUrl?: string | null }): string {
  const path = manga.thumbnailUrl || `/api/v1/manga/${manga.id}/thumbnail`;
  return proxied(path);
}
export function pageUrl(mangaId: number, sourceOrder: number, pageIndex: number): string {
  return proxied(`/api/v1/manga/${mangaId}/chapter/${sourceOrder}/page/${pageIndex}`);
}

// ---- sources / browse ----
export async function listSources(): Promise<SuwayomiSource[]> {
  const data = await gql<{ sources: { nodes: SuwayomiSource[] } }>(`
    query {
      sources { nodes { id name displayName lang iconUrl isConfigurable supportsLatest } }
    }`);
  return data.sources.nodes;
}

export async function browseSource(
  source: string,
  type: BrowseType,
  page: number,
  query?: string,
): Promise<{ hasNextPage: boolean; mangas: SuwayomiManga[] }> {
  const data = await gql<{
    fetchSourceManga: { hasNextPage: boolean; mangas: SuwayomiManga[] };
  }>(
    `mutation Browse($input: FetchSourceMangaInput!) {
      fetchSourceManga(input: $input) {
        hasNextPage
        mangas { id title thumbnailUrl inLibrary initialized sourceId }
      }
    }`,
    { input: { source, type, page, ...(query ? { query } : {}) } },
  );
  return data.fetchSourceManga;
}

// ---- manga detail + chapters ----
export async function getManga(id: number): Promise<SuwayomiManga | null> {
  const data = await gql<{ manga: SuwayomiManga | null }>(
    `query GetManga($id: Int!) {
      manga(id: $id) {
        id title thumbnailUrl inLibrary initialized sourceId realUrl
        artist author description genre status unreadCount downloadCount
        chapters { totalCount }
        source { id name displayName lang }
      }
    }`,
    { id },
  );
  return data.manga;
}

export async function refreshManga(id: number, fetchManga = true, fetchChapters = true) {
  await gql(
    `mutation RefreshManga($id: Int!, $fetchManga: Boolean!, $fetchChapters: Boolean!) {
      fetchMangaAndChapters(input: { id: $id, fetchManga: $fetchManga, fetchChapters: $fetchChapters }) {
        manga @include(if: $fetchManga) { id }
        chapters @include(if: $fetchChapters) { id }
      }
    }`,
    { id, fetchManga, fetchChapters },
  );
}

// Get manga detail, populating from the source on first access.
export async function getMangaEnsured(id: number): Promise<SuwayomiManga | null> {
  let manga = await getManga(id);
  if (manga && !manga.initialized) {
    await refreshManga(id, true, true).catch(() => {});
    manga = await getManga(id);
  }
  return manga;
}

export async function getChapters(mangaId: number): Promise<SuwayomiChapter[]> {
  const data = await gql<{ chapters: { nodes: SuwayomiChapter[] } }>(
    `query GetChapters($condition: ChapterConditionInput, $order: [ChapterOrderInput!]) {
      chapters(condition: $condition, order: $order) {
        nodes {
          id name mangaId scanlator sourceOrder chapterNumber
          isRead isDownloaded isBookmarked pageCount uploadDate fetchedAt
        }
      }
    }`,
    { condition: { mangaId }, order: [{ by: "SOURCE_ORDER", byType: "DESC" }] },
  );
  return data.chapters.nodes;
}

// ---- reader ----
export async function fetchChapterPages(
  chapterId: number,
): Promise<{ pages: string[]; mangaId: number; pageCount: number; sourceOrder: number }> {
  const data = await gql<{
    fetchChapterPages: {
      pages: string[];
      chapter: { id: number; pageCount: number; sourceOrder: number; manga: { id: number } };
    };
  }>(
    `mutation GetChapterPages($chapterId: Int!) {
      fetchChapterPages(input: { chapterId: $chapterId }) {
        pages
        chapter { id pageCount sourceOrder manga { id } }
      }
    }`,
    { chapterId },
  );
  const c = data.fetchChapterPages.chapter;
  return {
    pages: data.fetchChapterPages.pages,
    mangaId: c.manga.id,
    pageCount: c.pageCount,
    sourceOrder: c.sourceOrder,
  };
}

// ---- library ----
export async function getLibraryMangas(): Promise<SuwayomiManga[]> {
  const data = await gql<{ mangas: { nodes: SuwayomiManga[] } }>(
    `query GetLibrary($condition: MangaConditionInput) {
      mangas(condition: $condition) {
        nodes { id title thumbnailUrl inLibrary sourceId unreadCount downloadCount }
      }
    }`,
    { condition: { inLibrary: true } },
  );
  return data.mangas.nodes;
}

export type RecentChapter = SuwayomiChapter & { manga: SuwayomiManga };

export async function getRecentUpdates(first = 200): Promise<RecentChapter[]> {
  const data = await gql<{ chapters: { nodes: RecentChapter[] } }>(
    `query RecentUpdates($first: Int, $filter: ChapterFilterInput, $order: [ChapterOrderInput!]) {
      chapters(first: $first, filter: $filter, order: $order) {
        nodes {
          id name mangaId sourceOrder chapterNumber isRead fetchedAt uploadDate
          manga { id title thumbnailUrl inLibrary sourceId }
        }
      }
    }`,
    {
      first,
      filter: { inLibrary: { equalTo: true } },
      order: [
        { by: "FETCHED_AT", byType: "DESC" },
        { by: "SOURCE_ORDER", byType: "DESC" },
      ],
    },
  );
  return data.chapters.nodes;
}

export async function addToLibrary(mangaId: number) {
  await gql(
    `mutation AddLib($id: Int!) {
      updateManga(input: { id: $id, patch: { inLibrary: true } }) { manga { id inLibrary } }
    }`,
    { id: mangaId },
  );
}

export async function removeFromLibrary(mangaId: number) {
  await gql(
    `mutation RemoveLib($id: Int!) {
      updateManga(input: { id: $id, patch: { inLibrary: false } }) { manga { id inLibrary } }
    }`,
    { id: mangaId },
  );
}

export async function enqueueDownload(ids: number[]) {
  await gql(
    `mutation Enqueue($input: EnqueueChapterDownloadsInput!) {
      enqueueChapterDownloads(input: $input) { downloadStatus { state } }
    }`,
    { input: { ids } },
  );
}

export async function updateLibrary() {
  await gql(
    `mutation UpdateLibrary($input: UpdateLibraryInput = {}) {
      updateLibrary(input: $input) { updateStatus { jobsInfo { isRunning totalJobs } } }
    }`,
    { input: {} },
  );
}
