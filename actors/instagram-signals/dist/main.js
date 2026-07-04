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
import { classifyHandle } from './signals.js';
import { scrapeProfile, scrapeHashtag, loginIfNeeded } from './router.js';
await Actor.init();
const input = (await Actor.getInput()) ?? {};
const { handles = [], hashtags = [], mode = 'both', maxPostsPerHandle = 12, maxHashtagResults = 30, followerBaselinePath = 'ig-follower-baseline', } = input;
const kvStore = await KeyValueStore.open();
const baseline = ((await kvStore.getValue(followerBaselinePath)) ?? {});
const newBaseline = { ...baseline };
const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    maxConcurrency: 2, // Keep low for Instagram — more aggressive = more bans
    navigationTimeoutSecs: 40,
    requestHandlerTimeoutSecs: 120,
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        },
    },
    // Log in on the first request of each new session
    preNavigationHooks: [
        async (ctx) => {
            if (ctx.session && !ctx.session.__igLoggedIn) {
                const ok = await loginIfNeeded(ctx.page);
                if (ok)
                    ctx.session.__igLoggedIn = true;
            }
        },
    ],
    async requestHandler({ page, request, log }) {
        const { type, handle, hashtag } = request.userData;
        if (type === 'profile' && handle) {
            log.info(`Scraping Instagram profile: @${handle}`);
            try {
                const { profile, posts } = await scrapeProfile(page, handle, maxPostsPerHandle);
                const followerDelta = profile && baseline[handle] !== undefined
                    ? profile.followerCount - baseline[handle]
                    : null;
                if (profile)
                    newBaseline[handle] = profile.followerCount;
                const avgLikesBaseline = null; // extend to persist per-handle engagement baseline
                const signals = profile
                    ? classifyHandle(posts, profile, followerDelta, avgLikesBaseline)
                    : [];
                const result = {
                    handle,
                    profile,
                    posts,
                    followerDelta,
                    signals,
                    scrapedAt: new Date().toISOString(),
                };
                await Actor.pushData(result);
                log.info(`@${handle}: ${posts.length} posts, signals: ${signals.join(', ') || 'none'}`);
            }
            catch (err) {
                log.error(`Failed to scrape @${handle}: ${err.message}`);
                await Actor.pushData({
                    handle,
                    profile: null,
                    posts: [],
                    followerDelta: null,
                    signals: [],
                    scrapedAt: new Date().toISOString(),
                    error: err.message,
                });
            }
        }
        if (type === 'hashtag' && hashtag) {
            log.info(`Scraping Instagram hashtag: #${hashtag}`);
            try {
                const posts = await scrapeHashtag(page, hashtag, maxHashtagResults);
                const result = {
                    hashtag,
                    posts,
                    scrapedAt: new Date().toISOString(),
                };
                await Actor.pushData(result);
                log.info(`#${hashtag}: ${posts.length} posts found`);
            }
            catch (err) {
                log.error(`Failed to scrape #${hashtag}: ${err.message}`);
                await Actor.pushData({
                    hashtag,
                    posts: [],
                    scrapedAt: new Date().toISOString(),
                    error: err.message,
                });
            }
        }
    },
    failedRequestHandler({ request, log }) {
        log.error(`Request failed after retries: ${request.url}`);
    },
});
const requests = [];
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
}
else {
    await crawler.run(requests);
}
await kvStore.setValue(followerBaselinePath, newBaseline);
await Actor.exit();
