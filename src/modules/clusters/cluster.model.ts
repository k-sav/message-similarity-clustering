import { Field, ID, Int, ObjectType } from "@nestjs/graphql";
import { ClusterStatus } from "./cluster-status.enum";
import { Message } from "../messages/message.model";
import { SuggestedResponse } from "./suggested-response.model";

@ObjectType()
export class Cluster {
  @Field(() => ID)
  id!: string;

  @Field()
  creatorId!: string;

  @Field(() => ClusterStatus)
  status!: ClusterStatus;

  @Field({ nullable: true })
  responseText?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  // UI list fields
  @Field(() => Int)
  channelCount!: number;

  @Field({ nullable: true })
  previewText?: string;

  @Field({ nullable: true })
  representativeVisitor?: string;

  @Field(() => Int)
  additionalVisitorCount!: number;

  @Field(() => [String], { nullable: true })
  visitorAvatarUrls?: string[];

  @Field(() => [SuggestedResponse], { nullable: true })
  suggestedResponses?: SuggestedResponse[];

  @Field(() => [Message], { nullable: true })
  messages?: Message[];
}
