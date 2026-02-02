import { gql } from "@apollo/client";

export const INGEST_MESSAGE = gql`
  mutation IngestMessage($input: IngestMessageInput!) {
    ingestMessage(input: $input) {
      messageId
      clusterId
    }
  }
`;

export const ACTION_CLUSTER = gql`
  mutation ActionCluster(
    $id: ID!
    $responseText: String!
    $channelIds: [String!]!
  ) {
    actionCluster(
      id: $id
      responseText: $responseText
      channelIds: $channelIds
    ) {
      id
      status
    }
  }
`;

export const REMOVE_MESSAGE = gql`
  mutation RemoveMessage($clusterId: ID!, $messageId: ID!) {
    removeClusterMessage(clusterId: $clusterId, messageId: $messageId) {
      id
      channelCount
    }
  }
`;

export const DELETE_CLUSTER = gql`
  mutation DeleteCluster($id: ID!) {
    deleteCluster(id: $id)
  }
`;
