import { Injectable } from "@nestjs/common";
import { DbService } from "../../db/db.service";
import { Cluster } from "./cluster.model";
import { ClusterStatus } from "./cluster-status.enum";
import { Message } from "../messages/message.model";

type ClusterRow = {
  id: string;
  creator_id: string;
  status: ClusterStatus;
  response_text: string | null;
  created_at: Date;
  updated_at: Date;
  channel_count: number;
  preview_text: string | null;
  representative_visitor: string | null;
  additional_visitor_count: number;
  visitor_avatar_urls: string[] | null;
};

type MessageRow = {
  id: string;
  external_message_id: string;
  creator_id: string;
  channel_id: string;
  channel_cid: string | null;
  visitor_user_id: string | null;
  visitor_username: string | null;
  text: string;
  created_at: Date;
  replied_at: Date | null;
  is_paid_dm: boolean;
  raw_payload: Record<string, unknown> | null;
};

@Injectable()
export class ClustersService {
  constructor(private db: DbService) {}

  async listClusters(
    creatorId: string,
    status?: ClusterStatus,
    minChannelCount?: number,
  ): Promise<Cluster[]> {
    const params: Array<string | ClusterStatus | number> = [creatorId];
    let statusFilter = "";
    let channelCountFilter = "";

    if (status) {
      params.push(status);
      statusFilter = `AND c.status = $${params.length}`;
    }

    if (minChannelCount !== undefined && minChannelCount > 0) {
      params.push(minChannelCount);
      channelCountFilter = `HAVING COUNT(DISTINCT m.channel_id) >= $${params.length}`;
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
          COUNT(DISTINCT m.channel_id)::int AS channel_count,
          -- TODO: Consider LLM-generated summary instead of earliest message text
          -- Could provide more representative preview (e.g., "3 people asking about pricing")
          (
            SELECT m2.text
            FROM cluster_messages cm2
            JOIN messages m2 ON m2.id = cm2.message_id
            WHERE cm2.cluster_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) AS preview_text,
          (
            SELECT m2.visitor_username
            FROM cluster_messages cm2
            JOIN messages m2 ON m2.id = cm2.message_id
            WHERE cm2.cluster_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) AS representative_visitor,
          (COUNT(DISTINCT m.visitor_user_id)::int - 1) AS additional_visitor_count,
          (
            SELECT array_agg(DISTINCT m2.raw_payload->'user'->>'image')
            FROM cluster_messages cm2
            JOIN messages m2 ON m2.id = cm2.message_id
            WHERE cm2.cluster_id = c.id
              AND m2.raw_payload->'user'->>'image' IS NOT NULL
          ) AS visitor_avatar_urls
        FROM clusters c
        LEFT JOIN cluster_messages cm
          ON cm.cluster_id = c.id
        LEFT JOIN messages m
          ON m.id = cm.message_id
        WHERE c.creator_id = $1
        ${statusFilter}
        GROUP BY c.id
        ${channelCountFilter}
        ORDER BY c.updated_at DESC
      `,
      params,
    );

    return result.rows.map((row: ClusterRow) => this.mapClusterRow(row));
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
          COUNT(DISTINCT m.channel_id)::int AS channel_count,
          -- TODO: Consider LLM-generated summary instead of earliest message text
          -- Could provide more representative preview (e.g., "3 people asking about pricing")
          (
            SELECT m2.text
            FROM cluster_messages cm2
            JOIN messages m2 ON m2.id = cm2.message_id
            WHERE cm2.cluster_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) AS preview_text,
          (
            SELECT m2.visitor_username
            FROM cluster_messages cm2
            JOIN messages m2 ON m2.id = cm2.message_id
            WHERE cm2.cluster_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
          ) AS representative_visitor,
          (COUNT(DISTINCT m.visitor_user_id)::int - 1) AS additional_visitor_count,
          (
            SELECT array_agg(DISTINCT m2.raw_payload->'user'->>'image')
            FROM cluster_messages cm2
            JOIN messages m2 ON m2.id = cm2.message_id
            WHERE cm2.cluster_id = c.id
              AND m2.raw_payload->'user'->>'image' IS NOT NULL
          ) AS visitor_avatar_urls
        FROM clusters c
        LEFT JOIN cluster_messages cm
          ON cm.cluster_id = c.id
        LEFT JOIN messages m
          ON m.id = cm.message_id
        WHERE c.id = $1
        GROUP BY c.id
      `,
      [id],
    );

    if (!clusterResult.rowCount || clusterResult.rowCount === 0) {
      throw new Error("Cluster not found");
    }

    const cluster = this.mapClusterRow(clusterResult.rows[0]);
    cluster.messages = await this.getClusterMessages(id);
    return cluster;
  }

