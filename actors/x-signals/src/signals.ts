import type { XPost, XProfile, SignalType } from './types.js';

const LAUNCH_KEYWORDS = [
  'launching', 'introducing', 'announcing', 'released', 'now available',
  'proud to announce', 'excited to share', 'shipping', 'just shipped',
  'we built', 'new feature', 'new product', 'generally available', 'ga today',
  'beta launch', 'open source', 'open sourcing',
];

const HIRING_KEYWORDS = [
  'hiring', "we're hiring", 'join our team', 'open roles', 'job opening',
  'looking for', 'come work with us', 'careers at',
];

// GPU/AI keywords that indicate compute demand when appearing in non-tracked accounts
export const PROSPECTING_KEYWORDS = [
  'gpu cluster', 'gpu infrastructure', 'inference at scale', 'llm inference',
  'running our own models', 'self-hosted ai', 'on-premise ai', 'private ai',
  'vllm', 'triton inference', 'ai infrastructure', 'model serving',
  'compute cluster', 'h100', 'a100', 'rtx pro', 'blackwell',
];

export function classifyPost(post: XPost): SignalType[] {
  const text = post.text.toLowerCase();
  const signals: SignalType[] = [];

  if (LAUNCH_KEYWORDS.some((kw) => text.includes(kw))) {
    signals.push('product_launch');
  }

  return signals;
}

export function detectEngagementSpike(
  post: XPost,
  avgLikes: number,
  avgReposts: number,
): boolean {
  const SPIKE_MULTIPLIER = 3;
  return (
    post.likes > avgLikes * SPIKE_MULTIPLIER ||
    post.reposts > avgReposts * SPIKE_MULTIPLIER
  );
}

export function classifyHandle(
  posts: XPost[],
  profile: XProfile,
  followerDelta: number | null,
  previousAvgLikes: number | null,
  previousAvgReposts: number | null,
): SignalType[] {
  const signals = new Set<SignalType>();

  // Product launches from any post
  for (const post of posts) {
    for (const s of classifyPost(post)) signals.add(s);
  }

  // Follower growth: >5% increase
  if (followerDelta !== null && profile.followerCount > 0) {
    const growthPct = followerDelta / (profile.followerCount - followerDelta);
    if (growthPct >= 0.05) signals.add('follower_growth');
  }

  // Engagement spike vs previous baseline
  if (posts.length > 0 && previousAvgLikes !== null && previousAvgReposts !== null) {
    const avgLikes = posts.reduce((s, p) => s + p.likes, 0) / posts.length;
    const avgReposts = posts.reduce((s, p) => s + p.reposts, 0) / posts.length;
    for (const post of posts) {
      if (detectEngagementSpike(post, previousAvgLikes, previousAvgReposts)) {
        signals.add('engagement_spike');
        break;
      }
    }
  }

  return [...signals];
}

export function averageEngagement(posts: XPost[]): { avgLikes: number; avgReposts: number } {
  if (posts.length === 0) return { avgLikes: 0, avgReposts: 0 };
  const avgLikes = posts.reduce((s, p) => s + p.likes, 0) / posts.length;
  const avgReposts = posts.reduce((s, p) => s + p.reposts, 0) / posts.length;
  return { avgLikes, avgReposts };
}
