import { Injectable } from '@nestjs/common'
import { DbService } from '../../db/db.service'
import { Cluster } from './cluster.model'
import { ClusterStatus } from './cluster-status.enum'
import { Message } from '../messages/message.model'

type ClusterRow = {
  id: string
  creator_id: string
  status: ClusterStatus
  response_text: string | null
  created_at: Date
  updated_at: Date
  message_count: number
}

type MessageRow = {
  id: string
  external_message_id: string
  creator_id: string
  channel_id: string
  channel_cid: string | null
  visitor_user_id: string | null
  visitor_username: string | null
  text: string
  html: string | null
  message_type: string | null
  created_at: Date
  replied_at: Date | null
  is_paid_dm: boolean
}

@Injectable()
export class ClustersService {
  constructor(private db: DbService) {}

  async listClusters(creatorId: string, status?: ClusterStatus): Promise<Cluster[]> {
    const params: Array<string | ClusterStatus> = [creatorId]
    let statusFilter = ''
    if (status) {
      params.push(status)
      statusFilter = `AND c.status = $${params.length}`
    }

    const result = await this.db.query<ClusterRow>(
      `
        SELECT
          c.id,
          c.creator_id,
          c.status,
          c.response_text,
          c.created_at,
          c.updated_at,
          COUNT(cm.message_id)::int AS message_count
        FROM clusters c
        LEFT JOIN cluster_messages cm
          ON cm.cluster_id = c.id AND cm.excluded_at IS NULL
        WHERE c.creator_id = $1
        ${statusFilter}
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `,
      params
    )

    return result.rows.map((row) => this.mapClusterRow(row))
  }

  async getCluster(id: string): Promise<Cluster> {
    const clusterResult = await this.db.query<ClusterRow>(
      `
        SELECT
          c.id,
          c.creator_id,
          c.status,
          c.response_text,
          c.created_at,
          c.updated_at,
          COUNT(cm.message_id)::int AS message_count
        FROM clusters c
        LEFT JOIN cluster_messages cm
          ON cm.cluster_id = c.id AND cm.excluded_at IS NULL
        WHERE c.id = $1
        GROUP BY c.id
      `,
      [id]
    )

    if (clusterResult.rowCount === 0) {
      throw new Error('Cluster not found')
    }

    const cluster = this.mapClusterRow(clusterResult.rows[0])
    cluster.messages = await this.getClusterMessages(id)
    return cluster
  }

  async getClusterMessages(clusterId: string): Promise<Message[]> {
    const messages = await this.db.query<MessageRow>(
      `
        SELECT m.*
        FROM messages m
        INNER JOIN cluster_messages cm
          ON cm.message_id = m.id
        WHERE cm.cluster_id = $1
          AND cm.excluded_at IS NULL
        ORDER BY m.created_at ASC
      `,
      [clusterId]
    )

    return messages.rows.map((row) => this.mapMessageRow(row))
  }

  async actionCluster(id: string, responseText: string): Promise<Cluster> {
    await this.db.withClient(async (client) => {
      await client.query('BEGIN')
      try {
        const update = await client.query(
          `
            UPDATE clusters
            SET status = $2,
                response_text = $3,
                updated_at = now()
            WHERE id = $1
          `,
          [id, ClusterStatus.Actioned, responseText]
        )

        if (update.rowCount === 0) {
          throw new Error('Cluster not found')
        }

        await client.query(
          `
            UPDATE messages
            SET replied_at = now()
            WHERE id IN (
              SELECT message_id
              FROM cluster_messages
              WHERE cluster_id = $1
                AND excluded_at IS NULL
            )
          `,
          [id]
        )

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    })

    return this.getCluster(id)
  }

  async removeClusterMessage(clusterId: string, messageId: string): Promise<Cluster> {
    await this.db.withClient(async (client) => {
      await client.query('BEGIN')
      try {
        const update = await client.query(
          `
            UPDATE cluster_messages
            SET excluded_at = now()
            WHERE cluster_id = $1
              AND message_id = $2
              AND excluded_at IS NULL
          `,
          [clusterId, messageId]
        )

        if (update.rowCount === 0) {
          throw new Error('Message not found in cluster')
        }

        await client.query(
          `
            UPDATE clusters
            SET updated_at = now()
            WHERE id = $1
          `,
          [clusterId]
        )

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    })

    return this.getCluster(clusterId)
  }

  private mapClusterRow(row: ClusterRow): Cluster {
    return {
      id: row.id,
      creatorId: row.creator_id,
      status: row.status,
      responseText: row.response_text || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      messages: undefined
    }
  }

  private mapMessageRow(row: MessageRow): Message {
    return {
      id: row.id,
      externalMessageId: row.external_message_id,
      creatorId: row.creator_id,
      channelId: row.channel_id,
      channelCid: row.channel_cid || undefined,
      visitorUserId: row.visitor_user_id || undefined,
      visitorUsername: row.visitor_username || undefined,
      text: row.text,
      html: row.html || undefined,
      messageType: row.message_type || undefined,
      createdAt: row.created_at,
      repliedAt: row.replied_at || undefined,
      isPaidDm: row.is_paid_dm
    }
  }
}
