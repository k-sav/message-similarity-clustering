import { Module } from '@nestjs/common'
import { DbModule } from '../../db/db.module'
import { EmbeddingsModule } from '../embeddings/embeddings.module'
import { MessagesResolver } from './messages.resolver'
import { MessagesService } from './messages.service'

@Module({
  imports: [DbModule, EmbeddingsModule],
  providers: [MessagesService, MessagesResolver],
  exports: [MessagesService]
})
export class MessagesModule {}
