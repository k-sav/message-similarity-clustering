import { Field, ID, Int, ObjectType } from '@nestjs/graphql'
import { ClusterStatus } from './cluster-status.enum'
import { Message } from '../messages/message.model'

@ObjectType()
export class Cluster {
  @Field(() => ID)
  id!: string

  @Field()
  creatorId!: string

  @Field(() => ClusterStatus)
  status!: ClusterStatus

  @Field({ nullable: true })
  responseText?: string

  @Field()
  createdAt!: Date

  @Field()
  updatedAt!: Date

  @Field(() => Int)
  messageCount!: number

  @Field(() => [Message], { nullable: true })
  messages?: Message[]
}
