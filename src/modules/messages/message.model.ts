import { Field, ID, ObjectType } from '@nestjs/graphql'

@ObjectType()
export class Message {
  @Field(() => ID)
  id!: string

  @Field()
  externalMessageId!: string

  @Field()
  creatorId!: string

  @Field()
  channelId!: string

  @Field({ nullable: true })
  channelCid?: string

  @Field({ nullable: true })
  visitorUserId?: string

  @Field({ nullable: true })
  visitorUsername?: string

  @Field()
  text!: string

  @Field({ nullable: true })
  html?: string

  @Field({ nullable: true })
  messageType?: string

  @Field()
  createdAt!: Date

  @Field({ nullable: true })
  repliedAt?: Date

  @Field()
  isPaidDm!: boolean
}
