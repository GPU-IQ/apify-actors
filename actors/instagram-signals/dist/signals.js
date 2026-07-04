const LAUNCH_KEYWORDS = [
    'launching', 'introducing', 'announcing', 'released', 'now available',
    'proud to announce', 'excited to share', 'shipping', 'just shipped',
    'we built', 'new feature', 'new product', 'generally available',
    'beta launch', 'open source',
];
export function classifyPost(post) {
    const text = (post.caption ?? '').toLowerCase();
    const signals = [];
    if (LAUNCH_KEYWORDS.some((kw) => text.includes(kw))) {
        signals.push('product_launch');
    }
    return signals;
}
export function classifyHandle(posts, profile, followerDelta, avgLikesBaseline) {
    const signals = new Set();
    for (const post of posts) {
        for (const s of classifyPost(post))
            signals.add(s);
    }
    // Follower growth: >5% increase
    if (followerDelta !== null && profile.followerCount > 0) {
        const pct = followerDelta / (profile.followerCount - followerDelta);
        if (pct >= 0.05)
            signals.add('follower_growth');
    }
    // Engagement spike vs baseline
    if (posts.length > 0 && avgLikesBaseline !== null) {
        const currentAvg = posts.reduce((s, p) => s + p.likes, 0) / posts.length;
        if (currentAvg > avgLikesBaseline * 3)
            signals.add('engagement_spike');
    }
    return [...signals];
}
export function averageEngagement(posts) {
    if (posts.length === 0)
        return 0;
    return posts.reduce((s, p) => s + p.likes, 0) / posts.length;
}
