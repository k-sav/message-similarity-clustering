import { useState } from "react";
import { useQuery, useMutation } from "@apollo/client/react";
import { GET_CLUSTER, LIST_CLUSTERS } from "../graphql/queries";
import { ACTION_CLUSTER, REMOVE_MESSAGE } from "../graphql/mutations";
import MessageCard from "./MessageCard";
import type { Message, Cluster } from "../types";

const CREATOR_ID = "00000000-0000-4000-a000-000000000001";

interface ClusterDetailProps {
  clusterId: string;
}

interface GetClusterData {
  cluster: Cluster;
}

export default function ClusterDetail({ clusterId }: ClusterDetailProps) {
  const [responseText, setResponseText] = useState("");

  const { loading, error, data, refetch } = useQuery<GetClusterData>(
    GET_CLUSTER,
    {
      variables: { id: clusterId },
    },
  );

  const [actionCluster, { loading: actionLoading }] = useMutation(
    ACTION_CLUSTER,
    {
      refetchQueries: [
        {
          query: LIST_CLUSTERS,
          variables: {
            creatorId: CREATOR_ID,
            status: "Open",
            minChannelCount: 2,
          },
        },
      ],
    },
  );

  const [removeMessage] = useMutation(REMOVE_MESSAGE, {
    onCompleted: () => {
      refetch();
    },
    refetchQueries: [
      {
        query: LIST_CLUSTERS,
        variables: {
          creatorId: CREATOR_ID,
          status: "Open",
          minChannelCount: 2,
        },
      },
    ],
  });

  if (loading) return <div className="p-4 text-gray-500">Loading...</div>;
  if (error)
    return <div className="p-4 text-red-500">Error: {error.message}</div>;

  const cluster = data?.cluster;
  if (!cluster)
    return <div className="p-4 text-gray-500">Cluster not found</div>;

  const handleRemoveMessage = async (messageId: string) => {
    try {
      await removeMessage({
        variables: {
          clusterId,
          messageId,
        },
      });
    } catch (err) {
      console.error("Error removing message:", err);
    }
  };

  const handleActionCluster = async () => {
    if (!responseText.trim()) {
      alert("Please enter a response");
      return;
    }

    try {
      await actionCluster({
        variables: {
          id: clusterId,
          responseText: responseText.trim(),
        },
      });
      setResponseText("");
      alert("Bulk reply sent successfully!");
      // Deselect cluster after action
      window.location.reload();
    } catch (err) {
      console.error("Error actioning cluster:", err);
      alert("Failed to send bulk reply");
    }
  };

  const messageCount = cluster.messages?.length || 0;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header with avatars */}
      <div className="px-6 py-6 bg-white border-b">
        <div className="flex items-center gap-3">
          {cluster.visitorAvatarUrls?.slice(0, 3).map((url, idx) => (
            <div
              key={idx}
              className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden border-2 border-white shadow-sm"
              style={{ marginLeft: idx > 0 ? "-12px" : "0", zIndex: 3 - idx }}
            >
              {url ? (
                <img src={url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                  ?
                </div>
              )}
            </div>
          ))}
          <div>
            <h2 className="text-base font-semibold">
              {cluster.representativeVisitor || "Unknown"} +{" "}
              {cluster.additionalVisitorCount || 0} more
            </h2>
          </div>
        </div>
      </div>

      {/* Cluster summary badge */}
      <div className="px-6 py-4 bg-purple-50 border-b">
        <div className="flex items-center gap-2 mb-3">
          <svg
            className="w-4 h-4 text-purple-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          <span className="text-sm font-medium text-purple-900">
            Similar topic detected
          </span>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">
          {cluster.previewText ||
            "These messages appear to be asking similar questions about pricing and collaboration rates."}
        </p>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1 bg-white">
        {messageCount === 0 ? (
          <div className="text-center text-gray-500 py-8">No messages</div>
        ) : (
          cluster.messages?.map((message: Message) => (
            <MessageCard
              key={message.id}
              message={message}
              onRemove={handleRemoveMessage}
            />
          ))
        )}
      </div>

      {/* Reply input */}
      {messageCount > 0 && (
        <div className="border-t bg-white px-6 py-4">
          <div className="flex gap-3 items-center">
            <button className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
            <input
              type="text"
              placeholder={`Reply to ${messageCount} ${messageCount === 1 ? "message" : "messages"}`}
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !actionLoading) {
                  handleActionCluster();
                }
              }}
              className="flex-1 px-4 py-2.5 bg-gray-50 border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
              disabled={actionLoading}
            />
            <button
              onClick={handleActionCluster}
              disabled={actionLoading || !responseText.trim()}
              className="w-10 h-10 flex items-center justify-center bg-gray-200 text-gray-600 rounded-lg hover:bg-purple-600 hover:text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? (
                <svg
                  className="animate-spin w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
