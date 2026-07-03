export type SignalType =
  | 'product_launch'
  | 'engagement_spike'
  | 'follower_growth'
  | 'trending_mention'
  | 'net_new_prospect';

export type RunMode = 'account_tracking' | 'keyword_search' | 'both';

export interface Input {
  handles: string[];
  keywords: string[];
  mode: RunMode;
  maxPostsPerHandle: number;
  maxSearchResults: number;
  followerBaselinePath: string;
}

export interface XPost {
  postId: string;
  handle: string;
  text: string;
  postedAt: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  url: string;
  hasMedia: boolean;
  hasLink: boolean;
}

export interface XProfile {
  handle: string;
  displayName: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  verified: boolean;
  url: string;
}

export interface HandleResult {
  handle: string;
  profile: XProfile | null;
  posts: XPost[];
  followerDelta: number | null;
  signals: SignalType[];
  scrapedAt: string;
  error?: string;
}

export interface KeywordResult {
  keyword: string;
  posts: (XPost & { authorHandle: string; authorName: string })[];
  scrapedAt: string;
  error?: string;
}

// Shape of the actor's dataset output — one record per handle or keyword run
export type ActorOutput = HandleResult | KeywordResult;
