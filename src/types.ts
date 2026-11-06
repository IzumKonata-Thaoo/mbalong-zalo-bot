export type Role = "user" | "assistant" | "system";
export type BotStatus = "offline" | "connecting" | "qr" | "online" | "error";

export interface ChatImage {
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface ChatMessage {
  role: Role;
  content: string;
  images?: ChatImage[];
}

export interface GroupRecord {
  id: string;
  name: string;
  enabled: number;
  member_count: number;
  last_seen_at: string | null;
}

export interface IncomingGroupMessage {
  groupId: string;
  senderId: string;
  senderName: string;
  content: string;
  messageId: string;
  mentions: Array<{ uid?: string; pos?: number; len?: number }>;
  imageUrl?: string;
  raw: unknown;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}
