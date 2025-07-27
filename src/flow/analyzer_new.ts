import * as vscode from 'vscode';
import { findClassOrSymbol, readFileContent } from '../analysis/workspaceSearch';
import { createMethodAnalysisCache, generateContentHash } from './cache';
import { detectLanguage } from './languageDetector';
import { ANALYSIS_CONFIG, buildMethodAnalysisPrompt } from './prompts';
import {
    AnalysisConfig,
    AnalysisSession,
    AnalysisStatus,
    CacheStats,
    CallStackEntry,
    ExecutionBlock,
    FileInfo,
    FlowAnalysisError,
    FlowAnalysisResult,
    FlowAnalyzer,
    MethodAnalysis,
    MethodAnalysisCache,
    MethodCall,
    StepInDecision
} from './types';

/**
 * Main flow analyzer that implements DP-based method analysis with recursive processing
 */
export class CodeFlowAnalyzer implements FlowAnalyzer {
  private cache: MethodAnalysisCache;
  private sessions = new Map<string, AnalysisSession>();
  private selectedModel: vscode.LanguageModelChat | null = null;

  constructor(config?: Partial<AnalysisConfig>) {
    this.cache = createMethodAnalysisCache();
  }

  /**
   * Core DP function: analyze a single method with caching and inheritance support
   */
  async analyzeMethod(
    className: string, 
    methodName: string, 
    config: Partial<AnalysisConfig> = {},
    stream?: vscode.ChatResponseStream,
    callStackEntry?: CallStackEntry
  ): Promise<MethodAnalysis> {
    const finalConfig: AnalysisConfig = { ...ANALYSIS_CONFIG, ...config };
    
    // Check cache first (DP memoization)
    const cached = this.cache.get(className, methodName);
    if (cached) {
      return cached.analysis;
    }

    const startTime = Date.now();
    
    try {
      // Get file info for the class - let LLM determine if method exists
      console.log('[ANALYZER] Getting file info for class:', className);
      const fileInfo = await this.getFileInfo(className);
      
      // Always perform analysis - let LLM handle method detection and suggestions
      const analysis = await this.performMethodAnalysis(
        className,
        methodName, 
        fileInfo, 
        finalConfig,
        stream
      );

      // Cache the result
      analysis.contentHash = generateContentHash(fileInfo.content);
      analysis.analysisTimestamp = startTime;
      
      this.cache.set(className, methodName, analysis);
      return analysis;

    } catch (error) {
      const errorAnalysis: MethodAnalysis = {
        className,
        methodName,
        language: 'unknown',
        analysisStatus: 'error',
        executionBlocks: [],
        methodCallSummary: { stepInto: [], objectLookup: [], external: [], notFound: [] },
        analysisTimestamp: startTime,
        contentHash: '',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };

      // Cache error result to avoid repeated failures
      this.cache.set(className, methodName, errorAnalysis);
      return errorAnalysis;
    }
  }

