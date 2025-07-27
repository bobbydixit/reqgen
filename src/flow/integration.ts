import * as path from 'path';
import * as vscode from 'vscode';
import { createFlowAnalyzer } from './analyzer';
import { ANALYSIS_CONFIG } from './prompts';
import { FlowAnalyzer } from './types';

/**
 * VS Code chat participant integration for flow analysis
 */
export class FlowAnalysisParticipant {
  private analyzer: FlowAnalyzer;

  constructor() {
    this.analyzer = createFlowAnalyzer();
  }

  /**
   * Handle flow analysis chat requests
   */
  async handleFlowRequest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    const prompt = request.prompt.trim();
    console.log('[FLOW] handleFlowRequest called with prompt:', prompt);
    
    try {
      // Handle special commands
      if (prompt.includes('clear-cache')) {
        console.log('[FLOW] Clear cache command detected');
        this.analyzer.clearCache();
        stream.markdown(`✅ **Cache cleared successfully**

All cached flow analyses have been removed. Next analysis will be fresh.`);
        return { metadata: { command: 'flow_cache_clear' } };
      }

      if (prompt.includes('change-model') || prompt.includes('select-model')) {
        this.analyzer.resetModelSelection();
        stream.markdown(`✅ **Model selection reset**

You'll be prompted to choose a model on the next flow analysis.`);
        return { metadata: { command: 'flow_model_reset' } };
      }

      if (prompt.includes('model-info') || prompt.includes('current-model')) {
        const currentModel = this.analyzer.getCurrentModelName();
        stream.markdown(`🤖 **Current Model**: ${currentModel}

To change models, use: \`@reqgen flow change-model\``);
        return { metadata: { command: 'flow_model_info' } };
      }

      console.log('[FLOW] Parsing flow request');
      // Parse the request for standard flow analysis
      const { className, methodName } = this.parseFlowRequest(prompt);
      console.log('[FLOW] Parsed result - className:', JSON.stringify(className), 'methodName:', JSON.stringify(methodName));
      
      if (!className || !methodName) {
        console.log('[FLOW] Missing className or methodName, showing error');
        stream.markdown(`❌ **Error**: Please specify both class/file and method name.

**Usage**: 
- \`@reqgen flow ClassName methodName\`
- \`@reqgen flow current methodName\` (use currently open file)

**Examples**:
- \`@reqgen flow UserService createUser\`
- \`@reqgen flow FourWheelerFinalQuoteFetchExecutor processExecutorRequest\`
- \`@reqgen flow current validateOrder\` (analyzes method in currently open file)
- \`@reqgen flow current main\` (analyzes main method in currently open file)

**Note**: Make sure you have a source file open in the editor when using "current"`);
        return { metadata: { command: 'flow_error' } };
      }

      console.log('[FLOW] Starting flow analysis for:', className, methodName);
      stream.markdown(`# 🔍 Code Flow Analysis: \`${className}.${methodName}()\`

Starting debugger-style execution flow analysis...

`);

      console.log('[FLOW] Calling analyzer.analyzeMethodFlow');
      // Perform flow analysis with streaming
      const result = await this.analyzer.analyzeMethodFlow(className, methodName, stream);
      console.log('[FLOW] Analysis completed, result length:', result.length);
      
      // Note: Result is already streamed, so we don't need to stream it again

      // Add follow-up suggestions
      stream.markdown(`

---

## 💡 **Next Steps**

- **Analyze related methods**: Look for method calls in the analysis above
- **Trace deeper**: Use \`@reqgen flow OtherClass otherMethod\` for called methods
- **Change model**: Use \`@reqgen flow change-model\` to select a different AI model
- **Clear cache**: Use \`@reqgen flow clear-cache\` to reset analysis cache

**Current Model**: ${this.analyzer.getCurrentModelName()} | **Cache Stats**: ${Math.round(this.analyzer.getCacheStats().hitRate * 100)}% hit rate, ${this.analyzer.getCacheStats().totalEntries} entries`);

      return { 
        metadata: { 
          command: 'flow', 
          className, 
          methodName,
          cacheHitRate: this.analyzer.getCacheStats().hitRate
        } 
      };

    } catch (error) {
      console.error('[FLOW] Flow analysis error:', error);
      console.error('[FLOW] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      stream.markdown(`❌ **Flow analysis failed**: ${error instanceof Error ? error.message : 'Unknown error'}

**Common issues**:
- Class not found in workspace
- Method doesn't exist in the class
- GitHub Copilot not available
- Workspace not properly configured

Try checking that the class exists in your workspace.`);
      
      return { metadata: { command: 'flow_error' } };
    }
  }

  /**
   * Handle cache management requests
   */
  async handleCacheRequest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream
  ): Promise<vscode.ChatResult> {
    const prompt = request.prompt.trim().toLowerCase();
    
    if (prompt.includes('clear') || prompt.includes('reset')) {
      const stats = this.analyzer.getCacheStats();
      this.analyzer.clearCache();
      
      stream.markdown(`✅ **Cache Cleared**

**Previous Stats**:
- Total Entries: ${stats.totalEntries}
- Hit Rate: ${Math.round(stats.hitRate * 100)}%
- Total Hits: ${stats.hitCount}
- Total Misses: ${stats.missCount}

Cache has been reset. Next analyses will be fresh.`);
      
      return { metadata: { command: 'cache_clear' } };
    }
    
    if (prompt.includes('stats') || prompt.includes('status')) {
      const stats = this.analyzer.getCacheStats();
      
      stream.markdown(`📊 **Cache Statistics**

- **Total Entries**: ${stats.totalEntries}
- **Hit Rate**: ${Math.round(stats.hitRate * 100)}%
- **Cache Hits**: ${stats.hitCount}
- **Cache Misses**: ${stats.missCount}
- **Evictions**: ${stats.evictionCount}
- **Average Analysis Time**: ${Math.round(stats.averageAnalysisTime)}ms

**Performance**: ${stats.hitRate > 0.7 ? '🟢 Excellent' : stats.hitRate > 0.4 ? '🟡 Good' : '🔴 Needs Improvement'}`);
      
      return { metadata: { command: 'cache_stats', stats } };
    }

    stream.markdown(`❌ **Unknown cache command**

**Available commands**:
- \`@reqgen flow cache clear\` - Clear analysis cache
- \`@reqgen flow cache stats\` - Show cache statistics`);
    
    return { metadata: { command: 'cache_error' } };
  }

