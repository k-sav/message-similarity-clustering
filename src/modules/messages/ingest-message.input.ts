import { Field, ID, InputType } from "@nestjs/graphql";
import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { Type } from "class-transformer";

@InputType()
export class IngestMessageInput {
  @Field(() => ID)
  @IsString()
  @IsUUID()
  creatorId!: string;

  @Field()
  @IsString()
  messageId!: string;

  @Field()
  @IsString()
  text!: string;

  @Field()
  @IsString()
  channelId!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  channelCid?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  visitorUserId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  visitorUsername?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdAt?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isPaidDm?: boolean;
}
