import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DbService } from '../../db/db.service'
import { toVectorLiteral } from '../../db/vector'
import { EmbeddingsService } from '../embeddings/embeddings.service'
import { IngestMessageInput } from './ingest-message.input'
import { IngestResult } from './ingest-result.model'

type MatchRow = {
  id: string
  cluster_id: string | null
  similarity: number
}

@Injectable()
export class MessagesService {
  constructor(
    private db: DbService,
    private embeddings: EmbeddingsService,
    private config: ConfigService
  ) {}

  async ingestMessage(input: IngestMessageInput): Promise<IngestResult> {
    const embedding = await this.embeddings.embed(input.text)
    const embeddingLiteral = toVectorLiteral(embedding)
    const similarityThreshold = Number(this.config.get<string>('SIMILARITY_THRESHOLD') || 0.9)
    const isPaidDm = input.isPaidDm === true
    const createdAt = input.createdAt || new Date()

    return this.db.withClient(async (client) => {
      await client.query('BEGIN')
      try {
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
              html,
              message_type,
              embedding,
              created_at,
              is_paid_dm
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
            input.html || null,
            input.messageType || null,
            embeddingLiteral,
            createdAt,
            isPaidDm
          ]
        )

        const messageId = insert.rows[0].id

        let matchedMessageId: string | undefined
        let similarity: number | undefined
        let clusterId: string

        if (!isPaidDm) {
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
                AND (c.status IS NULL OR c.status = 'open')
              ORDER BY m.embedding <=> $1
              LIMIT 1
            `,
            [embeddingLiteral, input.creatorId, messageId]
          )

          if (match.rowCount > 0 && match.rows[0].similarity >= similarityThreshold) {
            matchedMessageId = match.rows[0].id
            similarity = Number(match.rows[0].similarity)
            if (match.rows[0].cluster_id) {
              clusterId = match.rows[0].cluster_id
            } else {
              const clusterInsert = await client.query<{ id: string }>(
                `
                  INSERT INTO clusters (creator_id)
                  VALUES ($1)
                  RETURNING id
                `,
                [input.creatorId]
              )
              clusterId = clusterInsert.rows[0].id
              await client.query(
                `
                  INSERT INTO cluster_messages (cluster_id, message_id)
                  VALUES ($1, $2)
                `,
                [clusterId, matchedMessageId]
              )
            }
          } else {
            const clusterInsert = await client.query<{ id: string }>(
              `
                INSERT INTO clusters (creator_id)
                VALUES ($1)
                RETURNING id
              `,
              [input.creatorId]
            )
            clusterId = clusterInsert.rows[0].id
          }
        } else {
          const clusterInsert = await client.query<{ id: string }>(
            `
              INSERT INTO clusters (creator_id)
              VALUES ($1)
              RETURNING id
            `,
            [input.creatorId]
          )
          clusterId = clusterInsert.rows[0].id
        }

        await client.query(
          `
            INSERT INTO cluster_messages (cluster_id, message_id)
            VALUES ($1, $2)
          `,
          [clusterId, messageId]
        )

        await client.query('COMMIT')
        return {
          messageId,
          clusterId,
          matchedMessageId,
          similarity
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    })
  }
}