  /**
   * Show flow analysis help
   */
  async handleFlowHelp(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
    stream.markdown(`# 🚀 Code Flow Analysis Help

## Commands

### Flow Analysis
\`\`\`
@reqgen flow ClassName methodName
@reqgen flow current methodName
@reqgen flow UserService createUser
@reqgen flow FourWheelerFinalQuoteFetchExecutor processExecutorRequest
\`\`\`

### Cache Management
\`\`\`
@reqgen flow cache stats    # Show cache statistics
@reqgen flow cache clear    # Clear analysis cache
\`\`\`

## What You Get

- 📋 **Step-by-step execution flow** like a debugger walkthrough
- 🔍 **Method call analysis** with step-in decisions
- 🎯 **Smart caching** for faster repeated analysis
- 🔄 **Call stack tracing** for complex execution paths
- ⚡ **Short-circuit evaluation** documentation for complex expressions

## Example Output

### Block 1: Input Validation
**Type**: conditional
**Execution Flow**: 
1. Check if user parameter is null
2. If null, throw IllegalArgumentException
3. Otherwise, continue to next block

**Method Calls**:
- \`ValidationUtil.validateUser()\` - Step Into: Yes (own code)

### Block 2: Database Operation
**Type**: methodCall
**Execution Flow**:
1. Call userRepository.save(user)
2. Handle any database exceptions
3. Return saved user entity

## Configuration

- **Max Call Stack Depth**: ${ANALYSIS_CONFIG.maxCallStackDepth}
- **Max Total Methods**: ${ANALYSIS_CONFIG.maxTotalMethods}
- **Analysis Timeout**: ${ANALYSIS_CONFIG.maxAnalysisTimeMs}ms
- **Caching**: ${ANALYSIS_CONFIG.enableCaching ? 'Enabled' : 'Disabled'}

**Try it**: \`@reqgen flow YourClass yourMethod\``);

    return { metadata: { command: 'flow_help' } };
  }

