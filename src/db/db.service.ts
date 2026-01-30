import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Pool, PoolClient, QueryResult } from 'pg'

@Injectable()
export class DbService implements OnModuleDestroy {
  private pool: Pool

  constructor(private config: ConfigService) {
    const databaseUrl = this.config.get<string>('DATABASE_URL')
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required')
    }
    this.pool = new Pool({ connectionString: databaseUrl })
  }

  async onModuleDestroy() {
    await this.pool.end()
  }

  query<T = unknown>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query(text, params)
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  }
}
