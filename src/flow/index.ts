/**
 * Code Flow Analysis Module
 * 
 * This module provides debugger-style code execution flow analysis using:
 * - DP-based method analysis with caching
 * - LLM-powered semantic block analysis
 * - Call stack tracing and step-in decisions
 * - VS Code chat participant integration
 */

// Core types and interfaces
export * from './types';

// DP cache system
export * from './cache';

// Main flow analyzer
export * from './analyzer';

// LLM prompts
export * from './prompts';

// VS Code integration
export * from './integration';

// Language detection
export * from './languageDetector';

// Convenience exports
export { createFlowAnalyzer } from './analyzer';
export { createMethodAnalysisCache } from './cache';
export { createFlowAnalysisParticipant } from './integration';
export { ANALYSIS_CONFIG } from './prompts';

