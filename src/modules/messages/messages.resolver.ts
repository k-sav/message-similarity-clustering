import { Args, Mutation, Resolver } from '@nestjs/graphql'
import { IngestMessageInput } from './ingest-message.input'
import { IngestResult } from './ingest-result.model'
import { MessagesService } from './messages.service'

@Resolver()
export class MessagesResolver {
  constructor(private messages: MessagesService) {}

  @Mutation(() => IngestResult)
  ingestMessage(@Args('input') input: IngestMessageInput): Promise<IngestResult> {
    return this.messages.ingestMessage(input)
  }
}
