import { useState } from "react";
import { ApolloProvider } from "@apollo/client/react";
import { apolloClient } from "./apollo-client";
import ClusterList from "./components/ClusterList";
import ClusterDetail from "./components/ClusterDetail";
import SeedButton from "./components/SeedButton";

function App() {
  const [selectedClusterId, setSelectedClusterId] = useState<
    string | undefined
  >();

  return (
    <ApolloProvider client={apolloClient}>
      <div className="h-screen flex flex-col">
        {/* Header */}
        <header className="bg-white border-b px-6 py-4">
          <h1 className="text-xl font-semibold">Similarity Clusters</h1>
          <p className="text-sm text-gray-600">
            Bulk reply to similar messages
          </p>
        </header>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel - Cluster list */}
          <div className="w-96 bg-white border-r flex flex-col">
            <ClusterList
              onSelectCluster={setSelectedClusterId}
              selectedClusterId={selectedClusterId}
            />
            <SeedButton />
          </div>

          {/* Right panel - Cluster detail */}
          <div className="flex-1 bg-white">
            {selectedClusterId ? (
              <ClusterDetail clusterId={selectedClusterId} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <p className="text-lg">Select a cluster to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ApolloProvider>
  );
}

export default App;
