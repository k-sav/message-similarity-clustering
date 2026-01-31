import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, RedisClientType } from "redis";

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(CacheService.name);
  private isConnected = false;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>("REDIS_URL");
    if (!redisUrl) {
      this.logger.warn("REDIS_URL not configured, caching disabled");
      return;
    }

    try {
      this.client = createClient({ url: redisUrl });

      this.client.on("error", (err) => {
        this.logger.error("Redis error", err);
        this.isConnected = false;
      });

      this.client.on("connect", () => {
        this.logger.log("Connected to Redis");
        this.isConnected = true;
      });

      await this.client.connect();
    } catch (error) {
      this.logger.error("Failed to connect to Redis", error);
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isConnected) return null;

    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`Error getting key ${key}`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) return;

    try {
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.error(`Error setting key ${key}`, error);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error(`Error deleting key ${key}`, error);
    }
  }
}
