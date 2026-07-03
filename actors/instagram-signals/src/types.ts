export type SignalType =
  | 'product_launch'
  | 'engagement_spike'
  | 'follower_growth'
  | 'trending_mention'
  | 'net_new_prospect';

export type RunMode = 'account_tracking' | 'hashtag_search' | 'both';

export interface Input {
  handles: string[];
  hashtags: string[];
  mode: RunMode;
  maxPostsPerHandle: number;
  maxHashtagResults: number;
  sessionUsername: string;
  followerBaselinePath: string;
}

export interface IgPost {
  postId: string;
  handle: string;
  caption: string;
  postedAt: string;
  likes: number;
  comments: number;
  url: string;
  mediaType: 'image' | 'video' | 'carousel';
  thumbnailUrl: string;
  hashtags: string[];
}

export interface IgProfile {
  handle: string;
  displayName: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isVerified: boolean;
  url: string;
}

export interface HandleResult {
  handle: string;
  profile: IgProfile | null;
  posts: IgPost[];
  followerDelta: number | null;
  signals: SignalType[];
  scrapedAt: string;
  error?: string;
}

export interface HashtagResult {
  hashtag: string;
  posts: (IgPost & { authorHandle: string })[];
  scrapedAt: string;
  error?: string;
}

export type ActorOutput = HandleResult | HashtagResult;
