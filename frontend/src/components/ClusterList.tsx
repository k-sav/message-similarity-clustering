import { useQuery } from "@apollo/client/react";
import { formatDistanceToNow } from "date-fns";
import { LIST_CLUSTERS } from "../graphql/queries";
import type { Cluster } from "../types";

const CREATOR_ID = "00000000-0000-4000-a000-000000000001";

interface ClusterListProps {
  onSelectCluster: (clusterId: string) => void;
  selectedClusterId?: string;
}

interface ListClustersData {
  clusters: Cluster[];
}

export default function ClusterList({
  onSelectCluster,
  selectedClusterId,
}: ClusterListProps) {
  const { loading, error, data } = useQuery<ListClustersData>(LIST_CLUSTERS, {
    variables: {
      creatorId: CREATOR_ID,
      status: "Open",
      minChannelCount: 2,
    },
    pollInterval: 5000,
    fetchPolicy: "cache-and-network",
    nextFetchPolicy: "cache-first",
  });

  if (loading && !data)
    return <div className="p-4 text-gray-500">Loading...</div>;
  if (error)
    return <div className="p-4 text-red-500">Error: {error.message}</div>;

  const clusters: Cluster[] = data?.clusters || [];

  return (
    <>
      <div className="px-4 py-4 border-b bg-purple-50">
        <h2 className="text-base font-semibold text-purple-900">Duplicates</h2>
        <p className="text-xs text-purple-600 mt-1">
          {clusters.length} {clusters.length === 1 ? "cluster" : "clusters"}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {clusters.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-sm">No clusters yet</p>
            <p className="text-xs mt-1">Seed data below to start</p>
          </div>
        ) : (
          clusters.map((cluster) => (
            <div
              key={cluster.id}
              onClick={() => onSelectCluster(cluster.id)}
              className={`px-4 py-3 border-b cursor-pointer ${
                selectedClusterId === cluster.id
                  ? "bg-blue-50"
                  : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {/* Avatar stack */}
                <div className="flex -space-x-1.5 flex-shrink-0">
                  {cluster.visitorAvatarUrls?.slice(0, 3).map((url, idx) => (
                    <div
                      key={idx}
                      className="w-5 h-5 rounded-full border border-white bg-gray-200 overflow-hidden"
                      style={{ zIndex: 3 - idx }}
                    >
                      {url ? (
                        <img
                          src={url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600 text-[8px]">
                          {cluster.representativeVisitor
                            ?.charAt(0)
                            ?.toUpperCase() || "?"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Name + count */}
                <div className="text-sm font-medium">
                  {cluster.representativeVisitor || "Unknown"}
                  {cluster.additionalVisitorCount > 0 && (
                    <span className="text-gray-500 font-normal">
                      {" "}
                      +{cluster.additionalVisitorCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Preview text */}
              <p className="text-xs text-gray-600 truncate mb-1">
                {cluster.previewText || "No preview available"}
              </p>

              {/* Metadata */}
              <div className="text-xs text-gray-400">
                {formatDistanceToNow(new Date(cluster.createdAt), {
                  addSuffix: true,
                })}{" "}
                · {cluster.channelCount}{" "}
                {cluster.channelCount === 1 ? "person" : "people"}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