  /**
   * Parse flow analysis request - simple space-separated format
   */
  private parseFlowRequest(prompt: string): { className?: string; methodName?: string } {
    console.log('[PARSE] parseFlowRequest called with:', JSON.stringify(prompt));
    
    // Remove command prefix and extra whitespace
    // The prompt comes in without @reqgen prefix, so just remove "flow" part
    const cleanPrompt = prompt.replace(/^flow\s+/i, '').trim();
    console.log('[PARSE] cleanPrompt after removing prefix:', JSON.stringify(cleanPrompt));
    
    // Handle special commands
    if (cleanPrompt.startsWith('cache') || cleanPrompt.startsWith('model') || cleanPrompt === 'help' || cleanPrompt === '') {
      console.log('[PARSE] Special command detected, returning empty');
      return {};
    }
    
    // Split by whitespace to get parts
    const parts = cleanPrompt.split(/\s+/);
    console.log('[PARSE] Split parts:', parts);
    
    // Handle "current" keyword with different patterns
    if (parts.length === 1 && parts[0].toLowerCase() === 'current') {
      // User typed just "@reqgen flow current" - need method name
      console.log('[PARSE] Current keyword without method name detected');
      return {}; // This will trigger the error message asking for method name
    }
    
    // Need at least 2 parts: className methodName
    if (parts.length >= 2) {
      let className = parts[0].trim();
      const methodName = parts[1].trim();
      console.log('[PARSE] Initial className:', className, 'methodName:', methodName);
      
      // Handle "current" keyword - get class name from currently active file
      if (className.toLowerCase() === 'current') {
        console.log('[PARSE] Current keyword detected, getting active editor');
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const fileName = path.basename(activeEditor.document.fileName);
          // Remove common file extensions
          const nameWithoutExt = fileName.replace(/\.(java|ts|js|py|cs|cpp|c|h|go|rs|kt)$/, '');
          console.log('[PARSE] Active file name (without extension):', nameWithoutExt);
          className = nameWithoutExt;
        } else {
          console.log('[PARSE] No active editor, using fallback');
          // Fallback if no active editor
          className = 'CurrentClass';
        }
        console.log('[PARSE] Final className after current handling:', className);
      }
      
      // Basic validation: both parts should exist
      if (className.length > 0 && methodName.length > 0) {
        console.log('[PARSE] Validation passed, returning:', { className, methodName });
        return {
          className: className,
          methodName: methodName
        };
      } else {
        console.log('[PARSE] Validation failed - empty className or methodName');
      }
    } else {
      console.log('[PARSE] Not enough parts, need at least 2');
    }
    
    console.log('[PARSE] Parsing failed, returning empty');
    // If we can't parse it, return empty (will trigger error message)
    return {};
  }
}

/**
 * Register flow analysis commands with existing chat participant
 */
export function registerFlowAnalysisCommands(
  chatParticipant: vscode.ChatParticipant,
  flowParticipant: FlowAnalysisParticipant
): void {
  // The flow analysis will be integrated into the existing chat participant
  // This function can be called from the main chat handler to add flow capabilities
}

/**
 * Factory function to create flow analysis participant
 */
export function createFlowAnalysisParticipant(): FlowAnalysisParticipant {
  return new FlowAnalysisParticipant();
}
