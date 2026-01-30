import { Field, Float, ID, ObjectType } from '@nestjs/graphql'

@ObjectType()
export class IngestResult {
  @Field(() => ID)
  messageId!: string

  @Field(() => ID)
  clusterId!: string

  @Field(() => ID, { nullable: true })
  matchedMessageId?: string

  @Field(() => Float, { nullable: true })
  similarity?: number
}