  /**
   * Analyze method flow and return formatted markdown with recursive processing
   */
  async analyzeMethodFlow(
    className: string, 
    methodName: string,
    stream?: vscode.ChatResponseStream,
    config: Partial<AnalysisConfig> = {}
  ): Promise<string> {
    console.log('[ANALYZER] analyzeMethodFlow called with:', className, methodName);
    
    const sessionId = `flow-${Date.now()}`;
    console.log('[ANALYZER] Created session ID:', sessionId);
    
    const session = this.createSession(sessionId, className, methodName, config);
    console.log('[ANALYZER] Session created');
    
    try {
      console.log('[ANALYZER] Running recursive flow analysis');
      const result = await this.runRecursiveFlowAnalysis(session, stream);
      console.log('[ANALYZER] Flow analysis completed, output length:', result.formattedOutput.length);
      return result.formattedOutput;
    } catch (error) {
      console.error('[ANALYZER] Flow analysis error:', error);
      throw error;
    } finally {
      console.log('[ANALYZER] Cleaning up session');
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get file information for a class
   */
  private async getFileInfo(className: string): Promise<FileInfo> {
    console.log('[ANALYZER] getFileInfo called for className:', className);
    
    const files = await findClassOrSymbol(className);
    console.log('[ANALYZER] Found files:', files.map((f: vscode.Uri) => f.fsPath));
    
    if (files.length === 0) {
      console.error('[ANALYZER] No files found for className:', className);
      throw new FlowAnalysisError(
        `Class ${className} not found in workspace`,
        'METHOD_NOT_FOUND',
        { className }
      );
    }

    const fileUri = files[0];
    const content = await readFileContent(fileUri);
    const language = detectLanguage(fileUri.fsPath);

    return {
      className,
      filePath: fileUri.fsPath,
      content,
      language,
      contentHash: generateContentHash(content),
      lastModified: Date.now()
    };
  }

  /**
   * Let user select from available GitHub Copilot models (with caching)
   */
  private async selectLanguageModel(): Promise<vscode.LanguageModelChat> {
    // If we already have a selected model, use it
    if (this.selectedModel) {
      return this.selectedModel;
    }

    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
      throw new FlowAnalysisError(
        'No GitHub Copilot models available',
        'LLM_ERROR'
      );
    }

    // If only one model, use it directly
    if (models.length === 1) {
      this.selectedModel = models[0];
      return this.selectedModel;
    }

    // Show model selection to user with default option
    const modelItems = models.map((model, index) => ({
      label: `${this.getModelDisplayName(model)}${index === 0 ? ' (Recommended)' : ''}`,
      description: this.getModelDescription(model),
      model: model
    }));

    const selectedItem = await vscode.window.showQuickPick(modelItems, {
      placeHolder: `Select a GitHub Copilot model for flow analysis (${models.length} available)`,
      title: 'Choose Language Model',
      ignoreFocusOut: true
    });

    this.selectedModel = selectedItem?.model || models[0];
    return this.selectedModel;
  }

  /**
   * Reset model selection to allow user to choose again
   */
  resetModelSelection(): void {
    this.selectedModel = null;
  }

  /**
   * Get the currently selected model name
   */
  getCurrentModelName(): string {
    return this.selectedModel ? this.getModelDisplayName(this.selectedModel) : 'None selected';
  }

  /**
   * Get a friendly display name for the model
   */
  private getModelDisplayName(model: vscode.LanguageModelChat): string {
    // Use the model's actual name/id, with fallback to family
    return model.name || model.id || model.family || 'GitHub Copilot Model';
  }

  /**
   * Get model description for selection UI
   */
  private getModelDescription(model: vscode.LanguageModelChat): string {
    // Use model family and vendor information to provide description
    const family = model.family || '';
    const vendor = model.vendor || '';
    const name = this.getModelDisplayName(model).toLowerCase();
    
    // Provide helpful descriptions based on available information
    if (name.includes('gpt-4o')) return 'Fast, powerful model - best for most code analysis';
    if (name.includes('gpt-4')) return 'Reliable model with strong reasoning';
    if (name.includes('claude')) return 'Excellent for complex code analysis';
    if (name.includes('o1')) return 'Advanced reasoning model for complex logic';
    
    // Generic description using available model properties
    return `${vendor} ${family} model - Available for code analysis`;
  }

  /**
   * Perform actual method analysis using LLM
   */
  private async performMethodAnalysis(
    className: string,
    methodName: string,
    fileInfo: FileInfo,
    config: AnalysisConfig,
    stream?: vscode.ChatResponseStream
  ): Promise<MethodAnalysis> {
    console.log('[ANALYZER] performMethodAnalysis called for:', className, methodName);
    console.log('[ANALYZER] File info - language:', fileInfo.language, 'content length:', fileInfo.content.length);
    
    // Build prompt for LLM analysis
    const prompt = buildMethodAnalysisPrompt(
      className,
      methodName,
      fileInfo.content,
      fileInfo.language
    );
    console.log('[ANALYZER] Built prompt, length:', prompt.length);

    // Get selected LLM model
    console.log('[ANALYZER] Selecting language model...');
    const model = await this.selectLanguageModel();
    console.log('[ANALYZER] Selected model:', this.getModelDisplayName(model));
    
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    console.log('[ANALYZER] Sending request to model...');
    
    // Send request with timeout
    const response = await Promise.race([
      model.sendRequest(messages, {}),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Analysis timeout')), config.maxAnalysisTimeMs)
      )
    ]) as vscode.LanguageModelChatResponse;

    console.log('[ANALYZER] Received response from model');

    if (stream) {
      stream.markdown(`✅ **Found method**: \`${className}.${methodName}()\`

🤖 **AI Analysis in progress** (using ${this.getCurrentModelName()})...

`);
    }

    // Collect response and stream it in real-time
    let responseText = '';
    console.log('[ANALYZER] Starting to process response fragments...');
    
    for await (const fragment of response.text) {
      responseText += fragment;
      console.log('[ANALYZER] Received fragment, length:', fragment.length);
      
      // Stream the fragment to user in real-time
      if (stream) {
        stream.markdown(fragment);
      }
    }

    console.log('[ANALYZER] Finished processing response, total length:', responseText.length);

    if (stream) {
      stream.markdown(`

📊 **Analysis complete!** Processing results...

`);
    }

    // Parse LLM response into structured data
    console.log('[ANALYZER] Parsing LLM response...');
    const parsed = this.parseLLMResponse(responseText, className, methodName, fileInfo.language);
    console.log('[ANALYZER] Parsed response, execution blocks:', parsed.executionBlocks.length);

    return {
      className,
      methodName,
      language: fileInfo.language,
      analysisStatus: parsed.analysisStatus,
      executionBlocks: parsed.executionBlocks,
      methodCallSummary: this.buildMethodCallSummary(parsed.methodCalls),
      analysisTimestamp: Date.now(),
      contentHash: '',
      errorMessage: parsed.errorMessage
    };
  }

