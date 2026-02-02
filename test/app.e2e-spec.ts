import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DbService } from "../src/db/db.service";

describe("Similarity Buckets E2E", () => {
  let app: INestApplication;
  let dbService: DbService;

  const CREATOR_ID = "00000000-0000-4000-a000-000000000001";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    dbService = moduleFixture.get<DbService>(DbService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await dbService.query(`DELETE FROM clusters WHERE creator_id = $1`, [
      CREATOR_ID,
    ]);
    await dbService.query(`DELETE FROM messages WHERE creator_id = $1`, [
      CREATOR_ID,
    ]);
    await dbService.query(
      `DELETE FROM response_templates WHERE creator_id = $1`,
      [CREATOR_ID],
    );
  });

  const gql = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/graphql").send({ query, variables });

  describe("Message Ingestion", () => {
    it("should create a new cluster for first message", async () => {
      const res = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) {
            messageId
            clusterId
            matchedMessageId
            similarity
          }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-1",
            text: "How much do you charge for a collaboration?",
            channelId: "channel-1",
            channelCid: "messaging:channel-1",
            visitorUserId: "visitor-1",
            visitorUsername: "Jane Ray",
            createdAt: new Date().toISOString(),
            isPaidDm: false,
            rawPayload: {
              user: {
                id: "visitor-1",
                name: "Jane Ray",
                image: "https://example.com/jane.jpg",
              },
            },
          },
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.ingestMessage.messageId).toBeDefined();
      expect(res.body.data.ingestMessage.clusterId).toBeDefined();
      expect(res.body.data.ingestMessage.matchedMessageId).toBeNull();
      expect(res.body.data.ingestMessage.similarity).toBeNull();
    });

    it("should match similar messages to same cluster (trigram match)", async () => {
      // First message
      const first = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { messageId clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-1",
            text: "How much do you charge for a collaboration?",
            channelId: "channel-1",
            visitorUserId: "visitor-1",
            visitorUsername: "Jane Ray",
            createdAt: new Date().toISOString(),
            rawPayload: { user: { image: "https://example.com/jane.jpg" } },
          },
        },
      );

      const clusterId = first.body.data.ingestMessage.clusterId;

      // Near-identical message from different channel (will trigger trigram match)
      const second = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { messageId clusterId matchedMessageId similarity }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-2",
            text: "How much do you charge for a collaboration?", // Same text = trigram match
            channelId: "channel-2",
            visitorUserId: "visitor-2",
            visitorUsername: "Bob Smith",
            createdAt: new Date().toISOString(),
            rawPayload: { user: { image: "https://example.com/bob.jpg" } },
          },
        },
      );

      expect(second.body.errors).toBeUndefined();
      expect(second.body.data.ingestMessage.clusterId).toBe(clusterId);
      expect(second.body.data.ingestMessage.matchedMessageId).toBeDefined();
      expect(second.body.data.ingestMessage.similarity).toBeGreaterThan(0.85);
    });

    it("should supersede old message from same channel within a cluster", async () => {
      // First message
      const first = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { messageId clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-1",
            text: "How much do you charge for collaborations?",
            channelId: "channel-1",
            visitorUserId: "visitor-1",
            visitorUsername: "Jane",
            createdAt: new Date().toISOString(),
          },
        },
      );
      const clusterId = first.body.data.ingestMessage.clusterId;

      // Second message from different channel (same text triggers cluster match)
      await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { messageId clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-2",
            text: "How much do you charge for collaborations?",
            channelId: "channel-2",
            visitorUserId: "visitor-2",
            visitorUsername: "Bob",
            createdAt: new Date().toISOString(),
          },
        },
      );

      // Third message from channel-1 (supersedes first message)
      const third = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { messageId clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-3",
            text: "How much do you charge for collaborations?", // Same text to join same cluster
            channelId: "channel-1", // Same channel as first message
            visitorUserId: "visitor-1",
            visitorUsername: "Jane",
            createdAt: new Date().toISOString(),
          },
        },
      );

      expect(third.body.errors).toBeUndefined();
      expect(third.body.data.ingestMessage.clusterId).toBe(clusterId);

      // Cluster should still have 2 channels (message 1 superseded by message 3)
      const detail = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { id channelCount messages { id channelId } }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );

      expect(detail.body.data.cluster.channelCount).toBe(2);
      expect(detail.body.data.cluster.messages.length).toBe(2);

      // Verify the messages are from different channels
      const channelIds = detail.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );
      expect(channelIds).toContain("channel-1");
      expect(channelIds).toContain("channel-2");
    });
  });

  describe("Cluster Queries", () => {
    let clusterId: string;

    beforeEach(async () => {
      // Ingest two messages with same text (triggers trigram match)
      const first = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-1",
            text: "What is your collaboration rate?",
            channelId: "channel-1",
            visitorUserId: "visitor-1",
            visitorUsername: "Jane Ray",
            createdAt: new Date().toISOString(),
            rawPayload: { user: { image: "https://example.com/jane.jpg" } },
          },
        },
      );
      clusterId = first.body.data.ingestMessage.clusterId;

      await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-2",
            text: "What is your collaboration rate?", // Same text for trigram match
            channelId: "channel-2",
            visitorUserId: "visitor-2",
            visitorUsername: "Bob Smith",
            createdAt: new Date().toISOString(),
            rawPayload: { user: { image: "https://example.com/bob.jpg" } },
          },
        },
      );
    });

    it("should list clusters with UI fields", async () => {
      const res = await gql(
        `query ListClusters($creatorId: ID!) {
          clusters(creatorId: $creatorId) {
            id
            status
            channelCount
            previewText
            representativeVisitor
            additionalVisitorCount
            visitorAvatarUrls
            createdAt
          }
        }`,
        { creatorId: CREATOR_ID },
      );

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.clusters.length).toBe(1);

      const cluster = res.body.data.clusters[0];
      expect(cluster.status).toBe("Open");
      expect(cluster.channelCount).toBe(2);
      expect(cluster.previewText).toContain("collaboration");
      expect(cluster.representativeVisitor).toBe("Jane Ray");
      expect(cluster.additionalVisitorCount).toBe(1);
      expect(cluster.visitorAvatarUrls).toContain(
        "https://example.com/jane.jpg",
      );
      expect(cluster.visitorAvatarUrls).toContain(
        "https://example.com/bob.jpg",
      );
    });

    it("should filter clusters by minChannelCount", async () => {
      // This cluster has 2 channels
      const with2 = await gql(
        `query ListClusters($creatorId: ID!, $minChannelCount: Float) {
          clusters(creatorId: $creatorId, minChannelCount: $minChannelCount) {
            id
            channelCount
          }
        }`,
        { creatorId: CREATOR_ID, minChannelCount: 2 },
      );

      expect(with2.body.data.clusters.length).toBe(1);
      expect(with2.body.data.clusters[0].channelCount).toBe(2);

      // Filter for 3+ channels - should be empty
      const with3 = await gql(
        `query ListClusters($creatorId: ID!, $minChannelCount: Float) {
          clusters(creatorId: $creatorId, minChannelCount: $minChannelCount) {
            id
          }
        }`,
        { creatorId: CREATOR_ID, minChannelCount: 3 },
      );

      expect(with3.body.data.clusters.length).toBe(0);
    });

    it("should get cluster detail with messages", async () => {
      const res = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) {
            id
            status
            channelCount
            messages {
              id
              text
              visitorUsername
              visitorAvatarUrl
            }
          }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.cluster.channelCount).toBe(2);
      expect(res.body.data.cluster.messages.length).toBe(2);

      const jane = res.body.data.cluster.messages.find(
        (m: { visitorUsername: string }) => m.visitorUsername === "Jane Ray",
      );
      expect(jane).toBeDefined();
      expect(jane.visitorAvatarUrl).toBe("https://example.com/jane.jpg");
    });
  });

  describe("Cluster Mutations", () => {
    let clusterId: string;
    let messageId1: string;
    let messageId2: string;

    beforeEach(async () => {
      const first = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { messageId clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-1",
            text: "What is your collaboration rate?",
            channelId: "channel-1",
            visitorUserId: "visitor-1",
            visitorUsername: "Jane",
            createdAt: new Date().toISOString(),
          },
        },
      );
      clusterId = first.body.data.ingestMessage.clusterId;
      messageId1 = first.body.data.ingestMessage.messageId;

      const second = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { messageId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-2",
            text: "What is your collaboration rate?", // Same text for trigram match
            channelId: "channel-2",
            visitorUserId: "visitor-2",
            visitorUsername: "Bob",
            createdAt: new Date().toISOString(),
          },
        },
      );
      messageId2 = second.body.data.ingestMessage.messageId;
    });

    it("should remove message from cluster", async () => {
      const res = await gql(
        `mutation RemoveMessage($clusterId: ID!, $messageId: ID!) {
          removeClusterMessage(clusterId: $clusterId, messageId: $messageId) {
            id
            channelCount
          }
        }`,
        { clusterId, messageId: messageId2 },
      );

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.removeClusterMessage.channelCount).toBe(1);
    });

    it("should auto-delete cluster when last message removed", async () => {
      // Remove first message
      await gql(
        `mutation RemoveMessage($clusterId: ID!, $messageId: ID!) {
          removeClusterMessage(clusterId: $clusterId, messageId: $messageId) {
            id
          }
        }`,
        { clusterId, messageId: messageId1 },
      );

      // Remove second (last) message - cluster should be deleted
      const res = await gql(
        `mutation RemoveMessage($clusterId: ID!, $messageId: ID!) {
          removeClusterMessage(clusterId: $clusterId, messageId: $messageId) {
            id
          }
        }`,
        { clusterId, messageId: messageId2 },
      );

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.removeClusterMessage).toBeNull();

      // Verify cluster no longer exists
      const list = await gql(
        `query ListClusters($creatorId: ID!) {
          clusters(creatorId: $creatorId) { id }
        }`,
        { creatorId: CREATOR_ID },
      );

      expect(list.body.data.clusters.length).toBe(0);
    });

    it("should action cluster and set status", async () => {
      // First get the channel IDs from the cluster
      const clusterDetail = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { messages { channelId } }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );
      const channelIds = clusterDetail.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );

      const res = await gql(
        `mutation Action($clusterId: ID!, $response: String!, $channelIds: [String!]!) {
          actionCluster(id: $clusterId, responseText: $response, channelIds: $channelIds) {
            id
            status
            responseText
          }
        }`,
        {
          clusterId,
          response: "Thanks for reaching out! My rate is $500.",
          channelIds,
        },
      );

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.actionCluster.status).toBe("Actioned");
      expect(res.body.data.actionCluster.responseText).toBe(
        "Thanks for reaching out! My rate is $500.",
      );

      // After actioning all messages, cluster is deleted (channelCount becomes 0)
      // Verify we can't fetch it anymore
      const detail = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { messages { id } }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );

      expect(detail.body.errors).toBeDefined();
      expect(detail.body.errors[0].message).toContain("Cluster not found");
    });

    it("should filter clusters by status", async () => {
      // Get channel IDs first
      const clusterDetail = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { messages { channelId } }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );
      const channelIds = clusterDetail.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );

      // Action the cluster
      await gql(
        `mutation Action($clusterId: ID!, $response: String!, $channelIds: [String!]!) {
          actionCluster(id: $clusterId, responseText: $response, channelIds: $channelIds) { id }
        }`,
        { clusterId, response: "Done!", channelIds },
      );

      // Open clusters should be empty
      const open = await gql(
        `query ListClusters($creatorId: ID!, $status: ClusterStatus) {
          clusters(creatorId: $creatorId, status: $status) { id }
        }`,
        { creatorId: CREATOR_ID, status: "Open" },
      );
      expect(open.body.data.clusters.length).toBe(0);

      // Actioned clusters should also be empty (cluster was deleted after all messages actioned)
      const actioned = await gql(
        `query ListClusters($creatorId: ID!, $status: ClusterStatus) {
          clusters(creatorId: $creatorId, status: $status) { id }
        }`,
        { creatorId: CREATOR_ID, status: "Actioned" },
      );
      expect(actioned.body.data.clusters.length).toBe(0);
    });

    it("should delete messages and cluster after actioning", async () => {
      // Get cluster details first
      const clusterDetail = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { 
            messages { 
              id
              channelId 
            } 
          }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );
      const messageIds = clusterDetail.body.data.cluster.messages.map(
        (m: { id: string }) => m.id,
      );
      const channelIds = clusterDetail.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );

      // Action the cluster
      await gql(
        `mutation Action($clusterId: ID!, $response: String!, $channelIds: [String!]!) {
          actionCluster(id: $clusterId, responseText: $response, channelIds: $channelIds) { id }
        }`,
        { clusterId, response: "Test response", channelIds },
      );

      // Verify messages were deleted
      const messagesCheck = await dbService.query(
        `SELECT COUNT(*) as count FROM messages WHERE id = ANY($1)`,
        [messageIds],
      );
      expect(Number(messagesCheck.rows[0].count)).toBe(0);

      // Verify cluster was deleted
      const clusterCheck = await dbService.query(
        `SELECT COUNT(*) as count FROM clusters WHERE id = $1`,
        [clusterId],
      );
      expect(Number(clusterCheck.rows[0].count)).toBe(0);
    });

    it("should save response template when actioning cluster", async () => {
      // Get channel IDs first
      const clusterDetail = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { 
            messages { channelId } 
          }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );
      const channelIds = clusterDetail.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );

      // Action cluster with response
      await gql(
        `mutation Action($clusterId: ID!, $response: String!, $channelIds: [String!]!) {
          actionCluster(id: $clusterId, responseText: $response, channelIds: $channelIds) { id }
        }`,
        {
          clusterId,
          response: "Check my pricing page at example.com/pricing",
          channelIds,
        },
      );

      // Verify response template was created
      const template = await dbService.query(
        `SELECT * FROM response_templates WHERE creator_id = $1`,
        [CREATOR_ID],
      );
      expect(template.rows.length).toBeGreaterThan(0);
      expect(template.rows[0].response_text).toBe(
        "Check my pricing page at example.com/pricing",
      );
      expect(template.rows[0].usage_count).toBe(1);
    });

    it("should suggest response for similar cluster", async () => {
      // Action first cluster to create template
      const clusterDetail1 = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { 
            messages { channelId } 
          }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );
      const channelIds1 = clusterDetail1.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );

      await gql(
        `mutation Action($clusterId: ID!, $response: String!, $channelIds: [String!]!) {
          actionCluster(id: $clusterId, responseText: $response, channelIds: $channelIds) { id }
        }`,
        {
          clusterId,
          response: "My rates are on my website!",
          channelIds: channelIds1,
        },
      );

      // Create new cluster with EXACT same text (stub embeddings need exact match)
      const msg3 = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-3",
            text: "What is your collaboration rate?", // Exact same text as original
            channelId: "channel-3",
            visitorUserId: "visitor-3",
            visitorUsername: "Alice",
            createdAt: new Date().toISOString(),
            rawPayload: { user: { image: "https://example.com/alice.jpg" } },
          },
        },
      );
      const newClusterId = msg3.body.data.ingestMessage.clusterId;

      // Fetch new cluster - should have suggested responses
      const newCluster = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { 
            suggestedResponses {
              text
              similarity
            }
          }
        }`,
        { clusterId: newClusterId, creatorId: CREATOR_ID },
      );

      // With stub embeddings, we need identical text for high similarity
      // Should find the suggestion as the first result
      expect(newCluster.body.data.cluster.suggestedResponses).toBeDefined();
      expect(
        newCluster.body.data.cluster.suggestedResponses.length,
      ).toBeGreaterThan(0);
      expect(newCluster.body.data.cluster.suggestedResponses[0].text).toBe(
        "My rates are on my website!",
      );
      expect(
        newCluster.body.data.cluster.suggestedResponses[0].similarity,
      ).toBeGreaterThan(0.8);
    });

    it("should not create duplicate templates when reusing suggested response", async () => {
      // Action first cluster to create initial template
      const clusterDetail1 = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { 
            messages { channelId } 
          }
        }`,
        { clusterId, creatorId: CREATOR_ID },
      );
      const channelIds1 = clusterDetail1.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );

      await gql(
        `mutation Action($clusterId: ID!, $response: String!, $channelIds: [String!]!) {
          actionCluster(id: $clusterId, responseText: $response, channelIds: $channelIds) { id }
        }`,
        {
          clusterId,
          response: "Check my website for rates",
          channelIds: channelIds1,
        },
      );

      // Verify one template was created
      const templatesAfterFirst = await dbService.query(
        `SELECT * FROM response_templates WHERE creator_id = $1 AND response_text = $2`,
        [CREATOR_ID, "Check my website for rates"],
      );
      expect(templatesAfterFirst.rows.length).toBe(1);
      expect(templatesAfterFirst.rows[0].usage_count).toBe(1);

      // Create second cluster with same text
      await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-4",
            text: "What is your collaboration rate?",
            channelId: "channel-4",
            visitorUserId: "visitor-4",
            visitorUsername: "Dave",
            createdAt: new Date().toISOString(),
            rawPayload: { user: { image: "https://example.com/dave.jpg" } },
          },
        },
      );

      const msg5 = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-5",
            text: "What is your collaboration rate?",
            channelId: "channel-5",
            visitorUserId: "visitor-5",
            visitorUsername: "Eve",
            createdAt: new Date().toISOString(),
            rawPayload: { user: { image: "https://example.com/eve.jpg" } },
          },
        },
      );
      const cluster2Id = msg5.body.data.ingestMessage.clusterId;

      // Get cluster and action with the SAME response text
      const cluster2Detail = await gql(
        `query ClusterDetail($clusterId: ID!, $creatorId: String!) {
          cluster(id: $clusterId, creatorId: $creatorId) { 
            messages { channelId }
          }
        }`,
        { clusterId: cluster2Id, creatorId: CREATOR_ID },
      );
      const channelIds2 = cluster2Detail.body.data.cluster.messages.map(
        (m: { channelId: string }) => m.channelId,
      );

      await gql(
        `mutation Action($clusterId: ID!, $response: String!, $channelIds: [String!]!) {
          actionCluster(id: $clusterId, responseText: $response, channelIds: $channelIds) { id }
        }`,
        {
          clusterId: cluster2Id,
          response: "Check my website for rates", // Same as before
          channelIds: channelIds2,
        },
      );

      // Should still be only ONE template, but usage_count incremented
      const templatesAfterSecond = await dbService.query(
        `SELECT * FROM response_templates WHERE creator_id = $1 AND response_text = $2`,
        [CREATOR_ID, "Check my website for rates"],
      );
      expect(templatesAfterSecond.rows.length).toBe(1); // No duplicate
      expect(templatesAfterSecond.rows[0].usage_count).toBe(2); // Incremented
    });
  });

  describe("Paid DM Exclusion", () => {
    it("should not cluster paid DMs with similar free messages", async () => {
      // Regular message
      const regular = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-1",
            text: "What is your rate?",
            channelId: "channel-1",
            visitorUserId: "visitor-1",
            visitorUsername: "Jane",
            createdAt: new Date().toISOString(),
            isPaidDm: false,
          },
        },
      );
      const regularClusterId = regular.body.data.ingestMessage.clusterId;

      // Paid DM with similar text
      const paid = await gql(
        `mutation Ingest($input: IngestMessageInput!) {
          ingestMessage(input: $input) { clusterId }
        }`,
        {
          input: {
            creatorId: CREATOR_ID,
            messageId: "ext-msg-2",
            text: "What is your rate?",
            channelId: "channel-2",
            visitorUserId: "visitor-2",
            visitorUsername: "Bob",
            createdAt: new Date().toISOString(),
            isPaidDm: true,
          },
        },
      );
      const paidClusterId = paid.body.data.ingestMessage.clusterId;

      // Should be in different clusters
      expect(paidClusterId).not.toBe(regularClusterId);
    });
  });
});