  async getClusterMessages(clusterId: string): Promise<Message[]> {
    const messages = await this.db.query<MessageRow>(
      `
        SELECT m.*
        FROM messages m
        INNER JOIN cluster_messages cm
          ON cm.message_id = m.id
        WHERE cm.cluster_id = $1
        ORDER BY m.created_at ASC
      `,
      [clusterId],
    );

    return messages.rows.map((row: MessageRow) => this.mapMessageRow(row));
  }

  async actionCluster(
    id: string,
    responseText: string,
    channelIds: string[],
  ): Promise<Cluster> {
    if (!channelIds || channelIds.length === 0) {
      throw new Error("At least one channel must be selected");
    }

    await this.db.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        // 1. Get cluster info and earliest message embedding
        const clusterData = await client.query(
          `SELECT c.creator_id, m.embedding
           FROM clusters c
           JOIN cluster_messages cm ON c.id = cm.cluster_id
           JOIN messages m ON cm.message_id = m.id
           WHERE c.id = $1
           ORDER BY m.created_at ASC
           LIMIT 1`,
          [id],
        );

        if (!clusterData.rows[0]) {
          throw new Error("Cluster not found");
        }

        const { creator_id, embedding } = clusterData.rows[0];

        // 2. Check if this exact response template already exists
        const existingTemplate = await client.query(
          `SELECT id, usage_count 
           FROM response_templates 
           WHERE creator_id = $1 
             AND response_text = $2
             AND question_embedding = $3
           LIMIT 1`,
          [creator_id, responseText, embedding],
        );

        if (existingTemplate.rows.length > 0) {
          // Template exists - just increment usage count
          await client.query(
            `UPDATE response_templates 
             SET usage_count = usage_count + 1,
                 last_used_at = now()
             WHERE id = $1`,
            [existingTemplate.rows[0].id],
          );
        } else {
          // New template - insert it
          await client.query(
            `INSERT INTO response_templates (
              creator_id, 
              question_embedding, 
              response_text, 
              usage_count,
              last_used_at
            ) VALUES ($1, $2, $3, 1, now())`,
            [creator_id, embedding, responseText],
          );
        }

        // 3. Delete all messages in cluster (CASCADE handles cluster_messages)
        await client.query(
          `DELETE FROM messages 
           WHERE id IN (
             SELECT message_id 
             FROM cluster_messages 
             WHERE cluster_id = $1
           )`,
          [id],
        );

        // 4. Delete cluster
        await client.query(`DELETE FROM clusters WHERE id = $1`, [id]);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    // Return minimal representation since cluster is deleted
    return {
      id,
      creatorId: "", // Not needed in response
      status: ClusterStatus.Actioned,
      responseText,
      createdAt: new Date(),
      updatedAt: new Date(),
      channelCount: 0,
      previewText: undefined,
      representativeVisitor: undefined,
      additionalVisitorCount: 0,
      visitorAvatarUrls: undefined,
      messages: undefined,
    };
  }

  async deleteCluster(id: string): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        // Verify cluster exists
        const cluster = await client.query(
          `SELECT id FROM clusters WHERE id = $1`,
          [id],
        );

        if (!cluster.rows[0]) {
          throw new Error("Cluster not found");
        }

        // Delete all messages in cluster (CASCADE handles cluster_messages)
        await client.query(
          `DELETE FROM messages 
           WHERE id IN (
             SELECT message_id 
             FROM cluster_messages 
             WHERE cluster_id = $1
           )`,
          [id],
        );