  /**
   * Parse LLM response into structured data
   */
  private parseLLMResponse(
    responseText: string, 
    className: string, 
    methodName: string, 
    language: string
  ) {
    // This is a simplified parser - in production you'd want more robust parsing
    const executionBlocks: ExecutionBlock[] = [];
    const methodCalls: MethodCall[] = [];
    
    // Extract blocks using regex patterns
    const blockPattern = /#### Block \d+: (.+?)\n\*\*Type\*\*: (.+?)\n/g;
    let match;
    let blockIndex = 0;

    while ((match = blockPattern.exec(responseText)) !== null) {
      const [, description, type] = match;
      
      // Extract method calls from this block
      const blockText = this.extractBlockText(responseText, match.index);
      const blockMethodCalls = this.extractMethodCallsFromBlock(blockText, blockIndex);
      
      executionBlocks.push({
        blockId: `block-${blockIndex}`,
        blockType: type.toLowerCase() as any,
        description: description.trim(),
        executionFlow: this.extractExecutionFlow(blockText),
        methodCalls: blockMethodCalls,
        nextBlocks: [`block-${blockIndex + 1}`]
      });

      methodCalls.push(...blockMethodCalls);
      blockIndex++;
    }

    return {
      executionBlocks,
      methodCalls,
      analysisStatus: 'complete' as AnalysisStatus,
      errorMessage: undefined
    };
  }

  /**
   * Extract block text from response
   */
  private extractBlockText(responseText: string, startIndex: number): string {
    const nextBlockIndex = responseText.indexOf('#### Block', startIndex + 1);
    const endIndex = nextBlockIndex > -1 ? nextBlockIndex : responseText.length;
    return responseText.substring(startIndex, endIndex);
  }

  /**
   * Extract execution flow description from block text
   */
  private extractExecutionFlow(blockText: string): string {
    const flowMatch = blockText.match(/\*\*Execution Flow\*\*:\n(.*?)(?=\n\*\*|$)/s);
    return flowMatch ? flowMatch[1].trim() : 'No execution flow documented';
  }

  /**
   * Extract method calls from block text
   */
  private extractMethodCallsFromBlock(blockText: string, blockIndex: number): MethodCall[] {
    const calls: MethodCall[] = [];
    const callPattern = /- \*\*Call\*\*: `(.+?)`\n.*?- \*\*Step Into\*\*: (.+?) \((.+?)\)/g;
    let match;
    let callIndex = 0;

    while ((match = callPattern.exec(blockText)) !== null) {
      const [, fullCall, stepInDecision, reasoning] = match;
      const [className, methodCall] = fullCall.split('.', 2);
      const methodName = methodCall ? methodCall.replace(/\(\)$/, '') : fullCall;

      calls.push({
        className: className || 'Unknown',
        methodName,
        parameters: '',
        stepInDecision: stepInDecision.toLowerCase().includes('yes') ? 'stepInto' : 'external',
        reasoning: reasoning.trim(),
        expectedBehavior: 'To be analyzed',
        executionOrder: callIndex,
        conditionalExecution: undefined
      });

      callIndex++;
    }

    return calls;
  }

