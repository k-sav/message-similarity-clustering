import { gql } from "@apollo/client";

export const LIST_CLUSTERS = gql`
  query ListClusters(
    $creatorId: ID!
    $status: ClusterStatus
    $minChannelCount: Float
  ) {
    clusters(
      creatorId: $creatorId
      status: $status
      minChannelCount: $minChannelCount
    ) {
      id
      status
      channelCount
      previewText
      representativeVisitor
      additionalVisitorCount
      visitorAvatarUrls
      createdAt
    }
  }
`;

export const GET_CLUSTER = gql`
  query GetCluster($id: ID!, $creatorId: String!) {
    cluster(id: $id, creatorId: $creatorId) {
      id
      status
      responseText
      channelCount
      previewText
      representativeVisitor
      additionalVisitorCount
      visitorAvatarUrls
      suggestedResponses {
        text
        similarity
      }
      messages {
        id
        text
        visitorUsername
        visitorAvatarUrl
        createdAt
        channelId
      }
    }
  }
`;
