import * as crypto from 'crypto';
import { CacheConfig, CacheEntry, CacheStats, MethodAnalysis, MethodAnalysisCache } from './types';

/**
 * In-memory cache implementation for method analysis results
 * Implements DP memoization with content hashing and LRU eviction
 */
export class InMemoryMethodCache implements MethodAnalysisCache {
  private cache = new Map<string, CacheEntry>();
  private stats: CacheStats = {
    totalEntries: 0,
    hitRate: 0,
    missCount: 0,
    hitCount: 0,
    evictionCount: 0,
    averageAnalysisTime: 0
  };
  
  constructor(private config: CacheConfig) {}

  /**
   * Generate cache key for method
   */
  private getCacheKey(className: string, methodName: string): string {
    return `${className}#${methodName}`;
  }

  /**
   * Generate content hash for cache invalidation
   */
  private generateContentHash(content: string): string {
    if (!this.config.enableContentHashing) {
      return '';
    }
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.config.expiryMs;
  }

  /**
   * Evict oldest entries if cache is full
   */
  private evictOldest(): void {
    if (this.cache.size < this.config.maxEntries) {
      return;
    }

    // Find oldest entry
    let oldestKey = '';
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictionCount++;
    }
  }

  /**
   * Get cached method analysis
   */
  get(className: string, methodName: string): CacheEntry | null {
    const key = this.getCacheKey(className, methodName);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.missCount++;
      this.updateHitRate();
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.missCount++;
      this.updateHitRate();
      return null;
    }

    // Update access count and hit stats
    entry.accessCount++;
    this.stats.hitCount++;
    this.updateHitRate();

    return entry;
  }

  /**
   * Cache method analysis result
   */
  set(className: string, methodName: string, analysis: MethodAnalysis): void {
    const key = this.getCacheKey(className, methodName);
    
    // Evict old entries if needed
    this.evictOldest();

    const entry: CacheEntry = {
      key,
      analysis,
      timestamp: Date.now(),
      accessCount: 0,
      contentHash: analysis.contentHash
    };

    this.cache.set(key, entry);
    this.stats.totalEntries = this.cache.size;
  }

  /**
   * Invalidate cache entries
   */
  invalidate(className: string, methodName?: string): void {
    if (methodName) {
      // Invalidate specific method
      const key = this.getCacheKey(className, methodName);
      this.cache.delete(key);
    } else {
      // Invalidate all methods in class
      const classPrefix = `${className}#`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(classPrefix)) {
          this.cache.delete(key);
        }
      }
    }
    this.stats.totalEntries = this.cache.size;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      totalEntries: 0,
      hitRate: 0,
      missCount: 0,
      hitCount: 0,
      evictionCount: 0,
      averageAnalysisTime: 0
    };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.config.expiryMs) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    this.stats.totalEntries = this.cache.size;
  }

  /**
   * Update hit rate statistics
   */
  private updateHitRate(): void {
    const total = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
  }

  /**
   * Check if content has changed (for cache invalidation)
   */
  hasContentChanged(className: string, methodName: string, newContentHash: string): boolean {
    if (!this.config.enableContentHashing) {
      return false;
    }

    const entry = this.get(className, methodName);
    return entry ? entry.contentHash !== newContentHash : true;
  }

  /**
   * Get cache size information
   */
  getSizeInfo(): { entries: number; maxEntries: number; utilizationPercent: number } {
    return {
      entries: this.cache.size,
      maxEntries: this.config.maxEntries,
      utilizationPercent: (this.cache.size / this.config.maxEntries) * 100
    };
  }

  /**
   * Get most frequently accessed methods
   */
  getTopMethods(limit: number = 10): Array<{ key: string; accessCount: number; analysis: MethodAnalysis }> {
    return Array.from(this.cache.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit)
      .map(entry => ({
        key: entry.key,
        accessCount: entry.accessCount,
        analysis: entry.analysis
      }));
  }
}

/**
 * Factory function to create cache with default configuration
 */
export function createMethodAnalysisCache(config?: Partial<CacheConfig>): MethodAnalysisCache {
  const defaultConfig: CacheConfig = {
    maxEntries: 100,
    expiryMs: 300000, // 5 minutes
    enableContentHashing: true,
    enableStats: true
  };

  return new InMemoryMethodCache({ ...defaultConfig, ...config });
}

/**
 * Utility function to generate content hash
 */
export function generateContentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}