  /**
   * Build method call summary from parsed method calls
   */
  private buildMethodCallSummary(methodCalls: MethodCall[]) {
    const stepInto: MethodCall[] = [];
    const objectLookup: MethodCall[] = [];
    const external: MethodCall[] = [];
    const notFound: MethodCall[] = [];

    methodCalls.forEach(call => {
      switch (call.stepInDecision) {
        case 'stepInto':
          stepInto.push(call);
          break;
        case 'objectLookup':
          objectLookup.push(call);
          break;
        case 'external':
          external.push(call);
          break;
        case 'notFound':
          notFound.push(call);
          break;
      }
    });

    return { stepInto, objectLookup, external, notFound };
  }

  /**
   * Create a new analysis session
   */
  private createSession(
    sessionId: string,
    className: string,
    methodName: string,
    config: Partial<AnalysisConfig> = {}
  ): AnalysisSession {
    const finalConfig: AnalysisConfig = { ...ANALYSIS_CONFIG, ...config };
    
    return {
      sessionId,
      startTime: Date.now(),
      config: finalConfig,
      callStack: [],
      analyzedMethods: new Set<string>(),
      totalMethodsAnalyzed: 0,
      isComplete: false,
      rootMethod: { className, methodName }
    };
  }

  /**
   * Run recursive flow analysis for a session
   */
  private async runRecursiveFlowAnalysis(
    session: AnalysisSession,
    stream?: vscode.ChatResponseStream
  ): Promise<FlowAnalysisResult> {
    const startTime = Date.now();
    
    try {
      // Analyze the root method with recursive processing
      const rootAnalysis = await this.analyzeMethodRecursively(
        session.rootMethod.className,
        session.rootMethod.methodName,
        session,
        stream,
        0 // Initial depth
      );

      // Format the complete output
      const formattedOutput = await this.formatRecursiveAnalysis(session, rootAnalysis);

      const result: FlowAnalysisResult = {
        rootMethod: session.rootMethod,
        sessionId: session.sessionId,
        totalMethodsAnalyzed: session.totalMethodsAnalyzed,
        analysisTimeMs: Date.now() - startTime,
        formattedOutput,
        cacheHitRate: this.cache.getStats().hitRate,
        methodAnalyses: [rootAnalysis],
        callStack: session.callStack,
        status: 'complete'
      };

      session.isComplete = true;
      return result;

    } catch (error) {
      const errorResult: FlowAnalysisResult = {
        rootMethod: session.rootMethod,
        sessionId: session.sessionId,
        totalMethodsAnalyzed: session.totalMethodsAnalyzed,
        analysisTimeMs: Date.now() - startTime,
        formattedOutput: `# Analysis Error\n\n❌ **Error**: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`,
        cacheHitRate: this.cache.getStats().hitRate,
        methodAnalyses: [],
        callStack: session.callStack,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };

      return errorResult;
    }
  }

  /**
   * Analyze a method recursively, processing inner method calls
   */
  private async analyzeMethodRecursively(
    className: string,
    methodName: string,
    session: AnalysisSession,
    stream?: vscode.ChatResponseStream,
    depth: number = 0
  ): Promise<MethodAnalysis> {
    const methodKey = `${className}#${methodName}`;
    
    // Check depth limits
    if (depth >= session.config.maxCallStackDepth) {
      console.log(`[ANALYZER] Reached max depth ${session.config.maxCallStackDepth} for ${methodKey}`);
      
      if (stream) {
        stream.markdown(`⚠️ **Depth limit reached** for \`${className}.${methodName}()\` at depth ${depth}\n\n`);
      }
      
      // Return a placeholder analysis
      return this.createPlaceholderAnalysis(className, methodName, 'partial', 'Maximum recursion depth reached');
    }

    // Check for cycles
    if (session.analyzedMethods.has(methodKey)) {
      console.log(`[ANALYZER] Cycle detected for ${methodKey}`);
      
      if (stream) {
        stream.markdown(`🔄 **Cycle detected** for \`${className}.${methodName}()\` - already analyzed\n\n`);
      }
      
      // Return cached result or placeholder
      const cached = this.cache.get(className, methodName);
      if (cached) {
        return cached.analysis;
      }
      
      return this.createPlaceholderAnalysis(className, methodName, 'partial', 'Circular dependency detected');
    }

    // Check total method limit
    if (session.totalMethodsAnalyzed >= session.config.maxTotalMethods) {
      console.log(`[ANALYZER] Reached max total methods ${session.config.maxTotalMethods}`);
      
      if (stream) {
        stream.markdown(`⚠️ **Method limit reached** - analyzed ${session.totalMethodsAnalyzed} methods\n\n`);
      }
      
      return this.createPlaceholderAnalysis(className, methodName, 'partial', 'Maximum method count reached');
    }

    // Mark as being analyzed
    session.analyzedMethods.add(methodKey);
    session.totalMethodsAnalyzed++;

    // Create call stack entry
    const callStackEntry: CallStackEntry = {
      className,
      methodName,
      insertionPoint: null,
      depth,
      executionContext: {
        isConditional: false
      }
    };

    session.callStack.push(callStackEntry);

    try {
      // Perform the base analysis
      const analysis = await this.analyzeMethod(className, methodName, session.config, stream, callStackEntry);

      // Process method calls recursively
      if (analysis.analysisStatus === 'complete') {
        await this.processMethodCallsRecursively(analysis, session, stream, depth);
      }

      return analysis;

    } finally {
      // Clean up call stack
      session.callStack.pop();
    }
  }

