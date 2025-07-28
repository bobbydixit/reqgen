import * as vscode from 'vscode';

/**
 * Core data structures for code flow analysis system
 * Implements DP-based method analysis with call stack tracing
 */

/**
 * Configuration for analysis behavior and limits
 */
export interface AnalysisConfig {
  maxCallStackDepth: number;
  maxTotalMethods: number;
  maxAnalysisTimeMs: number;
  stepIntoStrategy: 'conservative' | 'aggressive';
  enableCaching: boolean;
  cacheExpiryMs: number;
}

/**
 * Types of execution blocks we can encounter in code
 */
export type ExecutionBlockType = 
  | 'assignment'
  | 'methodCall'
  | 'conditional'
  | 'loop'
  | 'shortCircuit'
  | 'return'
  | 'exception';

/**
 * Status of method analysis
 */
export type AnalysisStatus = 'complete' | 'partial' | 'error' | 'external';

/**
 * Step-in decision for method calls - now three-tier classification
 */
export type StepInDecision = 'stepInto' | 'objectLookup' | 'external' | 'notFound';

/**
 * Types of steps in linear execution flow
 */
export type LinearStepType = 
  | 'methodStart' 
  | 'execution' 
  | 'methodCall' 
  | 'methodReturn' 
  | 'conditional'
  | 'methodEnd';

/**
 * A single step in the linear execution flow
 */
export interface LinearExecutionStep {
  stepNumber: number;
  depth: number; // indentation level (0 = root method, 1 = first inner method, etc.)
  sourceMethod: string; // e.g., "ClassName.methodName"
  description: string;
  stepType: LinearStepType;
  originalBlockId?: string; // reference to original ExecutionBlock
  conditionalInfo?: {
    condition: string;
    dependsOnStep: number; // which step's result this depends on
  };
}

/**
 * Linear execution flow for sequential presentation
 */
export interface LinearExecutionFlow {
  steps: LinearExecutionStep[];
  methodReferences: Map<string, MethodAnalysis>; // for deduplication
  totalSteps: number;
  rootMethod: string;
}

/**
 * A method call within an execution block
 */
export interface MethodCall {
  className: string;
  methodName: string;
  parameters: string;
  stepInDecision: StepInDecision;
  reasoning: string;
  expectedBehavior: string;
  executionOrder: number;
  conditionalExecution?: string; // e.g., "only if methodA() returns true"
}

/**
 * A semantic execution block within a method
 */
export interface ExecutionBlock {
  blockId: string;
  blockType: ExecutionBlockType;
  description: string;
  executionFlow: string;
  methodCalls: MethodCall[];
  nextBlocks: string[];
  conditionalExecution?: {
    condition: string;
    dependsOn: string[]; // blockIds this depends on
  };
}

/**
 * Complete analysis of a single method
 * This is what gets cached in our DP system
 */
export interface MethodAnalysis {
  className: string;
  methodName: string;
  language: string;
  analysisStatus: AnalysisStatus;
  executionBlocks: ExecutionBlock[];
  methodCallSummary: {
    stepInto: MethodCall[];
    objectLookup: MethodCall[];
    external: MethodCall[];
    notFound: MethodCall[];
  };
  analysisTimestamp: number;
  contentHash: string; // For cache invalidation
  errorMessage?: string;
  inheritedFrom?: string; // Class where method was actually found (for inheritance)
}

/**
 * Entry in the call stack for tracing execution flow
 */
export interface CallStackEntry {
  className: string;
  methodName: string;
  insertionPoint: string | null; // Where to merge results back (e.g., "after-block-3")
  depth: number;
  parentEntry?: CallStackEntry;
  executionContext: {
    isConditional: boolean;
    condition?: string;
    dependsOnResults?: string[]; // previous method results needed
  };
}

/**
 * Cache entry for DP memoization
 */
export interface CacheEntry {
  key: string; // ${className}#${methodName}
  analysis: MethodAnalysis;
  timestamp: number;
  accessCount: number;
  contentHash: string;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  missCount: number;
  hitCount: number;
  evictionCount: number;
  averageAnalysisTime: number;
}

/**
 * Configuration for cache behavior
 */
export interface CacheConfig {
  maxEntries: number;
  expiryMs: number;
  enableContentHashing: boolean;
  enableStats: boolean;
}

/**
 * Main analyzer interface for flow analysis
 */
export interface FlowAnalyzer {
  analyzeMethod(
    className: string, 
    methodName: string, 
    config?: Partial<AnalysisConfig>
  ): Promise<MethodAnalysis>;
  
  analyzeMethodFlow(
    className: string, 
    methodName: string,
    stream?: vscode.ChatResponseStream,
    config?: Partial<AnalysisConfig>
  ): Promise<string>; // Returns formatted markdown
  
  clearCache(): void;
  getCacheStats(): CacheStats;
  resetModelSelection(): void;
  getCurrentModelName(): string;
  
  // Debug streaming controls
  enableDebugStreaming(): void;
  disableDebugStreaming(): void;
  isDebugStreamingEnabled(): boolean;
}

/**
 * Interface for method analysis cache
 */
export interface MethodAnalysisCache {
  get(className: string, methodName: string): CacheEntry | null;
  set(className: string, methodName: string, analysis: MethodAnalysis): void;
  invalidate(className: string, methodName?: string): void;
  clear(): void;
  getStats(): CacheStats;
  cleanup(): void; // Remove expired entries
}

/**
 * Workspace file information
 */
export interface FileInfo {
  className: string;
  filePath: string;
  content: string;
  language: string;
  contentHash: string;
  lastModified: number;
}

/**
 * Result of parsing LLM response
 */
export interface ParsedMethodAnalysis {
  executionBlocks: ExecutionBlock[];
  methodCalls: MethodCall[];
  analysisStatus: AnalysisStatus;
  errorMessage?: string;
}

/**
 * Context for flow analysis session
 */
export interface AnalysisSession {
  sessionId: string;
  startTime: number;
  config: AnalysisConfig;
  callStack: CallStackEntry[];
  analyzedMethods: Set<string>; // ${className}#${methodName}
  totalMethodsAnalyzed: number;
  isComplete: boolean;
  rootMethod: {
    className: string;
    methodName: string;
  };
}

/**
 * Error types for flow analysis
 */
export class FlowAnalysisError extends Error {
  constructor(
    message: string,
    public code: 'METHOD_NOT_FOUND' | 'ANALYSIS_TIMEOUT' | 'CACHE_ERROR' | 'LLM_ERROR' | 'PARSE_ERROR',
    public context?: any
  ) {
    super(message);
    this.name = 'FlowAnalysisError';
  }
}

/**
 * Result of a complete flow analysis
 */
export interface FlowAnalysisResult {
  rootMethod: {
    className: string;
    methodName: string;
  };
  sessionId: string;
  totalMethodsAnalyzed: number;
  analysisTimeMs: number;
  formattedOutput: string;
  cacheHitRate: number;
  methodAnalyses: MethodAnalysis[];
  callStack: CallStackEntry[];
  status: 'complete' | 'partial' | 'error';
  errorMessage?: string;
}
