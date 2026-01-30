import { Module } from '@nestjs/common'
import { DbModule } from '../../db/db.module'
import { ClustersResolver } from './clusters.resolver'
import { ClustersService } from './clusters.service'

@Module({
  imports: [DbModule],
  providers: [ClustersService, ClustersResolver]
})
export class ClustersModule {}
