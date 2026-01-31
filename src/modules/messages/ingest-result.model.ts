import { Field, Float, ID, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class IngestResult {
  @Field()
  skipped!: boolean;

  @Field({ nullable: true })
  skipReason?: string;

  @Field(() => ID, { nullable: true })
  messageId?: string;

  @Field(() => ID, { nullable: true })
  clusterId?: string;

  @Field(() => ID, { nullable: true })
  matchedMessageId?: string;

  @Field(() => Float, { nullable: true })
  similarity?: number;
}
