import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'

type EmbeddingProvider = 'stub' | 'openai'

@Injectable()
export class EmbeddingsService {
  constructor(private config: ConfigService) {}

  async embed(text: string): Promise<number[]> {
    const provider = (this.config.get<string>('EMBEDDING_PROVIDER') || 'stub') as EmbeddingProvider
    const dimension = Number(this.config.get<string>('EMBEDDING_DIM') || 1536)

    if (provider === 'openai') {
      return this.embedWithOpenAI(text, dimension)
    }

    return this.embedWithStub(text, dimension)
  }

  private async embedWithOpenAI(text: string, dimension: number): Promise<number[]> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for openai embeddings')
    }

    const model = this.config.get<string>('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small'
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input: text, model })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI embeddings error: ${response.status} ${body}`)
    }

    const payload = (await response.json()) as { data: Array<{ embedding: number[] }> }
    const embedding = payload.data?.[0]?.embedding
    if (!embedding || embedding.length === 0) {
      throw new Error('OpenAI embeddings returned empty data')
    }

    if (embedding.length !== dimension) {
      return embedding
    }

    return embedding
  }

  private async embedWithStub(text: string, dimension: number): Promise<number[]> {
    const hash = createHash('sha256').update(text).digest()
    const embedding: number[] = []
    for (let i = 0; i < dimension; i += 1) {
      const byte1 = hash[i % hash.length]
      const byte2 = hash[(i + 1) % hash.length]
      const combined = (byte1 * 256 + byte2) / 65535
      const value = combined * 2 - 1
      embedding.push(Number(value.toFixed(6)))
    }
    return embedding
  }
}
