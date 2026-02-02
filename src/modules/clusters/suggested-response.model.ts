import { Field, Float, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class SuggestedResponse {
  @Field()
  text!: string;

  @Field(() => Float)
  similarity!: number;
}
