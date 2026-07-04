/**
 * Playwright page handlers for X (Twitter) scraping.
 *
 * Strategy: intercept X's internal GraphQL API responses rather than
 * parsing the DOM. When a profile page loads, the browser calls
 * api.x.com/graphql/.../UserByScreenName and UserTweets — we capture
 * those JSON payloads for clean structured data that doesn't break on
 * layout changes.
 */
// ── GraphQL response parsers ──────────────────────────────────────────────────
export function parseUserFromGraphQL(data) {
    try {
        const result = data?.data?.user?.result;
        if (!result)
            return null;
        const legacy = result.legacy ?? {};
        return {
            handle: legacy.screen_name ?? '',
            displayName: legacy.name ?? '',
            bio: legacy.description ?? '',
            followerCount: legacy.followers_count ?? 0,
            followingCount: legacy.friends_count ?? 0,
            verified: legacy.verified ?? result.is_blue_verified ?? false,
            url: `https://x.com/${legacy.screen_name}`,
        };
    }
    catch {
        return null;
    }
}
export function parseTweetsFromGraphQL(data) {
    try {
        const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions ?? [];
        const entries = [];
        for (const instruction of instructions) {
            if (instruction.type === 'TimelineAddEntries') {
                entries.push(...(instruction.entries ?? []));
            }
        }
        return entries
            .map((entry) => {
            const tweet = entry?.content?.itemContent?.tweet_results?.result?.legacy;
            if (!tweet)
                return null;
            const id = tweet.id_str ?? '';
            return {
                postId: id,
                handle: tweet.user_id_str ?? '',
                text: tweet.full_text ?? '',
                postedAt: tweet.created_at ?? '',
                likes: tweet.favorite_count ?? 0,
                reposts: tweet.retweet_count ?? 0,
                replies: tweet.reply_count ?? 0,
                views: Number(tweet.views?.count ?? 0),
                url: id ? `https://x.com/i/web/status/${id}` : '',
                hasMedia: (tweet.entities?.media ?? []).length > 0,
                hasLink: (tweet.entities?.urls ?? []).length > 0,
            };
        })
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
export function parseSearchResultsFromGraphQL(data) {
    try {
        const instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ?? [];
        const entries = [];
        for (const instruction of instructions) {
            if (instruction.type === 'TimelineAddEntries') {
                entries.push(...(instruction.entries ?? []));
            }
        }
        return entries
            .map((entry) => {
            const result = entry?.content?.itemContent?.tweet_results?.result;
            const tweet = result?.legacy;
            const user = result?.core?.user_results?.result?.legacy;
            if (!tweet)
                return null;
            const id = tweet.id_str ?? '';
            return {
                postId: id,
                handle: user?.screen_name ?? '',
                text: tweet.full_text ?? '',
                postedAt: tweet.created_at ?? '',
                likes: tweet.favorite_count ?? 0,
                reposts: tweet.retweet_count ?? 0,
                replies: tweet.reply_count ?? 0,
                views: Number(tweet.views?.count ?? 0),
                url: id ? `https://x.com/i/web/status/${id}` : '',
                hasMedia: (tweet.entities?.media ?? []).length > 0,
                hasLink: (tweet.entities?.urls ?? []).length > 0,
                authorHandle: user?.screen_name ?? '',
                authorName: user?.name ?? '',
            };
        })
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
export async function scrapeProfile(page, handle, maxPosts) {
    let profile = null;
    const posts = [];
    const onResponse = async (response) => {
        const url = response.url();
        if (!url.includes('api.x.com') && !url.includes('api.twitter.com'))
            return;
        try {
            if (url.includes('UserByScreenName')) {
                const json = await response.json();
                profile = parseUserFromGraphQL(json);
            }
            else if (url.includes('UserTweets') && !url.includes('UserTweetsAndReplies')) {
                const json = await response.json();
                posts.push(...parseTweetsFromGraphQL(json));
            }
        }
        catch {
            // non-JSON response — skip
        }
    };
    page.on('response', onResponse);
    await page.goto(`https://x.com/${handle}`, {
        waitUntil: 'networkidle',
        timeout: 30_000,
    });
    // Scroll once to trigger tweet loading if not already populated
    if (posts.length === 0) {
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(2_000);
    }
    page.off('response', onResponse);
    return { profile, posts: posts.slice(0, maxPosts) };
}
export async function scrapeKeyword(page, keyword, maxResults) {
    const results = [];
    const onResponse = async (response) => {
        const url = response.url();
        if (!url.includes('SearchTimeline'))
            return;
        try {
            const json = await response.json();
            results.push(...parseSearchResultsFromGraphQL(json));
        }
        catch {
            // skip
        }
    };
    page.on('response', onResponse);
    const encoded = encodeURIComponent(keyword);
    await page.goto(`https://x.com/search?q=${encoded}&f=live`, {
        waitUntil: 'networkidle',
        timeout: 30_000,
    });
    page.off('response', onResponse);
    return results.slice(0, maxResults);
}
