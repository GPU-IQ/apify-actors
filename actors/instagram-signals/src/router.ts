/**
 * Playwright page handlers for Instagram scraping.
 *
 * Strategy: intercept Instagram's internal API responses (i/api/v1/...)
 * which are called by the React app as you browse. These return clean JSON
 * without DOM parsing. For authenticated requests the session pool provides
 * a pre-logged-in browser context.
 *
 * Session setup: the first run must log in with the dedicated account
 * (credentials from Actor env vars INSTAGRAM_USERNAME / INSTAGRAM_PASSWORD).
 * Crawlee's session pool persists cookies so subsequent requests reuse the
 * session. Sessions are retired automatically if Instagram challenges them.
 */

import type { Page, Response } from 'playwright';
import type { IgPost, IgProfile } from './types.js';

// ── API response parsers ──────────────────────────────────────────────────────

export function parseProfileFromApi(data: unknown): IgProfile | null {
  try {
    const user = (data as any)?.data?.user ?? (data as any)?.user;
    if (!user) return null;
    return {
      handle: user.username ?? '',
      displayName: user.full_name ?? '',
      bio: user.biography ?? '',
      followerCount: user.edge_followed_by?.count ?? user.follower_count ?? 0,
      followingCount: user.edge_follow?.count ?? user.following_count ?? 0,
      postCount: user.edge_owner_to_timeline_media?.count ?? user.media_count ?? 0,
      isVerified: user.is_verified ?? false,
      url: `https://www.instagram.com/${user.username}/`,
    };
  } catch {
    return null;
  }
}

export function parsePostsFromApi(data: unknown, handle: string): IgPost[] {
  try {
    // GraphQL shape (web)
    const edges =
      (data as any)?.data?.user?.edge_owner_to_timeline_media?.edges ??
      // API v1 shape (mobile)
      (data as any)?.items ?? [];

    const items = Array.isArray(edges)
      ? edges.map((e: any) => e.node ?? e)
      : [];

    return items.map((item: any): IgPost => {
      const caption =
        item.edge_media_to_caption?.edges?.[0]?.node?.text ??
        item.caption?.text ?? '';
      const hashtags = (caption.match(/#\w+/g) ?? []).map((t: string) => t.slice(1));
      const mediaType =
        item.__typename === 'GraphVideo' || item.media_type === 2
          ? 'video'
          : item.__typename === 'GraphSidecar' || item.media_type === 8
          ? 'carousel'
          : 'image';

      return {
        postId: item.id ?? item.pk ?? '',
        handle,
        caption,
        postedAt: new Date((item.taken_at_timestamp ?? item.taken_at ?? 0) * 1000).toISOString(),
        likes: item.edge_media_preview_like?.count ?? item.like_count ?? 0,
        comments: item.edge_media_to_comment?.count ?? item.comment_count ?? 0,
        url: `https://www.instagram.com/p/${item.shortcode ?? item.code ?? ''}/`,
        mediaType,
        thumbnailUrl: item.thumbnail_src ?? item.display_url ?? item.image_versions2?.candidates?.[0]?.url ?? '',
        hashtags,
      };
    });
  } catch {
    return [];
  }
}

// ── Session login helper ──────────────────────────────────────────────────────

export async function loginIfNeeded(page: Page): Promise<boolean> {
  const username = process.env.INSTAGRAM_USERNAME;
  const password = process.env.INSTAGRAM_PASSWORD;
  if (!username || !password) return false;

  await page.goto('https://www.instagram.com/accounts/login/', {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });

  // Check if already logged in
  const isLoggedIn = await page.evaluate(() =>
    document.cookie.includes('sessionid'),
  );
  if (isLoggedIn) return true;

  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20_000 });
  return true;
}

// ── Page-level scrapers ───────────────────────────────────────────────────────

export interface ScrapeProfileResult {
  profile: IgProfile | null;
  posts: IgPost[];
}

export async function scrapeProfile(
  page: Page,
  handle: string,
  maxPosts: number,
): Promise<ScrapeProfileResult> {
  let profile: IgProfile | null = null;
  const posts: IgPost[] = [];

  const onResponse = async (response: Response) => {
    const url = response.url();
    if (!url.includes('instagram.com')) return;
    try {
      if (url.includes('api/v1/users/web_profile_info') || url.includes(`/${handle}/`)) {
        const json = await response.json();
        const parsed = parseProfileFromApi(json);
        if (parsed) profile = parsed;
        const parsedPosts = parsePostsFromApi(json, handle);
        posts.push(...parsedPosts);
      }
    } catch {
      // non-JSON — skip
    }
  };

  page.on('response', onResponse);

  await page.goto(`https://www.instagram.com/${handle}/`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });

  // Fallback: try JSON-LD structured data in page source
  if (!profile) {
    try {
      const ldJson = await page.$eval(
        'script[type="application/ld+json"]',
        (el) => JSON.parse(el.textContent ?? '{}'),
      );
      if (ldJson?.author?.name) {
        profile = {
          handle,
          displayName: ldJson.author?.name ?? '',
          bio: '',
          followerCount: 0,
          followingCount: 0,
          postCount: 0,
          isVerified: false,
          url: `https://www.instagram.com/${handle}/`,
        };
      }
    } catch {
      // no JSON-LD
    }
  }

  page.off('response', onResponse);

  return { profile, posts: posts.slice(0, maxPosts) };
}

export async function scrapeHashtag(
  page: Page,
  hashtag: string,
  maxResults: number,
): Promise<(IgPost & { authorHandle: string })[]> {
  const results: (IgPost & { authorHandle: string })[] = [];

  const onResponse = async (response: Response) => {
    const url = response.url();
    if (!url.includes('hashtag') && !url.includes('tags')) return;
    try {
      const json = await response.json();
      const edges =
        (json as any)?.data?.hashtag?.edge_hashtag_to_media?.edges ??
        (json as any)?.data?.recent_media?.edges ?? [];
      for (const edge of edges) {
        const node = edge.node ?? {};
        const authorHandle = node.owner?.username ?? '';
        const post = parsePostsFromApi({ data: { user: { edge_owner_to_timeline_media: { edges: [{ node }] } } } }, authorHandle)[0];
        if (post) results.push({ ...post, authorHandle });
      }
    } catch {
      // skip
    }
  };

  page.on('response', onResponse);

  await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });

  page.off('response', onResponse);

  return results.slice(0, maxResults);
}
