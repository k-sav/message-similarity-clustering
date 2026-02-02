import {
  Args,
  ID,
  Mutation,
  Query,
  Resolver,
  ResolveField,
  Parent,
} from "@nestjs/graphql";
import { Cluster } from "./cluster.model";
import { ClusterStatus } from "./cluster-status.enum";
import { ClustersService } from "./clusters.service";
import { Message } from "../messages/message.model";

@Resolver(() => Cluster)
export class ClustersResolver {
  constructor(private clusters: ClustersService) {}

  @Query(() => [Cluster], { name: "clusters" })
  clustersList(
    @Args("creatorId", { type: () => ID }) creatorId: string,
    @Args("status", { type: () => ClusterStatus, nullable: true })
    status?: ClusterStatus,
    @Args("minChannelCount", { type: () => Number, nullable: true })
    minChannelCount?: number,
  ): Promise<Cluster[]> {
    return this.clusters.listClusters(creatorId, status, minChannelCount);
  }

  @Query(() => Cluster)
  async cluster(
    @Args("id", { type: () => ID }) id: string,
    @Args("creatorId") creatorId: string,
  ): Promise<Cluster> {
    const cluster = await this.clusters.getCluster(id);

    // Fetch suggested responses
    const suggestedResponses = await this.clusters.getSuggestedResponses(
      id,
      creatorId,
    );

    return {
      ...cluster,
      suggestedResponses:
        suggestedResponses.length > 0 ? suggestedResponses : undefined,
    };
  }

  @Mutation(() => Cluster)
  actionCluster(
    @Args("id", { type: () => ID }) id: string,
    @Args("responseText") responseText: string,
    @Args("channelIds", { type: () => [String] }) channelIds: string[],
  ): Promise<Cluster> {
    return this.clusters.actionCluster(id, responseText, channelIds);
  }

  @Mutation(() => Cluster, { nullable: true })
  removeClusterMessage(
    @Args("clusterId", { type: () => ID }) clusterId: string,
    @Args("messageId", { type: () => ID }) messageId: string,
  ): Promise<Cluster | null> {
    return this.clusters.removeClusterMessage(clusterId, messageId);
  }

  @ResolveField(() => [Message])
  messages(@Parent() cluster: Cluster): Promise<Message[]> {
    if (cluster.messages) {
      return Promise.resolve(cluster.messages);
    }
    return this.clusters.getClusterMessages(cluster.id);
  }
}
