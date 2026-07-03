/**
 * GPU IQ X Signals Actor
 *
 * Tracks X (Twitter) handles and keywords to surface product launches,
 * engagement spikes, follower growth, and net-new AI/GPU prospects.
 *
 * Scraping strategy: intercept X's internal GraphQL API responses via
 * Playwright's network interception — more stable than DOM parsing.
 *
 * Output: one dataset record per handle (HandleResult) or keyword (KeywordResult).
 * The GPU IQ platform polls the dataset after each run and ingests into
 * social_posts / social_signals tables.
 */

import { Actor, KeyValueStore } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import type { Input, HandleResult, KeywordResult } from './types.js';
import { classifyHandle, averageEngagement } from './signals.js';
import { scrapeProfile, scrapeKeyword } from './router.js';

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? ({} as Input);

const {
  handles = [],
  keywords = [],
  mode = 'both',
  maxPostsPerHandle = 25,
  maxSearchResults = 50,
  followerBaselinePath = 'follower-baseline',
} = input;

// Load previous follower counts for delta calculation
const kvStore = await KeyValueStore.open();
const baseline = ((await kvStore.getValue<Record<string, number>>(followerBaselinePath)) ?? {}) as Record<string, number>;
const newBaseline: Record<string, number> = { ...baseline };

const proxyConfiguration = await Actor.createProxyConfiguration({
  groups: ['RESIDENTIAL'],
});

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  useSessionPool: true,
  persistCookiesPerSession: true,
  maxConcurrency: 3,
  navigationTimeoutSecs: 40,
  requestHandlerTimeoutSecs: 90,

  // Human-like launch options
  launchContext: {
    launchOptions: {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    },
  },

  async requestHandler({ page, request, log }) {
    const { type, handle, keyword } = request.userData as {
      type: 'profile' | 'keyword';
      handle?: string;
      keyword?: string;
    };

    if (type === 'profile' && handle) {
      log.info(`Scraping X profile: @${handle}`);
      try {
        const { profile, posts } = await scrapeProfile(page, handle, maxPostsPerHandle);

        const followerDelta =
          profile && baseline[handle] !== undefined
            ? profile.followerCount - baseline[handle]
            : null;

        if (profile) {
          newBaseline[handle] = profile.followerCount;
        }

        // Need a baseline to detect spikes — skip on first run
        const { avgLikes, avgReposts } = averageEngagement(posts);

        const signals = profile
          ? classifyHandle(posts, profile, followerDelta, null, null)
          : [];

        const result: HandleResult = {
          handle,
          profile,
          posts,
          followerDelta,
          signals,
          scrapedAt: new Date().toISOString(),
        };

        await Actor.pushData(result);
        log.info(`@${handle}: ${posts.length} posts, signals: ${signals.join(', ') || 'none'}`);
      } catch (err) {
        log.error(`Failed to scrape @${handle}: ${(err as Error).message}`);
        await Actor.pushData({
          handle,
          profile: null,
          posts: [],
          followerDelta: null,
          signals: [],
          scrapedAt: new Date().toISOString(),
          error: (err as Error).message,
        } satisfies HandleResult);
      }
    }

    if (type === 'keyword' && keyword) {
      log.info(`Searching X for keyword: "${keyword}"`);
      try {
        const posts = await scrapeKeyword(page, keyword, maxSearchResults);

        const result: KeywordResult = {
          keyword,
          posts,
          scrapedAt: new Date().toISOString(),
        };

        await Actor.pushData(result);
        log.info(`"${keyword}": ${posts.length} posts found`);
      } catch (err) {
        log.error(`Failed keyword search "${keyword}": ${(err as Error).message}`);
        await Actor.pushData({
          keyword,
          posts: [],
          scrapedAt: new Date().toISOString(),
          error: (err as Error).message,
        } satisfies KeywordResult);
      }
    }
  },

  failedRequestHandler({ request, log }) {
    log.error(`Request failed after retries: ${request.url}`);
  },
});

// Build request list
const requests: Parameters<typeof crawler.run>[0] = [];

if (mode === 'account_tracking' || mode === 'both') {
  for (const handle of handles) {
    requests.push({
      url: `https://x.com/${handle}`,
      userData: { type: 'profile', handle },
    });
  }
}

if (mode === 'keyword_search' || mode === 'both') {
  for (const keyword of keywords) {
    requests.push({
      url: `https://x.com/search?q=${encodeURIComponent(keyword)}&f=live`,
      userData: { type: 'keyword', keyword },
    });
  }
}

if (requests.length === 0) {
  console.warn('No handles or keywords provided — nothing to scrape.');
} else {
  await crawler.run(requests);
}

// Persist updated follower baseline for next run
await kvStore.setValue(followerBaselinePath, newBaseline);

await Actor.exit();
