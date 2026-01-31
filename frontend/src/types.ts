export interface Cluster {
  id: string;
  status: "Open" | "Actioned";
  channelCount: number;
  previewText?: string;
  representativeVisitor?: string;
  additionalVisitorCount: number;
  visitorAvatarUrls?: string[];
  createdAt: string;
  responseText?: string;
  messages?: Message[];
}

export interface Message {
  id: string;
  text: string;
  visitorUsername?: string;
  visitorAvatarUrl?: string;
  createdAt: string;
  channelId: string;
}

export interface IngestMessageInput {
  creatorId: string;
  messageId: string;
  text: string;
  channelId: string;
  channelCid?: string;
  visitorUserId?: string;
  visitorUsername?: string;
  createdAt: string;
  isPaidDm?: boolean;
  rawPayload?: Record<string, unknown>;
}
