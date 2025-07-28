import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MethodAnalysis } from './types';

/**
 * Persistent cache entry for method analysis results
 */
interface PersistentCacheEntry {
  analysis: MethodAnalysis;
  metadata: {
    contentHash: string;
    modelName: string;
    timestamp: number;
    filePath: string;
    version: string; // Cache format version for future migrations
  };
}

/**
 * Persistent cache for method analysis results
 */
export class PersistentAnalysisCache {
  private cacheFilePath: string;
  private entries: Map<string, PersistentCacheEntry> = new Map();
  private readonly CACHE_VERSION = '1.0.0';
  private readonly MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  private readonly MAX_CACHE_ENTRIES = 1000;

  constructor(workspacePath: string) {
    // Store cache in .vscode directory for workspace-specific caching
    const vscodeDir = path.join(workspacePath, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
      try {
        fs.mkdirSync(vscodeDir, { recursive: true });
      } catch (error) {
        console.warn('[PERSISTENT_CACHE] Could not create .vscode directory:', error);
      }
    }
    this.cacheFilePath = path.join(vscodeDir, 'flow-analysis-cache.json');
    this.loadCache();
  }

  /**
   * Generate cache key for a method analysis
   */
  private getCacheKey(className: string, methodName: string): string {
    return `${className}#${methodName}`;
  }

  /**
   * Calculate content hash for file content
   */
  private calculateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cached analysis if valid (content and model haven't changed)
   */
  get(className: string, methodName: string, fileContent: string, modelName: string): MethodAnalysis | null {
    const key = this.getCacheKey(className, methodName);
    const entry = this.entries.get(key);

    if (!entry) {
      return null;
    }

    const contentHash = this.calculateContentHash(fileContent);

    // Check if cache is still valid
    if (entry.metadata.contentHash !== contentHash) {
      console.log(`[PERSISTENT_CACHE] Content changed for ${key}, invalidating cache`);
      this.entries.delete(key);
      return null;
    }

    if (entry.metadata.modelName !== modelName) {
      console.log(`[PERSISTENT_CACHE] Model changed for ${key} (${entry.metadata.modelName} → ${modelName}), invalidating cache`);
      this.entries.delete(key);
      return null;
    }

    // Check age
    const age = Date.now() - entry.metadata.timestamp;
    if (age > this.MAX_CACHE_AGE_MS) {
      console.log(`[PERSISTENT_CACHE] Cache entry too old for ${key}, invalidating`);
      this.entries.delete(key);
      return null;
    }

    console.log(`[PERSISTENT_CACHE] Cache hit for ${key}`);
    return entry.analysis;
  }

  /**
   * Store analysis result in cache
   */
  set(className: string, methodName: string, analysis: MethodAnalysis, fileContent: string, filePath: string, modelName: string): void {
    const key = this.getCacheKey(className, methodName);
    const contentHash = this.calculateContentHash(fileContent);

    const entry: PersistentCacheEntry = {
      analysis,
      metadata: {
        contentHash,
        modelName,
        timestamp: Date.now(),
        filePath,
        version: this.CACHE_VERSION
      }
    };

    this.entries.set(key, entry);
    console.log(`[PERSISTENT_CACHE] Cached analysis for ${key}`);

    // Clean up old entries if cache is getting too large
    this.cleanupCache();

    // Save to disk asynchronously
    this.saveCache().catch(error => {
      console.warn('[PERSISTENT_CACHE] Error saving cache:', error);
    });
  }

  /**
   * Load cache from disk
   */
  private loadCache(): void {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        console.log('[PERSISTENT_CACHE] No cache file found, starting fresh');
        return;
      }

      const cacheData = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
      
      // Validate cache format version
      if (cacheData.version !== this.CACHE_VERSION) {
        console.log(`[PERSISTENT_CACHE] Cache version mismatch (${cacheData.version} vs ${this.CACHE_VERSION}), starting fresh`);
        return;
      }

      // Load entries
      for (const [key, entry] of Object.entries(cacheData.entries || {})) {
        this.entries.set(key, entry as PersistentCacheEntry);
      }

      console.log(`[PERSISTENT_CACHE] Loaded ${this.entries.size} cached entries`);
      
      // Clean up old entries
      this.cleanupCache();

    } catch (error) {
      console.warn('[PERSISTENT_CACHE] Error loading cache, starting fresh:', error);
      this.entries.clear();
    }
  }

  /**
   * Save cache to disk
   */
  private async saveCache(): Promise<void> {
    try {
      const cacheData = {
        version: this.CACHE_VERSION,
        lastSaved: new Date().toISOString(),
        entries: Object.fromEntries(this.entries)
      };

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
      console.log(`[PERSISTENT_CACHE] Saved ${this.entries.size} entries to cache`);

    } catch (error) {
      console.error('[PERSISTENT_CACHE] Error saving cache:', error);
    }
  }

  /**
   * Clean up old or excess cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    let removedCount = 0;

    // Remove old entries
    for (const [key, entry] of this.entries) {
      const age = now - entry.metadata.timestamp;
      if (age > this.MAX_CACHE_AGE_MS) {
        this.entries.delete(key);
        removedCount++;
      }
    }

    // Remove oldest entries if cache is too large
    if (this.entries.size > this.MAX_CACHE_ENTRIES) {
      const sortedEntries = Array.from(this.entries.entries())
        .sort((a, b) => a[1].metadata.timestamp - b[1].metadata.timestamp);

      const excessCount = this.entries.size - this.MAX_CACHE_ENTRIES;
      for (let i = 0; i < excessCount; i++) {
        this.entries.delete(sortedEntries[i][0]);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`[PERSISTENT_CACHE] Cleaned up ${removedCount} old/excess cache entries`);
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.entries.clear();
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        fs.unlinkSync(this.cacheFilePath);
      }
    } catch (error) {
      console.warn('[PERSISTENT_CACHE] Error deleting cache file:', error);
    }
    console.log('[PERSISTENT_CACHE] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { entryCount: number; cacheFilePath: string; totalSizeKB: number } {
    let totalSizeKB = 0;
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const stats = fs.statSync(this.cacheFilePath);
        totalSizeKB = Math.round(stats.size / 1024);
      }
    } catch (error) {
      // Ignore errors
    }

    return {
      entryCount: this.entries.size,
      cacheFilePath: this.cacheFilePath,
      totalSizeKB
    };
  }
}
