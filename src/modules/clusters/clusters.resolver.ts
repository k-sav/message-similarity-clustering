import { Args, ID, Mutation, Query, Resolver, ResolveField, Parent } from '@nestjs/graphql'
import { Cluster } from './cluster.model'
import { ClusterStatus } from './cluster-status.enum'
import { ClustersService } from './clusters.service'
import { Message } from '../messages/message.model'

@Resolver(() => Cluster)
export class ClustersResolver {
  constructor(private clusters: ClustersService) {}

  @Query(() => [Cluster], { name: 'clusters' })
  clustersList(
    @Args('creatorId', { type: () => ID }) creatorId: string,
    @Args('status', { type: () => ClusterStatus, nullable: true }) status?: ClusterStatus
  ): Promise<Cluster[]> {
    return this.clusters.listClusters(creatorId, status)
  }

  @Query(() => Cluster)
  cluster(@Args('id', { type: () => ID }) id: string): Promise<Cluster> {
    return this.clusters.getCluster(id)
  }

  @Mutation(() => Cluster)
  actionCluster(
    @Args('id', { type: () => ID }) id: string,
    @Args('responseText') responseText: string
  ): Promise<Cluster> {
    return this.clusters.actionCluster(id, responseText)
  }

  @Mutation(() => Cluster)
  removeClusterMessage(
    @Args('clusterId', { type: () => ID }) clusterId: string,
    @Args('messageId', { type: () => ID }) messageId: string
  ): Promise<Cluster> {
    return this.clusters.removeClusterMessage(clusterId, messageId)
  }

  @ResolveField(() => [Message])
  messages(@Parent() cluster: Cluster): Promise<Message[]> {
    if (cluster.messages) {
      return Promise.resolve(cluster.messages)
    }
    return this.clusters.getClusterMessages(cluster.id)
  }
}
