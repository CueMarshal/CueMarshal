/**
 * Redis client for locking and caching
 */

import { createClient } from "redis";
import { config } from "../config.js";
import { logger } from "./logger.js";


// Create Redis client
const redisClient = createClient({
  url: config.redisUrl,
});

redisClient.on("error", (err) => {
  logger.error({ err }, "Redis client error");
});

redisClient.on("connect", () => {
  logger.info("Redis client connected");
});

// Connect the client
await redisClient.connect();

/**
 * Acquire a distributed lock with TTL
 * @param key Lock key
 * @param ttlSeconds Time to live in seconds
 * @returns true if lock acquired, false otherwise
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const result = await redisClient.set(key, "locked", {
      NX: true, // Only set if not exists
      EX: ttlSeconds, // Expire after TTL
    });
    return result === "OK";
  } catch (error) {
    logger.error({ error, key }, "Failed to acquire lock");
    return false;
  }
}

/**
 * Release a distributed lock
 * @param key Lock key
 */
export async function releaseLock(key: string): Promise<void> {
  try {
    await redisClient.del(key);
  } catch (error) {
    logger.error({ error, key }, "Failed to release lock");
  }
}

/**
 * Get remaining TTL for a key
 * @param key Redis key
 * @returns TTL in seconds, -1 if no TTL, -2 if key doesn't exist
 */
export async function getTTL(key: string): Promise<number> {
  try {
    return await redisClient.ttl(key);
  } catch (error) {
    logger.error({ error, key }, "Failed to get TTL");
    return -2;
  }
}

/**
 * Set a value with TTL
 * @param key Redis key
 * @param value Value to store
 * @param ttlSeconds Time to live in seconds
 */
export async function setWithTTL(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await redisClient.set(key, value, { EX: ttlSeconds });
  } catch (error) {
    logger.error({ error, key }, "Failed to set value with TTL");
  }
}

/**
 * Get a value
 * @param key Redis key
 * @returns Value or null if not found
 */
export async function get(key: string): Promise<string | null> {
  try {
    return await redisClient.get(key);
  } catch (error) {
    logger.error({ error, key }, "Failed to get value");
    return null;
  }
}

/**
 * Delete a key
 * @param key Redis key
 * @returns Number of keys deleted
 */
export async function del(key: string): Promise<number> {
  try {
    return await redisClient.del(key);
  } catch (error) {
    logger.error({ error, key }, "Failed to delete key");
    return 0;
  }
}

export { redisClient };