  /**
   * Process method calls recursively and integrate results
   */
  private async processMethodCallsRecursively(
    analysis: MethodAnalysis,
    session: AnalysisSession,
    stream?: vscode.ChatResponseStream,
    depth: number = 0
  ): Promise<void> {
    // Get all method calls marked for stepping into
    const stepIntoMethods = analysis.methodCallSummary.stepInto;

    if (stepIntoMethods.length === 0) {
      return;
    }

    if (stream) {
      stream.markdown(`\n### 🔍 **Analyzing Inner Method Calls** (${stepIntoMethods.length} methods)\n\n`);
    }

    // Analyze each method call recursively
    for (const methodCall of stepIntoMethods) {
      if (stream) {
        stream.markdown(`📊 Analyzing \`${methodCall.className}.${methodCall.methodName}()\`...\n\n`);
      }

      try {
        const innerAnalysis = await this.analyzeMethodRecursively(
          methodCall.className,
          methodCall.methodName,
          session,
          stream,
          depth + 1
        );

        // Integrate the inner analysis into the execution blocks
        this.integrateInnerAnalysis(analysis, methodCall, innerAnalysis);

      } catch (error) {
        console.error(`[ANALYZER] Error analyzing ${methodCall.className}.${methodCall.methodName}:`, error);
        
        if (stream) {
          stream.markdown(`❌ Error analyzing \`${methodCall.className}.${methodCall.methodName}()\`: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`);
        }
      }
    }
  }

  /**
   * Integrate inner method analysis into the main execution flow
   */
  private integrateInnerAnalysis(
    mainAnalysis: MethodAnalysis,
    methodCall: MethodCall,
    innerAnalysis: MethodAnalysis
  ): void {
    // Find the execution block containing this method call
    for (const block of mainAnalysis.executionBlocks) {
      const relevantCall = block.methodCalls.find(call => 
        call.className === methodCall.className && 
        call.methodName === methodCall.methodName
      );

      if (relevantCall) {
        // Enhance the execution flow with inner method details
        if (innerAnalysis.executionBlocks.length > 0) {
          const innerSummary = this.summarizeInnerExecution(innerAnalysis);
          block.executionFlow += `\n\n**📋 Inner Execution for \`${methodCall.className}.${methodCall.methodName}()\`:**\n${innerSummary}`;
          
          // Update the method call with better expected behavior
          relevantCall.expectedBehavior = this.extractExpectedBehavior(innerAnalysis);
        }
        break;
      }
    }
  }

  /**
   * Summarize inner method execution for integration
   */
  private summarizeInnerExecution(analysis: MethodAnalysis): string {
    if (analysis.executionBlocks.length === 0) {
      return "- No execution blocks found";
    }

    const summary = analysis.executionBlocks.map((block, index) => {
      let blockSummary = `- **Step ${index + 1}**: ${block.description}`;
      
      if (block.methodCalls.length > 0) {
        const calls = block.methodCalls.map(call => `\`${call.className}.${call.methodName}()\``).join(', ');
        blockSummary += ` (calls: ${calls})`;
      }
      
      return blockSummary;
    }).join('\n');

    return summary;
  }

