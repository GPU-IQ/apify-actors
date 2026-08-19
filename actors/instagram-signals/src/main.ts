/**
 * GPU IQ Instagram Signals Actor
 *
 * Tracks Instagram brand handles and hashtags to surface product launches,
 * engagement spikes, and follower growth for GPU IQ.
 *
 * Session management: uses a dedicated Instagram account (credentials set as
 * Actor environment variables INSTAGRAM_USERNAME / INSTAGRAM_PASSWORD).
 * Crawlee's session pool persists the login across requests.
 *
 * Output: one dataset record per handle (HandleResult) or hashtag (HashtagResult).
 */

import { Actor, KeyValueStore } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import type { Page } from 'playwright-core';
import type { Input, HandleResult, HashtagResult } from './types.js';
import { classifyHandle, averageEngagement } from './signals.js';
import { scrapeProfile, scrapeHashtag, loginIfNeeded } from './router.js';

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? ({} as Input);

const {
  handles = [],
  hashtags = [],
  mode = 'both',
  maxPostsPerHandle = 12,
  maxHashtagResults = 30,
  followerBaselinePath = 'ig-follower-baseline',
} = input;

const kvStore = await KeyValueStore.open();
const baseline =
  ((await kvStore.getValue<Record<string, number>>(followerBaselinePath)) ?? {}) as Record<string, number>;
const newBaseline: Record<string, number> = { ...baseline };

const proxyConfiguration = await Actor.createProxyConfiguration({
  groups: ['RESIDENTIAL'],
  countryCode: 'US',
});

const igUsername = process.env.INSTAGRAM_USERNAME;
const igPassword = process.env.INSTAGRAM_PASSWORD;

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  useSessionPool: true,
  persistCookiesPerSession: true,
  maxConcurrency: 1,
  navigationTimeoutSecs: 60,
  requestHandlerTimeoutSecs: 120,

  launchContext: {
    launchOptions: {
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    },
  },

  async requestHandler({ page, request, log }) {
    const { type, handle, hashtag } = request.userData as {
      type: 'login' | 'profile' | 'hashtag';
      handle?: string;
      hashtag?: string;
    };

    // ── Login request — handled first so session cookies persist ──────────────
    if (type === 'login') {
      log.info('Attempting Instagram login');
      await page.goto('https://www.instagram.com/accounts/login/', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Log page state for debugging
      await page.waitForTimeout(2_000);
      log.info(`Login page URL: ${page.url()}`);
      log.info(`Login page title: ${await page.title()}`);

      // Dismiss cookie/consent dialog — try all common variants
      for (const sel of [
        'button:has-text("Allow all cookies")',
        'button:has-text("Accept all")',
        'button:has-text("Allow essential and optional cookies")',
        'button:has-text("Accept")',
        '[data-cookiebanner="accept_button"]',
        'button[class*="accept"]',
        '._a9--._ap36._a9_1',  // Instagram-specific consent button class
      ]) {
        try {
          await page.locator(sel).first().click({ timeout: 3_000 });
          log.info(`Clicked consent button: ${sel}`);
          await page.waitForTimeout(1_500);
          break;
        } catch { /* try next */ }
      }

      log.info(`Post-consent URL: ${page.url()}`);

      try {
        // Try multiple selectors — Instagram changes input attributes frequently
        const userInput = page.locator([
          'input[name="username"]',
          'input[aria-label*="username" i]',
          'input[aria-label*="Mobile number" i]',
          'input[type="text"]',
        ].join(', ')).first();
        await userInput.waitFor({ state: 'attached', timeout: 20_000 });
        await userInput.fill(igUsername!);

        const passInput = page.locator([
          'input[name="password"]',
          'input[aria-label*="password" i]',
          'input[type="password"]',
        ].join(', ')).first();
        await passInput.fill(igPassword!);
        await passInput.press('Enter');
        await page.waitForURL(
          url => !url.toString().includes('/accounts/login'),
          { timeout: 25_000 },
        ).catch(() => { /* challenge — session may still work */ });
        log.info(`Login done, now at: ${page.url()}`);
      } catch (err) {
        log.warning(`Instagram login failed: ${(err as Error).message}`);
        // Log visible text to understand what page is showing
        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => '');
        log.warning(`Page content: ${bodyText}`);
      }
      return;
    }

    if (type === 'profile' && handle) {
      log.info(`Scraping Instagram profile: @${handle}`);
      try {
        const { profile, posts } = await scrapeProfile(page, handle, maxPostsPerHandle);

        const followerDelta =
          profile && baseline[handle] !== undefined
            ? profile.followerCount - baseline[handle]
            : null;

        if (profile) newBaseline[handle] = profile.followerCount;

        const avgLikesBaseline = null; // extend to persist per-handle engagement baseline
        const signals = profile
          ? classifyHandle(posts, profile, followerDelta, avgLikesBaseline)
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

    if (type === 'hashtag' && hashtag) {
      log.info(`Scraping Instagram hashtag: #${hashtag}`);
      try {
        const posts = await scrapeHashtag(page, hashtag, maxHashtagResults);
        const result: HashtagResult = {
          hashtag,
          posts,
          scrapedAt: new Date().toISOString(),
        };
        await Actor.pushData(result);
        log.info(`#${hashtag}: ${posts.length} posts found`);
      } catch (err) {
        log.error(`Failed to scrape #${hashtag}: ${(err as Error).message}`);
        await Actor.pushData({
          hashtag,
          posts: [],
          scrapedAt: new Date().toISOString(),
          error: (err as Error).message,
        } satisfies HashtagResult);
      }
    }
  },

  failedRequestHandler({ request, log }) {
    log.error(`Request failed after retries: ${request.url}`);
  },
});

const requests: { url: string; userData: Record<string, unknown> }[] = [];

// Login first so the session is authenticated before scraping
if (igUsername && igPassword) {
  requests.push({
    url: 'https://www.instagram.com/accounts/login/',
    userData: { type: 'login' },
  });
}

if (mode === 'account_tracking' || mode === 'both') {
  for (const handle of handles) {
    requests.push({
      url: `https://www.instagram.com/${handle}/`,
      userData: { type: 'profile', handle },
    });
  }
}

if (mode === 'hashtag_search' || mode === 'both') {
  for (const hashtag of hashtags) {
    requests.push({
      url: `https://www.instagram.com/explore/tags/${hashtag}/`,
      userData: { type: 'hashtag', hashtag },
    });
  }
}

if (requests.length === 0) {
  console.warn('No handles or hashtags provided — nothing to scrape.');
} else {
  await crawler.run(requests);
}

await kvStore.setValue(followerBaselinePath, newBaseline);

await Actor.exit();
