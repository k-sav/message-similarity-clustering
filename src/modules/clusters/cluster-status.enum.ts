import { registerEnumType } from '@nestjs/graphql'

export enum ClusterStatus {
  Open = 'open',
  Actioned = 'actioned'
}

registerEnumType(ClusterStatus, { name: 'ClusterStatus' })