  /**
   * Extract expected behavior from inner analysis
   */
  private extractExpectedBehavior(analysis: MethodAnalysis): string {
    if (analysis.executionBlocks.length === 0) {
      return "Method behavior could not be determined";
    }

    // Find return blocks or summarize the main execution
    const returnBlock = analysis.executionBlocks.find(block => block.blockType === 'return');
    if (returnBlock) {
      return returnBlock.description;
    }

    // Summarize based on execution blocks
    const mainBlocks = analysis.executionBlocks.slice(0, 3); // First 3 blocks
    const summary = mainBlocks.map(block => block.description).join('; ');
    
    return summary.length > 100 ? summary.substring(0, 97) + '...' : summary;
  }

  /**
   * Create a placeholder analysis for methods that can't be fully analyzed
   */
  private createPlaceholderAnalysis(
    className: string,
    methodName: string,
    status: AnalysisStatus,
    reason: string
  ): MethodAnalysis {
    return {
      className,
      methodName,
      language: 'unknown',
      analysisStatus: status,
      executionBlocks: [{
        blockId: 'placeholder-1',
        blockType: 'methodCall',
        description: `Method analysis skipped: ${reason}`,
        executionFlow: `This method was not analyzed due to: ${reason}`,
        methodCalls: [],
        nextBlocks: []
      }],
      methodCallSummary: { stepInto: [], objectLookup: [], external: [], notFound: [] },
      analysisTimestamp: Date.now(),
      contentHash: '',
      errorMessage: reason
    };
  }

  /**
   * Format the complete recursive analysis into markdown
   */
  private async formatRecursiveAnalysis(
    session: AnalysisSession,
    rootAnalysis: MethodAnalysis
  ): Promise<string> {
    const analysisTime = Date.now() - session.startTime;
    const stats = this.cache.getStats();

    let output = `# 🔍 Flow Analysis: \`${rootAnalysis.className}.${rootAnalysis.methodName}()\`

## 📊 Analysis Summary
- **Total Methods Analyzed**: ${session.totalMethodsAnalyzed}
- **Max Depth Reached**: ${session.callStack.length > 0 ? Math.max(...session.callStack.map(entry => entry.depth)) + 1 : 1}
- **Analysis Time**: ${analysisTime}ms
- **Cache Hit Rate**: ${(stats.hitRate * 100).toFixed(1)}%
- **Model Used**: ${this.getCurrentModelName()}

---

`;

    // Add the main method analysis
    output += this.formatMethodAnalysis(rootAnalysis, 0);

    // Add analyzed methods summary
    if (session.totalMethodsAnalyzed > 1) {
      output += `\n\n## 📋 **Methods Analyzed in This Session**\n\n`;
      
      const methodsList = Array.from(session.analyzedMethods).map(methodKey => {
        const [className, methodName] = methodKey.split('#');
        return `- \`${className}.${methodName}()\``;
      }).join('\n');
      
      output += methodsList + '\n';
    }

    return output;
  }

  /**
   * Format a single method analysis
   */
  private formatMethodAnalysis(analysis: MethodAnalysis, depth: number): string {
    const indent = '  '.repeat(depth);
    let output = `${indent}## 📋 Method: \`${analysis.className}.${analysis.methodName}()\`\n\n`;

    if (analysis.analysisStatus !== 'complete') {
      output += `${indent}⚠️ **Status**: ${analysis.analysisStatus}`;
      if (analysis.errorMessage) {
        output += ` - ${analysis.errorMessage}`;
      }
      output += '\n\n';
      return output;
    }

    // Add execution blocks
    if (analysis.executionBlocks.length > 0) {
      output += `${indent}### Execution Flow\n\n`;
      
      analysis.executionBlocks.forEach((block, index) => {
        output += `${indent}#### Block ${index + 1}: ${block.description}\n`;
        output += `${indent}**Type**: ${block.blockType}\n\n`;
        output += `${indent}${block.executionFlow}\n\n`;
        
        if (block.methodCalls.length > 0) {
          output += `${indent}**Method Calls**:\n`;
          block.methodCalls.forEach(call => {
            output += `${indent}- \`${call.className}.${call.methodName}()\` - ${call.expectedBehavior}\n`;
          });
          output += '\n';
        }
      });
    }

    return output;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Factory function to create flow analyzer
 */
export function createFlowAnalyzer(config?: Partial<AnalysisConfig>): FlowAnalyzer {
  return new CodeFlowAnalyzer(config);
}
