import { Injectable } from "@nestjs/common";
import { DbService } from "../../db/db.service";
import { toVectorLiteral } from "../../db/vector";
import { EmbeddingsService } from "../embeddings/embeddings.service";
import { IngestMessageInput } from "./ingest-message.input";
import { IngestResult } from "./ingest-result.model";

// TODO: Move to feature flag system for controlled rollout in production
const SIMILARITY_THRESHOLD = 0.9; // Vector cosine similarity (semantic matching)
const TRIGRAM_THRESHOLD = 0.85; // pg_trgm similarity (near-exact text matching)

// Messages that don't need a response - skip ingest entirely
const NO_RESPONSE_PATTERNS = [
  /^(thanks|thank you|thx|ty|tysm)!*\.?$/i,
  /^(ok|okay|k|kk|got it|sounds good|perfect|great|awesome|cool|nice)!*\.?$/i,
  /^(yes|no|yep|nope|yea|yeah|nah)!*\.?$/i,
  /^[\p{Emoji}\s]+$/u, // emoji-only messages
];

const MIN_RESPONSE_LENGTH = 5; // Single word acks like "ok" are too short

function needsResponse(text: string): boolean {
  const trimmed = text.trim();

  // Too short - likely an acknowledgment
  if (trimmed.length < MIN_RESPONSE_LENGTH) {
    return false;
  }

  // Matches known "no response needed" patterns
  if (NO_RESPONSE_PATTERNS.some((p) => p.test(trimmed))) {
    return false;
  }

  return true;
}

type MatchRow = {
  id: string;
  cluster_id: string | null;
  similarity: number;
};

type TrigramMatchRow = {
  id: string;
  cluster_id: string | null;
  trgm_similarity: number;
  cluster_has_embeddings: boolean;
};

@Injectable()
export class MessagesService {
  constructor(
    private db: DbService,
    private embeddings: EmbeddingsService,
  ) {}

  async ingestMessage(input: IngestMessageInput): Promise<IngestResult> {
    // Early exit for messages that don't need a response
    if (!needsResponse(input.text)) {
      return {
        skipped: true,
        skipReason: "no_response_needed",
      };
    }

    const isPaidDm = input.isPaidDm === true;
    const createdAt = input.createdAt || new Date();

    return this.db.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        let embeddingLiteral: string | null = null;
        let matchedMessageId: string | undefined;
        let similarity: number | undefined;
        let clusterId: string | undefined;
        let skippedEmbedding = false;

        // Step 1: Check for near-exact trigram match (before calling embedding API)
        if (!isPaidDm) {
          const trigramMatch = await client.query<TrigramMatchRow>(
            `
              SELECT
                m.id,
                cm.cluster_id,
                similarity(m.text, $1) AS trgm_similarity,
                EXISTS (
                  SELECT 1 FROM cluster_messages cm2
                  JOIN messages m2 ON m2.id = cm2.message_id
                  WHERE cm2.cluster_id = cm.cluster_id
                    AND cm2.excluded_at IS NULL
                    AND m2.embedding IS NOT NULL
                    AND m2.id <> m.id
                ) AS cluster_has_embeddings
              FROM messages m
              LEFT JOIN cluster_messages cm
                ON cm.message_id = m.id AND cm.excluded_at IS NULL
              LEFT JOIN clusters c
                ON c.id = cm.cluster_id
              WHERE m.creator_id = $2
                AND m.replied_at IS NULL
                AND m.is_paid_dm = false
                AND similarity(m.text, $1) > $3
                AND (c.status IS NULL OR c.status = 'open')
              ORDER BY similarity(m.text, $1) DESC
              LIMIT 1
            `,
            [input.text, input.creatorId, TRIGRAM_THRESHOLD],
          );

          if (trigramMatch.rowCount > 0) {
            const match = trigramMatch.rows[0];
            matchedMessageId = match.id;
            similarity = Number(match.trgm_similarity);

            if (match.cluster_id) {
              // Join existing cluster
              clusterId = match.cluster_id;
              // Skip embedding only if cluster has other messages with embeddings
              if (match.cluster_has_embeddings) {
                skippedEmbedding = true;
              }
            }
            // If no cluster_id, we still need to create cluster and embed
            // (the matched message will need an embedding too)
          }
        }

        // Step 2: Get embedding if not skipped
        if (!skippedEmbedding) {
          const embedding = await this.embeddings.embed(input.text);
          embeddingLiteral = toVectorLiteral(embedding);
        }

        // Step 3: Insert the message
        const insert = await client.query<{ id: string }>(
          `
            INSERT INTO messages (
              external_message_id,
              creator_id,
              channel_id,
              channel_cid,
              visitor_user_id,
              visitor_username,
              text,
              embedding,
              created_at,
              is_paid_dm,
              raw_payload
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id
          `,
          [
            input.messageId,
            input.creatorId,
            input.channelId,
            input.channelCid || null,
            input.visitorUserId || null,
            input.visitorUsername || null,
            input.text,
            embeddingLiteral,
            createdAt,
            isPaidDm,
            input.rawPayload ? JSON.stringify(input.rawPayload) : null,
          ],
        );

        const messageId = insert.rows[0].id;

        // Step 4: If we didn't find a cluster via trigram, try vector similarity
        if (!clusterId && !isPaidDm && embeddingLiteral) {
          const match = await client.query<MatchRow>(
            `
              SELECT
                m.id,
                cm.cluster_id,
                (1 - (m.embedding <=> $1)) AS similarity
              FROM messages m
              LEFT JOIN cluster_messages cm
                ON cm.message_id = m.id AND cm.excluded_at IS NULL
              LEFT JOIN clusters c
                ON c.id = cm.cluster_id
              WHERE m.creator_id = $2
                AND m.replied_at IS NULL
                AND m.is_paid_dm = false
                AND m.id <> $3
                AND m.embedding IS NOT NULL
                AND (c.status IS NULL OR c.status = 'open')
              ORDER BY m.embedding <=> $1
              LIMIT 1
            `,
            [embeddingLiteral, input.creatorId, messageId],
          );

          if (
            match.rowCount > 0 &&
            match.rows[0].similarity >= SIMILARITY_THRESHOLD
          ) {
            matchedMessageId = match.rows[0].id;
            similarity = Number(match.rows[0].similarity);
            if (match.rows[0].cluster_id) {
              clusterId = match.rows[0].cluster_id;
            } else {
              // Matched message not in cluster - create one and add both
              const clusterInsert = await client.query<{ id: string }>(
                `
                  INSERT INTO clusters (creator_id)
                  VALUES ($1)
                  RETURNING id
                `,
                [input.creatorId],
              );
              clusterId = clusterInsert.rows[0].id;
              await client.query(
                `
                  INSERT INTO cluster_messages (cluster_id, message_id)
                  VALUES ($1, $2)
                `,
                [clusterId, matchedMessageId],
              );
            }
          }
        }

        // Step 5: Create new cluster if still no cluster assigned
        if (!clusterId) {
          const clusterInsert = await client.query<{ id: string }>(
            `
              INSERT INTO clusters (creator_id)
              VALUES ($1)
              RETURNING id
            `,
            [input.creatorId],
          );
          clusterId = clusterInsert.rows[0].id;
        }

        // Step 6: Add message to cluster
        await client.query(
          `
            INSERT INTO cluster_messages (cluster_id, message_id)
            VALUES ($1, $2)
          `,
          [clusterId, messageId],
        );

        await client.query("COMMIT");
        return {
          skipped: false,
          messageId,
          clusterId: clusterId!, // Always assigned by Step 5
          matchedMessageId,
          similarity,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }
}
