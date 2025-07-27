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
  ExecutionBlock,
  FileInfo,
  FlowAnalysisError,
  FlowAnalysisResult,
  FlowAnalyzer,
  MethodAnalysis,
  MethodAnalysisCache,
  MethodCall
} from './types';

/**
 * Main flow analyzer that implements DP-based method analysis
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
    stream?: vscode.ChatResponseStream
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
        methodCallSummary: { stepInto: [], external: [], notFound: [] },
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
   * Analyze method flow and return formatted markdown
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
      console.log('[ANALYZER] Running flow analysis');
      const result = await this.runFlowAnalysis(session, stream);
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
    return {
      stepInto: methodCalls.filter(call => call.stepInDecision === 'stepInto'),
      external: methodCalls.filter(call => call.stepInDecision === 'external'),
      notFound: methodCalls.filter(call => call.stepInDecision === 'notFound')
    };
  }

  /**
   * Create analysis session
   */
  private createSession(
    sessionId: string,
    className: string,
    methodName: string,
    config: Partial<AnalysisConfig>
  ): AnalysisSession {
    const session: AnalysisSession = {
      sessionId,
      startTime: Date.now(),
      config: { ...ANALYSIS_CONFIG, ...config },
      callStack: [],
      analyzedMethods: new Set(),
      totalMethodsAnalyzed: 0,
      isComplete: false,
      rootMethod: { className, methodName }
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Run complete flow analysis with call stack tracing
   */
  private async runFlowAnalysis(session: AnalysisSession, stream?: vscode.ChatResponseStream): Promise<FlowAnalysisResult> {
    const startTime = Date.now();
    const methodAnalyses: MethodAnalysis[] = [];
    
    try {
      // Start with root method
      if (stream) {
        stream.markdown(`## 📋 Analyzing: \`${session.rootMethod.className}.${session.rootMethod.methodName}()\`

🔍 **Step 1**: Sending file to LLM for analysis...
`);
      }
      
      const rootAnalysis = await this.analyzeMethod(
        session.rootMethod.className,
        session.rootMethod.methodName,
        session.config,
        stream
      );
      
      methodAnalyses.push(rootAnalysis);
      session.totalMethodsAnalyzed++;

      // Process step-into method calls if method was found
      if (rootAnalysis.analysisStatus === 'complete') {
        await this.processStepIntoMethods(session, rootAnalysis, methodAnalyses);
      }

      // Generate formatted output
      const formattedOutput = this.formatFlowAnalysis(methodAnalyses, session);

      return {
        rootMethod: session.rootMethod,
        sessionId: session.sessionId,
        totalMethodsAnalyzed: session.totalMethodsAnalyzed,
        analysisTimeMs: Date.now() - startTime,
        formattedOutput,
        cacheHitRate: this.cache.getStats().hitRate,
        methodAnalyses,
        callStack: session.callStack,
        status: 'complete'
      };

    } catch (error) {
      return {
        rootMethod: session.rootMethod,
        sessionId: session.sessionId,
        totalMethodsAnalyzed: session.totalMethodsAnalyzed,
        analysisTimeMs: Date.now() - startTime,
        formattedOutput: `Error during analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cacheHitRate: this.cache.getStats().hitRate,
        methodAnalyses,
        callStack: session.callStack,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process methods that should be stepped into (only if primary method was found)
   */
  private async processStepIntoMethods(
    session: AnalysisSession,
    analysis: MethodAnalysis,
    methodAnalyses: MethodAnalysis[]
  ): Promise<void> {
    const stepIntoMethods = analysis.methodCallSummary.stepInto;
    
    for (const methodCall of stepIntoMethods) {
      // Check depth and count limits
      if (session.callStack.length >= session.config.maxCallStackDepth) {
        break;
      }
      
      if (session.totalMethodsAnalyzed >= session.config.maxTotalMethods) {
        break;
      }

      const methodKey = `${methodCall.className}#${methodCall.methodName}`;
      if (session.analyzedMethods.has(methodKey)) {
        continue; // Already analyzed
      }

      try {
        const methodAnalysis = await this.analyzeMethod(
          methodCall.className,
          methodCall.methodName,
          session.config
        );

        methodAnalyses.push(methodAnalysis);
        session.analyzedMethods.add(methodKey);
        session.totalMethodsAnalyzed++;

        // Recursively process step-into methods
        if (methodAnalysis.analysisStatus === 'complete') {
          await this.processStepIntoMethods(session, methodAnalysis, methodAnalyses);
        }

      } catch (error) {
        // Continue with other methods if one fails
        console.warn(`Failed to analyze ${methodCall.className}.${methodCall.methodName}:`, error);
      }
    }
  }

  /**
   * Format flow analysis result as markdown
   */
  private formatFlowAnalysis(methodAnalyses: MethodAnalysis[], session: AnalysisSession): string {
    const output: string[] = [];

    output.push(`# Code Flow Analysis: ${session.rootMethod.className}.${session.rootMethod.methodName}()`);
    output.push('');
    output.push(`**Analysis Summary:**`);
    output.push(`- Methods Analyzed: ${session.totalMethodsAnalyzed}`);
    output.push(`- Cache Hit Rate: ${Math.round(this.cache.getStats().hitRate * 100)}%`);
    output.push(`- Analysis Time: ${Date.now() - session.startTime}ms`);
    output.push('');
    output.push('---');
    output.push('');

    for (const analysis of methodAnalyses) {
      output.push(`## Method: ${analysis.className}.${analysis.methodName}()`);
      
      // Show inheritance information if method was found in super class
      if (analysis.inheritedFrom) {
        output.push(`*⬆️ Inherited from: \`${analysis.inheritedFrom}\`*`);
      }
      
      output.push('');
      
      if (analysis.analysisStatus === 'error') {
        output.push(`❌ **Error**: ${analysis.errorMessage}`);
        output.push('');
        continue;
      }

      output.push('### Execution Blocks:');
      output.push('');

      for (const block of analysis.executionBlocks) {
        output.push(`#### ${block.description}`);
        output.push(`**Type**: ${block.blockType}`);
        output.push('');
        output.push('**Execution Flow**:');
        output.push(block.executionFlow);
        output.push('');

        if (block.methodCalls.length > 0) {
          output.push('**Method Calls**:');
          for (const call of block.methodCalls) {
            output.push(`- \`${call.className}.${call.methodName}()\``);
            output.push(`  - **Step Into**: ${call.stepInDecision === 'stepInto' ? 'Yes' : 'No'} (${call.reasoning})`);
            output.push(`  - **Expected Behavior**: ${call.expectedBehavior}`);
          }
          output.push('');
        }
      }

      output.push('---');
      output.push('');
    }

    return output.join('\n');
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }
}

/**
 * Factory function to create flow analyzer
 */
export function createFlowAnalyzer(config?: Partial<AnalysisConfig>): FlowAnalyzer {
  return new CodeFlowAnalyzer(config);
}