        // Delete cluster
        await client.query(`DELETE FROM clusters WHERE id = $1`, [id]);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async removeClusterMessage(
    clusterId: string,
    messageId: string,
  ): Promise<Cluster | null> {
    let clusterDeleted = false;

    await this.db.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const deleted = await client.query(
          `
            DELETE FROM cluster_messages
            WHERE cluster_id = $1
              AND message_id = $2
          `,
          [clusterId, messageId],
        );

        if (!deleted.rowCount || deleted.rowCount === 0) {
          throw new Error("Message not found in cluster");
        }

        // Check if cluster is now empty and delete it
        const emptyCheck = await client.query(
          `
            SELECT EXISTS (
              SELECT 1 FROM cluster_messages WHERE cluster_id = $1
            ) AS has_messages
          `,
          [clusterId],
        );

        if (!emptyCheck.rows[0].has_messages) {
          // Cluster is empty - delete it
          await client.query(`DELETE FROM clusters WHERE id = $1`, [clusterId]);
          clusterDeleted = true;
        } else {
          // Cluster still has messages - update timestamp
          await client.query(
            `
              UPDATE clusters
              SET updated_at = now()
              WHERE id = $1
            `,
            [clusterId],
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    if (clusterDeleted) {
      return null;
    }

    return this.getCluster(clusterId);
  }

  async getSuggestedResponses(
    clusterId: string,
    creatorId: string,
  ): Promise<Array<{ text: string; similarity: number }>> {
    // Get cluster's earliest message embedding
    const result = await this.db.query<{ embedding: string }>(
      `SELECT m.embedding
       FROM cluster_messages cm
       JOIN messages m ON cm.message_id = m.id
       WHERE cm.cluster_id = $1
       ORDER BY m.created_at ASC
       LIMIT 1`,
      [clusterId],
    );

    if (!result.rows[0]?.embedding) {
      return [];
    }

    const embedding = result.rows[0].embedding;

    // Find top 3 most similar past responses (similarity > 0.8)
    const suggestions = await this.db.query<{
      response_text: string;
      similarity: number;
    }>(
      `SELECT response_text,
              (1 - (question_embedding <=> $1)) as similarity
       FROM response_templates
       WHERE creator_id = $2
         AND (1 - (question_embedding <=> $1)) > 0.8
       ORDER BY
         similarity DESC,
         usage_count DESC,
         last_used_at DESC
       LIMIT 3`,
      [embedding, creatorId],
    );

    return suggestions.rows.map((row) => ({
      text: row.response_text,
      similarity: Number(row.similarity.toFixed(3)),
    }));
  }

  private mapClusterRow(row: ClusterRow): Cluster {
    return {
      id: row.id,
      creatorId: row.creator_id,
      status: row.status,
      responseText: row.response_text || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      channelCount: row.channel_count || 0,
      previewText: row.preview_text || undefined,
      representativeVisitor: row.representative_visitor || undefined,
      additionalVisitorCount: Math.max(0, row.additional_visitor_count || 0),
      visitorAvatarUrls: row.visitor_avatar_urls || undefined,
      messages: undefined,
    };
  }

  private mapMessageRow(row: MessageRow): Message {
    // Extract avatar URL from rawPayload.user.image
    const avatarUrl = (row.raw_payload as { user?: { image?: string } })?.user
      ?.image;

    return {
      id: row.id,
      externalMessageId: row.external_message_id,
      creatorId: row.creator_id,
      channelId: row.channel_id,
      channelCid: row.channel_cid || undefined,
      visitorUserId: row.visitor_user_id || undefined,
      visitorUsername: row.visitor_username || undefined,
      visitorAvatarUrl: avatarUrl || undefined,
      text: row.text,
      createdAt: row.created_at,
      repliedAt: row.replied_at || undefined,
      isPaidDm: row.is_paid_dm,
      rawPayload: row.raw_payload || undefined,
    };
  }
}
