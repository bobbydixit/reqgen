import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findClassOrSymbol, readFileContent } from '../analysis/workspaceSearch';
import { createMethodAnalysisCache, generateContentHash } from './cache';
import { detectLanguage } from './languageDetector';
import { PersistentAnalysisCache } from './persistentCache';
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
  LinearExecutionFlow,
  LinearStepType,
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
  private persistentCache: PersistentAnalysisCache | null = null;
  private sessions = new Map<string, AnalysisSession>();
  private selectedModel: vscode.LanguageModelChat | null = null;
  private linearFlow: LinearExecutionFlow | null = null; // Track linear flow for current session
  private debugStreaming: boolean = true; // Flag to control detailed streaming output

  constructor(config?: Partial<AnalysisConfig>) {
    this.cache = createMethodAnalysisCache();
    
    // Initialize persistent cache if we're in a workspace
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        this.persistentCache = new PersistentAnalysisCache(workspaceFolders[0].uri.fsPath);
        console.log('[ANALYZER] Persistent cache initialized');
      } else {
        console.log('[ANALYZER] No workspace found, persistent cache disabled');
      }
    } catch (error) {
      console.warn('[ANALYZER] Error initializing persistent cache:', error);
    }
  }

  /**
   * Enable detailed streaming output for debugging
   */
  enableDebugStreaming(): void {
    this.debugStreaming = true;
  }

  /**
   * Disable detailed streaming output (default)
   */
  disableDebugStreaming(): void {
    this.debugStreaming = false;
  }

  /**
   * Check if debug streaming is enabled
   */
  isDebugStreamingEnabled(): boolean {
    return this.debugStreaming;
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
    
    // Check in-memory cache first (DP memoization)
    const cached = this.cache.get(className, methodName);
    if (cached) {
      console.log('[ANALYZER] In-memory cache hit for:', className, methodName);
      return cached.analysis;
    }

    const startTime = Date.now();
    
    try {
      // Get file info for the class - let LLM determine if method exists
      console.log('[ANALYZER] Getting file info for class:', className);
      const fileInfo = await this.getFileInfo(className);
      
      // Check persistent cache if available
      if (this.persistentCache && this.selectedModel) {
        const modelName = this.getModelDisplayName(this.selectedModel);
        const persistentCached = this.persistentCache.get(className, methodName, fileInfo.content, modelName);
        
        if (persistentCached) {
          console.log('[ANALYZER] Persistent cache hit for:', className, methodName);
          // Store in in-memory cache for this session
          this.cache.set(className, methodName, persistentCached);
          return persistentCached;
        }
      }
      
      // Always perform analysis - let LLM handle method detection and suggestions
      const analysis = await this.performMethodAnalysis(
        className,
        methodName, 
        fileInfo, 
        finalConfig,
        stream
      );

      // Cache the result in both caches
      analysis.contentHash = generateContentHash(fileInfo.content);
      analysis.analysisTimestamp = startTime;
      
      this.cache.set(className, methodName, analysis);
      
      // Store in persistent cache if available and analysis was successful
      if (this.persistentCache && this.selectedModel && analysis.analysisStatus === 'complete') {
        const modelName = this.getModelDisplayName(this.selectedModel);
        this.persistentCache.set(className, methodName, analysis, fileInfo.content, fileInfo.filePath, modelName);
      }
      
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

      // Cache error result to avoid repeated failures (in-memory only)
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
    
    // Show initial progress
    if (stream) {
      if (this.debugStreaming) {
        stream.markdown(`🔍 **Starting Flow Analysis**: \`${className}.${methodName}()\`\n\n`);
        stream.markdown(`📋 **Debug Mode**: Detailed streaming enabled\n\n`);
      } else {
        stream.markdown(`🔍 **Analyzing**: \`${className}.${methodName}()\`\n\n`);
      }
    }
    
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
      if (this.debugStreaming) {
        console.log('[ANALYZER] Received fragment, length:', fragment.length);
      }
      
      // Stream the fragment to user in real-time only if debug streaming is enabled
      if (stream && this.debugStreaming) {
        stream.markdown(fragment);
      }
    }

    console.log('[ANALYZER] Finished processing response, total length:', responseText.length);

    if (stream && !this.debugStreaming) {
      stream.markdown('✅ **Analysis complete!** Processing results...\n\n');
    } else if (stream) {
      stream.markdown(`

📊 **Analysis complete!** Processing results...

`);
    }

    // Parse LLM response into structured data
    console.log('[ANALYZER] Parsing LLM response...');
    const parsed = this.parseLLMResponse(responseText, className, methodName, fileInfo.language);
    console.log('[ANALYZER] Parsed response, execution blocks:', parsed.executionBlocks.length);

    // Check if method was not found and LLM provided suggestions
    if (parsed.analysisStatus === 'error' && this.isMethodNotFoundResponse(responseText)) {
      console.log('[ANALYZER] Method not found, checking LLM suggestions...');
      
      const suggestedAnalysis = await this.followLLMSuggestions(
        className,
        methodName,
        responseText,
        fileInfo,
        config,
        stream
      );
      
      if (suggestedAnalysis) {
        return suggestedAnalysis;
      }
    }

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
    // Check if LLM indicates method was not found
    const methodNotFoundIndicators = [
      'not found',
      'does not exist',
      'cannot be found',
      'method not found',
      '❌',
      'Method Detection Result:\n❌',
      'Similar Methods Found:'
    ];
    
    const isMethodNotFound = methodNotFoundIndicators.some(indicator => 
      responseText.toLowerCase().includes(indicator.toLowerCase())
    );
    
    if (isMethodNotFound) {
      console.log('[ANALYZER] LLM indicates method not found, will check parent classes');
      
      return {
        executionBlocks: [],
        methodCalls: [],
        analysisStatus: 'error' as AnalysisStatus,
        errorMessage: `Method ${methodName} not found in class ${className}`
      };
    }
    
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
   * Check if LLM response indicates method was not found
   */
  private isMethodNotFoundResponse(responseText: string): boolean {
    const notFoundIndicators = [
      'Method not found',
      'not found in class',
      '❌ **Method',
      'Method Detection Result:\n❌',
      'does not exist',
      'could not be found'
    ];

    return notFoundIndicators.some(indicator => 
      responseText.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  /**
   * Follow LLM suggestions when method is not found
   */
  private async followLLMSuggestions(
    originalClassName: string,
    methodName: string,
    llmResponse: string,
    originalFileInfo: FileInfo,
    config: AnalysisConfig,
    stream?: vscode.ChatResponseStream
  ): Promise<MethodAnalysis | null> {
    console.log('[ANALYZER] Following LLM suggestions for method not found');

    if (stream) {
      stream.markdown(`\n### 🔍 **Following LLM Suggestions**\n\n`);
    }

    // Extract suggestions from LLM response
    const suggestions = this.extractLLMSuggestions(llmResponse);
    
    if (suggestions.length === 0) {
      console.log('[ANALYZER] No suggestions found in LLM response');
      return null;
    }

    console.log('[ANALYZER] Found suggestions:', suggestions);

    // Try each suggested class
    for (const suggestion of suggestions) {
      console.log(`[ANALYZER] Trying suggestion: ${suggestion.className}`);
      
      if (stream) {
        stream.markdown(`📊 Checking \`${suggestion.className}\` for \`${methodName}()\`...\n\n`);
      }

      try {
        const suggestedFileInfo = await this.getFileInfo(suggestion.className);
        
        // Analyze the method in the suggested class
        const analysis = await this.performMethodAnalysis(
          suggestion.className,
          methodName,
          suggestedFileInfo,
          config,
          stream
        );

        // If found in suggested class, return it with proper attribution
        if (analysis.analysisStatus === 'complete') {
          if (stream) {
            stream.markdown(`✅ **Found** \`${methodName}()\` **in suggested class** \`${suggestion.className}\`\n\n`);
            stream.markdown(`💡 **Reason**: ${suggestion.reason}\n\n`);
          }
          
          // Update the analysis to show it was found in a different class
          analysis.className = suggestion.className;
          analysis.inheritedFrom = originalClassName; // Mark where we originally looked
          return analysis;
        }

      } catch (error) {
        console.log(`[ANALYZER] Could not find or analyze suggested class ${suggestion.className}:`, error);
        
        if (stream) {
          stream.markdown(`⚠️ Could not access \`${suggestion.className}\`\n\n`);
        }
      }
    }

    if (stream) {
      stream.markdown(`❌ **Method** \`${methodName}()\` **not found in any suggested classes**\n\n`);
    }

    return null;
  }

  /**
   * Extract class suggestions from LLM response
   */
  private extractLLMSuggestions(llmResponse: string): Array<{ className: string; reason: string }> {
    const suggestions: Array<{ className: string; reason: string }> = [];

    try {
      // Look for "Check Parent Classes" section
      const parentClassPattern = /\*\*Extends\*\*:\s*`([^`]+)`\s*-\s*([^\n]+)/g;
      let match;
      
      while ((match = parentClassPattern.exec(llmResponse)) !== null) {
        const [, className, reason] = match;
        suggestions.push({
          className: className.trim(),
          reason: `Parent class: ${reason.trim()}`
        });
      }

      // Look for "Alternative Classes to Check" section
      const alternativePattern = /`([A-Za-z_][A-Za-z0-9_]*)`\s*-\s*([^\n]+)/g;
      const alternativeSection = llmResponse.match(/#### Alternative Classes to Check:(.*?)(?=####|$)/s);
      
      if (alternativeSection) {
        const sectionText = alternativeSection[1];
        let altMatch;
        
        while ((altMatch = alternativePattern.exec(sectionText)) !== null) {
          const [, className, reason] = altMatch;
          // Don't duplicate if already added from parent classes
          if (!suggestions.some(s => s.className === className.trim())) {
            suggestions.push({
              className: className.trim(),
              reason: `Alternative class: ${reason.trim()}`
            });
          }
        }
      }

      // Look for "Implements" interfaces
      const implementsPattern = /\*\*Implements\*\*:\s*`([^`]+)`\s*-\s*([^\n]+)/g;
      while ((match = implementsPattern.exec(llmResponse)) !== null) {
        const [, className, reason] = match;
        if (!suggestions.some(s => s.className === className.trim())) {
          suggestions.push({
            className: className.trim(),
            reason: `Interface: ${reason.trim()}`
          });
        }
      }

    } catch (error) {
      console.error('[ANALYZER] Error extracting LLM suggestions:', error);
    }

    console.log('[ANALYZER] Extracted suggestions:', suggestions);
    return suggestions;
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
    const callPattern = /- \*\*Call\*\*: `(.+?)`\n.*?- \*\*Classification\*\*: (.+?) \((.+?)\)/gs;
    let match;
    let callIndex = 0;

    while ((match = callPattern.exec(blockText)) !== null) {
      const [, fullCall, classification, reasoning] = match;
      
      // Better parsing of method calls
      const parsedCall = this.parseMethodCall(fullCall);
      
      if (parsedCall) {
        // Map classification to stepInDecision
        let stepInDecision: StepInDecision;
        const classificationLower = classification.toLowerCase().trim();
        
        if (classificationLower.includes('step into')) {
          stepInDecision = 'stepInto';
        } else if (classificationLower.includes('object lookup')) {
          stepInDecision = 'objectLookup';
        } else if (classificationLower.includes('external')) {
          stepInDecision = 'external';
        } else {
          // Fallback for backward compatibility with old "Step Into: Yes/No" format
          stepInDecision = classificationLower.includes('yes') ? 'stepInto' : 'external';
        }
        
        calls.push({
          className: parsedCall.className,
          methodName: parsedCall.methodName,
          parameters: parsedCall.parameters,
          stepInDecision,
          reasoning: reasoning.trim(),
          expectedBehavior: 'To be analyzed',
          executionOrder: callIndex,
          conditionalExecution: undefined
        });

        callIndex++;
      }
    }

    return calls;
  }

  /**
   * Parse a method call string into components
   */
  private parseMethodCall(fullCall: string): { className: string; methodName: string; parameters: string } | null {
    console.log('[ANALYZER] Parsing method call:', fullCall);
    
    // Remove backticks if present
    let cleanCall = fullCall.replace(/`/g, '').trim();
    
    // Handle different patterns:
    // 1. ClassName.methodName()
    // 2. ClassName.methodName(param1, param2)
    // 3. object.methodName()
    // 4. methodName() (standalone function)
    
    // Pattern for ClassName.methodName(parameters)
    const classMethodPattern = /^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/;
    const match = cleanCall.match(classMethodPattern);
    
    if (match) {
      const [, className, methodName, parameters] = match;
      console.log('[ANALYZER] Parsed as class.method:', { className, methodName, parameters });
      return {
        className: className.trim(),
        methodName: methodName.trim(),
        parameters: parameters.trim()
      };
    }
    
    // Pattern for standalone methodName(parameters)
    const standalonePattern = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/;
    const standaloneMatch = cleanCall.match(standalonePattern);
    
    if (standaloneMatch) {
      const [, methodName, parameters] = standaloneMatch;
      console.log('[ANALYZER] Parsed as standalone method:', { methodName, parameters });
      return {
        className: 'Unknown',
        methodName: methodName.trim(),
        parameters: parameters.trim()
      };
    }
    
    console.warn('[ANALYZER] Could not parse method call:', fullCall);
    return null;
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
      // Initialize linear flow for this session
      this.initializeLinearFlow(session.rootMethod.className, session.rootMethod.methodName);
      
      // Analyze the root method with recursive processing
      const rootAnalysis = await this.analyzeMethodRecursively(
        session.rootMethod.className,
        session.rootMethod.methodName,
        session,
        stream,
        0 // Initial depth
      );

      // Build linear execution flow from all the analyzed methods
      if (this.linearFlow && rootAnalysis.analysisStatus === 'complete') {
        console.log('[ANALYZER] Building linear execution flow during analysis...');
        
        // Generate the detailed flow content and write to file
        const linearText = this.generateLinearExecutionText();
        const readmeFilePath = await this.writeFlowReportToFile(rootAnalysis, linearText);
        
        if (stream) {
          stream.markdown(`\n\n---\n\n`);
          stream.markdown('# 🔄 **Sequential Execution Flow**\n\n');
          stream.markdown('*Complete flow analysis has been generated and saved to file.*\n\n');
          stream.markdown(`📁 **Detailed Report**: [${readmeFilePath}](file://${readmeFilePath})\n\n`);
          stream.markdown('The report shows the complete execution flow with proper Maven-style depth visualization using dashes.\n\n');
        }
      }

      // Format the complete output with linear flow
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
    
    console.log(`[ANALYZER] Starting recursive analysis: ${methodKey} at depth ${depth}`);
    
    // Check depth limits
    if (depth >= session.config.maxCallStackDepth) {
      console.log(`[ANALYZER] Reached max depth ${session.config.maxCallStackDepth} for ${methodKey}`);
      
      if (stream && this.debugStreaming) {
        stream.markdown(`⚠️ **Depth limit reached** for \`${className}.${methodName}()\` at depth ${depth}\n\n`);
      }
      
      // Return a placeholder analysis
      return this.createPlaceholderAnalysis(className, methodName, 'partial', 'Maximum recursion depth reached');
    }

    // Check for cycles
    if (session.analyzedMethods.has(methodKey)) {
      console.log(`[ANALYZER] Cycle detected for ${methodKey}`);
      
      if (stream && this.debugStreaming) {
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
      
      if (stream && this.debugStreaming) {
        stream.markdown(`⚠️ **Method limit reached** - analyzed ${session.totalMethodsAnalyzed} methods\n\n`);
      }
      
      return this.createPlaceholderAnalysis(className, methodName, 'partial', 'Maximum method count reached');
    }

    // Validate class and method names
    if (!this.isValidIdentifier(className) || !this.isValidIdentifier(methodName)) {
      console.warn(`[ANALYZER] Invalid identifiers: className="${className}", methodName="${methodName}"`);
      
      if (stream && this.debugStreaming) {
        stream.markdown(`❌ **Invalid method reference**: \`${className}.${methodName}()\`\n\n`);
      }
      
      return this.createPlaceholderAnalysis(className, methodName, 'error', 'Invalid class or method name');
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

      // Update root method if this was found in a different class (due to inheritance)
      if (depth === 0 && this.linearFlow && analysis.inheritedFrom) {
        console.log(`[ANALYZER] Updating root method from ${this.linearFlow.rootMethod} to ${analysis.className}.${analysis.methodName} (found in parent class)`);
        this.linearFlow.rootMethod = `${analysis.className}.${analysis.methodName}`;
      }

      // Add linear flow steps for this method if analysis is complete
      if (analysis.analysisStatus === 'complete' && this.linearFlow) {
        this.addMethodToLinearFlow(analysis, depth);
      }

      // Process method calls recursively
      if (analysis.analysisStatus === 'complete') {
        await this.processMethodCallsRecursively(analysis, session, stream, depth);
      }

      return analysis;

    } catch (error) {
      console.error(`[ANALYZER] Error in recursive analysis for ${methodKey}:`, error);
      
      if (stream) {
        stream.markdown(`❌ **Error analyzing** \`${className}.${methodName}()\`: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`);
      }
      
      return this.createPlaceholderAnalysis(className, methodName, 'error', error instanceof Error ? error.message : 'Unknown error');
      
    } finally {
      // Clean up call stack
      session.callStack.pop();
    }
  }

  /**
   * Check if a string is a valid identifier
   */
  private isValidIdentifier(identifier: string): boolean {
    // Allow letters, numbers, underscores, but not starting with number
    // Also reject overly long or suspicious strings
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier) && identifier.length < 100;
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
      console.log('[ANALYZER] No step-into methods found');
      return;
    }

    if (stream && this.debugStreaming) {
      stream.markdown(`\n### 🔍 **Analyzing Inner Method Calls** (${stepIntoMethods.length} methods)\n\n`);
    }

    console.log(`[ANALYZER] Processing ${stepIntoMethods.length} step-into methods at depth ${depth}`);

    // Analyze each method call recursively
    for (const methodCall of stepIntoMethods) {
      console.log(`[ANALYZER] Processing method call: ${methodCall.className}.${methodCall.methodName}`);
      
      if (stream && this.debugStreaming) {
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

          // Add return step after inner method completes
          if (this.linearFlow && innerAnalysis.analysisStatus === 'complete') {
            let currentStepNumber = this.linearFlow.totalSteps;
            this.linearFlow.steps.push({
              stepNumber: ++currentStepNumber,
              depth,
              sourceMethod: `${analysis.className}.${analysis.methodName}`,
              description: `↩️ ${methodCall.className}.${methodCall.methodName}() returns: ${this.extractExpectedBehavior(innerAnalysis)}`,
              stepType: 'methodReturn'
            });
            this.linearFlow.totalSteps = currentStepNumber;
          }

          // Integrate the inner analysis into the execution blocks
          this.integrateInnerAnalysis(analysis, methodCall, innerAnalysis);

          if (stream && this.debugStreaming) {
            if (innerAnalysis.analysisStatus === 'complete') {
              stream.markdown(`✅ Completed analysis of \`${methodCall.className}.${methodCall.methodName}()\`\n\n`);
            } else {
              stream.markdown(`⚠️ Partial analysis of \`${methodCall.className}.${methodCall.methodName}()\` (${innerAnalysis.analysisStatus})\n\n`);
            }
          }

        } catch (error) {
        console.error(`[ANALYZER] Error analyzing ${methodCall.className}.${methodCall.methodName}:`, error);
        
        if (stream && this.debugStreaming) {
          stream.markdown(`❌ Error analyzing \`${methodCall.className}.${methodCall.methodName}()\`: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`);
        }
        
        // Create a placeholder analysis for the failed method
        const placeholderAnalysis = this.createPlaceholderAnalysis(
          methodCall.className,
          methodCall.methodName,
          'error',
          error instanceof Error ? error.message : 'Unknown error'
        );
        
        this.integrateInnerAnalysis(analysis, methodCall, placeholderAnalysis);
      }
    }
    
    console.log(`[ANALYZER] Completed processing ${stepIntoMethods.length} methods at depth ${depth}`);
  }

  /**
   * Add a method's steps to the linear flow during recursive analysis
   */
  private addMethodToLinearFlow(analysis: MethodAnalysis, depth: number): void {
    if (!this.linearFlow) {
      return;
    }

    const methodKey = `${analysis.className}.${analysis.methodName}`;
    
    // Check if we've already added this method to avoid duplicates
    if (this.linearFlow.methodReferences.has(methodKey)) {
      return;
    }

    // Store the analysis for reference
    this.linearFlow.methodReferences.set(methodKey, analysis);

    // Add method start step
    let currentStepNumber = this.linearFlow.totalSteps;
    this.linearFlow.steps.push({
      stepNumber: ++currentStepNumber,
      depth,
      sourceMethod: methodKey,
      description: `${analysis.className}.${analysis.methodName}() starts`,
      stepType: 'methodStart'
    });

    // Add execution blocks
    for (const block of analysis.executionBlocks) {
      this.linearFlow.steps.push({
        stepNumber: ++currentStepNumber,
        depth,
        sourceMethod: methodKey,
        description: block.description,
        stepType: 'execution',
        originalBlockId: block.blockId
      });

      // Add method calls in this block (but don't recurse - that's handled separately)
      for (const methodCall of block.methodCalls) {
        if (methodCall.stepInDecision === 'stepInto') {
          this.linearFlow.steps.push({
            stepNumber: ++currentStepNumber,
            depth,
            sourceMethod: methodKey,
            description: `Call ${methodCall.className}.${methodCall.methodName}(${methodCall.parameters})`,
            stepType: 'methodCall'
          });
          // The inner method will be added when it gets analyzed recursively
        } else if (methodCall.stepInDecision === 'objectLookup') {
          this.linearFlow.steps.push({
            stepNumber: ++currentStepNumber,
            depth,
            sourceMethod: methodKey,
            description: `Data access: ${methodCall.className}.${methodCall.methodName}(${methodCall.parameters}) - ${methodCall.expectedBehavior}`,
            stepType: 'methodCall'
          });
        } else {
          this.linearFlow.steps.push({
            stepNumber: ++currentStepNumber,
            depth,
            sourceMethod: methodKey,
            description: `External call: ${methodCall.className}.${methodCall.methodName}(${methodCall.parameters}) - ${methodCall.expectedBehavior}`,
            stepType: 'methodCall'
          });
        }
      }
    }

    // Add method end step
    this.linearFlow.steps.push({
      stepNumber: ++currentStepNumber,
      depth,
      sourceMethod: methodKey,
      description: `${analysis.className}.${analysis.methodName}() completes`,
      stepType: 'methodEnd'
    });

    this.linearFlow.totalSteps = currentStepNumber;
  }

  /**
   * Initialize linear execution flow for a session
   */
  private initializeLinearFlow(rootClassName: string, rootMethodName: string): void {
    this.linearFlow = {
      steps: [],
      methodReferences: new Map<string, MethodAnalysis>(),
      totalSteps: 0,
      rootMethod: `${rootClassName}.${rootMethodName}`
    };
  }

  /**
   * Build linear execution flow from recursive analysis
   */
  private buildLinearExecutionFlow(
    analysis: MethodAnalysis,
    depth: number = 0,
    parentStepNumber?: number
  ): number {
    if (!this.linearFlow) {
      throw new Error('Linear flow not initialized');
    }

    const methodKey = `${analysis.className}.${analysis.methodName}`;
    
    // Check if we've already processed this exact method analysis
    if (this.linearFlow.methodReferences.has(methodKey)) {
      // Reuse cached analysis but create new steps with different numbers
      const cachedAnalysis = this.linearFlow.methodReferences.get(methodKey)!;
      return this.insertMethodSteps(cachedAnalysis, depth, parentStepNumber);
    }

    // Store the analysis for future reuse
    this.linearFlow.methodReferences.set(methodKey, analysis);
    
    return this.insertMethodSteps(analysis, depth, parentStepNumber);
  }

  /**
   * Insert method steps into linear flow
   */
  private insertMethodSteps(
    analysis: MethodAnalysis,
    depth: number,
    parentStepNumber?: number
  ): number {
    if (!this.linearFlow) {
      throw new Error('Linear flow not initialized');
    }

    const methodKey = `${analysis.className}.${analysis.methodName}`;
    let currentStepNumber = this.linearFlow.totalSteps;

    // Add method start step
    this.linearFlow.steps.push({
      stepNumber: ++currentStepNumber,
      depth,
      sourceMethod: methodKey,
      description: `${analysis.className}.${analysis.methodName}() starts`,
      stepType: 'methodStart'
    });

    // Process each execution block
    for (const block of analysis.executionBlocks) {
      // Add execution step for the block
      this.linearFlow.steps.push({
        stepNumber: ++currentStepNumber,
        depth,
        sourceMethod: methodKey,
        description: block.description,
        stepType: 'execution',
        originalBlockId: block.blockId
      });

      // Process method calls within this block
      for (const methodCall of block.methodCalls) {
        if (methodCall.stepInDecision === 'stepInto') {
          // Add method call step
          const callStepNumber = ++currentStepNumber;
          this.linearFlow.steps.push({
            stepNumber: callStepNumber,
            depth,
            sourceMethod: methodKey,
            description: `Call ${methodCall.className}.${methodCall.methodName}(${methodCall.parameters})`,
            stepType: 'methodCall'
          });

          // Check if we have the inner method analysis
          const innerMethodKey = `${methodCall.className}.${methodCall.methodName}`;
          const innerAnalysis = this.linearFlow.methodReferences.get(innerMethodKey);
          
          if (innerAnalysis && innerAnalysis.analysisStatus === 'complete') {
            // Recursively insert inner method steps
            const lastInnerStep = this.insertMethodSteps(innerAnalysis, depth + 1, callStepNumber);
            currentStepNumber = lastInnerStep;

            // Add method return step
            this.linearFlow.steps.push({
              stepNumber: ++currentStepNumber,
              depth,
              sourceMethod: methodKey,
              description: `${methodCall.className}.${methodCall.methodName}() returns: ${methodCall.expectedBehavior}`,
              stepType: 'methodReturn'
            });
          }
        } else if (methodCall.stepInDecision === 'objectLookup') {
          // Object lookup - just document as data access
          this.linearFlow.steps.push({
            stepNumber: ++currentStepNumber,
            depth,
            sourceMethod: methodKey,
            description: `Data access: ${methodCall.className}.${methodCall.methodName}(${methodCall.parameters}) - ${methodCall.expectedBehavior}`,
            stepType: 'methodCall'
          });
        } else {
          // External method call - just document it
          this.linearFlow.steps.push({
            stepNumber: ++currentStepNumber,
            depth,
            sourceMethod: methodKey,
            description: `External call: ${methodCall.className}.${methodCall.methodName}(${methodCall.parameters}) - ${methodCall.expectedBehavior}`,
            stepType: 'methodCall'
          });
        }
      }
    }

    // Add method end step
    this.linearFlow.steps.push({
      stepNumber: ++currentStepNumber,
      depth,
      sourceMethod: methodKey,
      description: `${analysis.className}.${analysis.methodName}() completes`,
      stepType: 'methodEnd'
    });

    this.linearFlow.totalSteps = currentStepNumber;
    return currentStepNumber;
  }

  /**
   * Integrate inner analysis and build linear flow during recursive analysis
   */
  private integrateInnerAnalysis(
    mainAnalysis: MethodAnalysis,
    methodCall: MethodCall,
    innerAnalysis: MethodAnalysis
  ): void {
    // Store inner analysis for linear flow building - ensure it's always stored
    if (this.linearFlow) {
      const innerMethodKey = `${innerAnalysis.className}.${innerAnalysis.methodName}`;
      console.log(`[ANALYZER] Storing inner analysis for ${innerMethodKey} in linearFlow methodReferences`);
      this.linearFlow.methodReferences.set(innerMethodKey, innerAnalysis);
    }

    // Update the method call with better expected behavior (keep this for compatibility)
    for (const block of mainAnalysis.executionBlocks) {
      const relevantCall = block.methodCalls.find(call => 
        call.className === methodCall.className && 
        call.methodName === methodCall.methodName
      );

      if (relevantCall) {
        relevantCall.expectedBehavior = this.extractExpectedBehavior(innerAnalysis);
        break;
      }
    }
  }

  /**
   * Generate linear execution text recursively - dive into methods and come back out
   */
  private generateLinearExecutionText(): string {
    if (!this.linearFlow) {
      return 'No linear flow available';
    }

    console.log(`[ANALYZER] generateLinearExecutionText: linearFlow has ${this.linearFlow.methodReferences.size} method references`);
    console.log(`[ANALYZER] Root method: ${this.linearFlow.rootMethod}`);
    console.log(`[ANALYZER] Available methods:`, Array.from(this.linearFlow.methodReferences.keys()));

    let output = `## Step-by-Step Execution:\n`;
    
    // Start with the root method
    const rootAnalysis = this.linearFlow.methodReferences.get(this.linearFlow.rootMethod);
    if (rootAnalysis) {
      console.log(`[ANALYZER] Found root analysis for ${this.linearFlow.rootMethod}`);
      output += this.generateMethodExecutionRecursively(rootAnalysis, 0);
    } else {
      console.log(`[ANALYZER] No root analysis found for ${this.linearFlow.rootMethod}`);
      
      // Try to find the analysis with inheritance info
      const alternativeRoot = Array.from(this.linearFlow.methodReferences.entries()).find(([key, analysis]) => 
        analysis.inheritedFrom && key.includes('.processExecutorRequest')
      );
      
      if (alternativeRoot) {
        console.log(`[ANALYZER] Found alternative root with inheritance: ${alternativeRoot[0]}`);
        output += this.generateMethodExecutionRecursively(alternativeRoot[1], 0);
      } else {
        output += `❌ Root method analysis not found: ${this.linearFlow.rootMethod}\n`;
        output += `Available methods: ${Array.from(this.linearFlow.methodReferences.keys()).join(', ')}\n`;
      }
    }

    return output;
  }

  /**
   * Recursively generate execution text for a method and its calls
   */
  private generateMethodExecutionRecursively(analysis: MethodAnalysis, depth: number): string {
    const depthPrefix = '-'.repeat(depth);
    const indent = depthPrefix ? `${depthPrefix} ` : '';
    let output = '';

    console.log(`[ANALYZER] generateMethodExecutionRecursively: ${analysis.className}.${analysis.methodName}() at depth ${depth}`);
    console.log(`[ANALYZER] Analysis status: ${analysis.analysisStatus}, execution blocks: ${analysis.executionBlocks.length}`);
    console.log(`[ANALYZER] Method calls summary - stepInto: ${analysis.methodCallSummary.stepInto.length}, objectLookup: ${analysis.methodCallSummary.objectLookup.length}, external: ${analysis.methodCallSummary.external.length}`);

    // Method starts
    output += `${indent}🔵 ${analysis.className}.${analysis.methodName}() starts\n`;

    // Process each execution block
    for (const block of analysis.executionBlocks) {
      // Add the block description
      output += `${indent}⚡ ${block.description}\n`;
      
      // Add detailed execution flow if available
      if (block.executionFlow && block.executionFlow !== 'No execution flow documented') {
        const flowLines = block.executionFlow.split('\n').filter((line: string) => line.trim());
        for (const flowLine of flowLines) {
          if (flowLine.trim()) {
            output += `${indent}    ${flowLine.trim()}\n`;
          }
        }
      }

      // Process method calls in this block
      for (const methodCall of block.methodCalls) {
        if (methodCall.stepInDecision === 'stepInto') {
          // Add the call
          output += `${indent}📞 Call ${methodCall.className}.${methodCall.methodName}()\n`;
          
          // Check if we have the inner method analysis to dive into
          const innerMethodKey = `${methodCall.className}.${methodCall.methodName}`;
          const innerAnalysis = this.linearFlow?.methodReferences.get(innerMethodKey);
          
          console.log(`[ANALYZER] Looking for inner method: ${innerMethodKey}, found: ${innerAnalysis ? 'YES' : 'NO'}`);
          if (innerAnalysis) {
            console.log(`[ANALYZER] Inner analysis status: ${innerAnalysis.analysisStatus}`);
          }
          
          if (innerAnalysis) {
            if (innerAnalysis.analysisStatus === 'complete') {
              // RECURSE: Dive into the inner method with full analysis
              output += this.generateMethodExecutionRecursively(innerAnalysis, depth + 1);
              
              // Come back out with return
              output += `${indent}↩️ ${methodCall.className}.${methodCall.methodName}() returns: ${this.extractExpectedBehavior(innerAnalysis)}\n`;
            } else {
              // Show partial/error analysis with what we have
              output += `${depthPrefix ? depthPrefix + '-' : '-'} 🔵 ${innerAnalysis.className}.${innerAnalysis.methodName}() starts\n`;
              
              if (innerAnalysis.executionBlocks.length > 0) {
                for (const block of innerAnalysis.executionBlocks) {
                  output += `${depthPrefix ? depthPrefix + '-' : '-'} ⚡ ${block.description}\n`;
                  
                  // Add detailed execution flow if available
                  if (block.executionFlow && block.executionFlow !== 'No execution flow documented') {
                    const flowLines = block.executionFlow.split('\n').filter((line: string) => line.trim());
                    for (const flowLine of flowLines) {
                      if (flowLine.trim()) {
                        output += `${depthPrefix ? depthPrefix + '-' : '-'}     ${flowLine.trim()}\n`;
                      }
                    }
                  }
                }
              } else {
                output += `${depthPrefix ? depthPrefix + '-' : '-'} ⚠️ ${innerAnalysis.analysisStatus}: ${innerAnalysis.errorMessage || 'Analysis incomplete'}\n`;
              }
              
              output += `${depthPrefix ? depthPrefix + '-' : '-'} 🔴 ${innerAnalysis.className}.${innerAnalysis.methodName}() completes (${innerAnalysis.analysisStatus})\n`;
              output += `${indent}↩️ ${methodCall.className}.${methodCall.methodName}() returns: ${this.extractExpectedBehavior(innerAnalysis)}\n`;
            }
          } else {
            // Method not analyzed or failed
            output += `${indent}- ⚠️ Method analysis not available\n`;
          }
        } else if (methodCall.stepInDecision === 'objectLookup') {
          // Object lookup - simple data access, no recursion but show as data access
          output += `${indent}🔍 Data access: ${methodCall.className}.${methodCall.methodName}() - ${methodCall.expectedBehavior}\n`;
        } else {
          // External method call - framework/library, no recursion
          output += `${indent}📞 External call: ${methodCall.className}.${methodCall.methodName}(${methodCall.parameters}) - ${methodCall.expectedBehavior}\n`;
        }
      }
    }

    // Method completes
    output += `${indent}🔴 ${analysis.className}.${analysis.methodName}() completes\n`;

    return output;
  }

  /**
   * Generate enhanced narrative section using LLM
   */
  private async generateEnhancedNarrative(analysis: MethodAnalysis, flowContent: string): Promise<string> {
    try {
      // Get available models first
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        throw new Error('No GitHub Copilot models available');
      }

      // Create comprehensive choices that combine narrative decision + model selection
      const currentModelName = this.selectedModel ? this.getModelDisplayName(this.selectedModel) : models[0] ? this.getModelDisplayName(models[0]) : 'Default Model';
      
      const choices = [
        'No enhanced narrative',
        `Enhanced narrative with current model (${currentModelName})`,
        'Enhanced narrative with different model...'
      ];

      const userChoice = await vscode.window.showInformationMessage(
        'Generate detailed book-like narrative for this flow analysis?',
        { modal: true },
        ...choices
      );

      if (!userChoice || userChoice === 'No enhanced narrative') {
        return '';
      }

      let selectedModel = this.selectedModel || models[0];

      // If user wants to choose a different model
      if (userChoice === 'Enhanced narrative with different model...') {
        // Show model selection with power ratings
        const modelItems = models.map((model, index) => ({
          label: `${this.getModelDisplayName(model)}${this.getModelPowerIndicator(model)}`,
          description: this.getDetailedModelDescription(model),
          model: model
        }));

        const selectedItem = await vscode.window.showQuickPick(modelItems, {
          placeHolder: 'Select a model for detailed narrative generation (more powerful = better narrative)',
          title: 'Choose Model for Enhanced Analysis',
          ignoreFocusOut: true
        });

        if (selectedItem) {
          selectedModel = selectedItem.model;
        } else {
          return ''; // User cancelled
        }
      }

      if (!selectedModel) {
        return '';
      }

      // Build enhanced narrative prompt
      const narrativePrompt = this.buildNarrativePrompt(analysis, flowContent);
      
      const messages = [vscode.LanguageModelChatMessage.User(narrativePrompt)];
      
      // Send request to model
      const response = await selectedModel.sendRequest(messages, {});
      
      let narrativeText = '';
      for await (const fragment of response.text) {
        narrativeText += fragment;
      }

      return `

---

## 📖 Detailed Execution Chronicle

> *This section provides a comprehensive, book-like narrative of the code execution, generated using ${this.getModelDisplayName(selectedModel)} for maximum detail and clarity.*

${narrativeText}

`;

    } catch (error) {
      console.error('[ANALYZER] Error generating enhanced narrative:', error);
      return `

---

## 📖 Detailed Execution Chronicle

⚠️ **Error generating enhanced narrative**: ${error instanceof Error ? error.message : 'Unknown error'}

*The basic flow analysis above provides the core execution details.*

`;
    }
  }

  /**
   * Get power indicator for model selection
   */
  private getModelPowerIndicator(model: vscode.LanguageModelChat): string {
    // Use generic power indicator based on available model properties
    const family = model.family || '';
    const vendor = model.vendor || '';
    
    // Provide general classification - let the user decide based on model name
    return ' 🚀 (AI Model)';
  }

  /**
   * Get detailed model description for narrative generation
   */
  private getDetailedModelDescription(model: vscode.LanguageModelChat): string {
    // Use model family and vendor information to provide description
    const family = model.family || '';
    const vendor = model.vendor || '';
    const name = this.getModelDisplayName(model);
    
    // Generic description using available model properties
    return `${vendor} ${family} model - Available for enhanced narrative generation`;
  }

  /**
   * Build narrative prompt for LLM
   */
  private buildNarrativePrompt(analysis: MethodAnalysis, flowContent: string): string {
    return `You are a technical documentation expert specializing in creating detailed, book-like narratives of code execution flows.

Your task is to transform the following technical flow analysis into a comprehensive, engaging narrative that reads like a technical book chapter. The narrative should be:

1. **Sequential and Linear**: Follow the exact execution order step by step
2. **Maximally Detailed**: Explain every operation, decision, and transformation
3. **Technical but Readable**: Use precise technical terms but explain their significance
4. **Contextual**: Explain WHY each step happens, not just WHAT happens
5. **Comprehensive**: Cover data structures, algorithms, business logic, and architectural patterns

**Method Being Analyzed:**
\`${analysis.className}.${analysis.methodName}()\`

**Language:** ${analysis.language}

**Original Flow Analysis:**
${flowContent}

**Additional Context:**
- Execution Blocks: ${analysis.executionBlocks.length}
- Method Calls: ${analysis.methodCallSummary.stepInto.length + analysis.methodCallSummary.objectLookup.length + analysis.methodCallSummary.external.length}
- Classification: ${analysis.methodCallSummary.stepInto.length} Step Into, ${analysis.methodCallSummary.objectLookup.length} Object Lookup, ${analysis.methodCallSummary.external.length} External

**Your Task:**
Transform this into a detailed narrative with the following structure:

### Chapter-based Structure:
- **Chapter 1: Method Invocation & Setup** - Entry point, parameters, initial state
- **Chapter 2-N: Execution Phases** - Group related operations into logical chapters
- **Final Chapter: Completion & Return** - Final operations and return value

### For Each Step, Include:
- **What happens** (the operation)
- **Why it happens** (business/technical reasoning)  
- **How it happens** (algorithm/mechanism)
- **Data transformations** (input → processing → output)
- **Decision points** (conditional logic and branching)
- **Performance implications** (memory, CPU, business impact)
- **Error scenarios** (what could go wrong)
- **Architectural patterns** (design patterns in use)

### Writing Style:
- Use engaging, narrative language while maintaining technical accuracy
- Include code snippets where helpful for understanding
- Use analogies and metaphors to explain complex concepts
- Structure with clear headings and subheadings
- Include tables or lists for complex data transformations
- Add cross-references between related operations

**Generate a comprehensive narrative that someone could read to fully understand this code execution without looking at the original code.**`;
  }

  /**
   * Write the flow analysis report to a README.md file next to the analyzed class
   */
  private async writeFlowReportToFile(analysis: MethodAnalysis, flowContent: string): Promise<string> {
    try {
      // Get the file info to find where the analyzed class is located
      const fileInfo = await this.getFileInfo(analysis.className);
      const classFileDir = path.dirname(fileInfo.filePath);
      const readmeFilePath = path.join(classFileDir, `${analysis.className}_FlowAnalysis.md`);
      
      // Generate enhanced narrative section if user wants it
      const enhancedNarrative = await this.generateEnhancedNarrative(analysis, flowContent);
      
      // Create comprehensive report content
      const reportContent = `# Flow Analysis Report

## Method: \`${analysis.className}.${analysis.methodName}()\`

**Generated**: ${new Date().toISOString()}  
**Analysis Time**: ${new Date().toLocaleString()}  
**Class File**: \`${fileInfo.filePath}\`

---

${flowContent}

${enhancedNarrative}

---

## Analysis Details

- **Language**: ${analysis.language}
- **Status**: ${analysis.analysisStatus}
- **Execution Blocks**: ${analysis.executionBlocks.length}
- **Method Calls Found**: ${analysis.methodCallSummary.stepInto.length + analysis.methodCallSummary.objectLookup.length + analysis.methodCallSummary.external.length}
  - **Step Into**: ${analysis.methodCallSummary.stepInto.length}
  - **Object Lookup**: ${analysis.methodCallSummary.objectLookup.length}
  - **External**: ${analysis.methodCallSummary.external.length}

---

*This report was generated by the RequirementsGen VS Code extension flow analyzer.*
`;

      // Write the file using Node.js file system
      fs.writeFileSync(readmeFilePath, reportContent, 'utf8');
      
      console.log(`[ANALYZER] Flow report written to: ${readmeFilePath}`);
      return readmeFilePath;
      
    } catch (error) {
      console.error('[ANALYZER] Error writing flow report:', error);
      // Return a fallback path
      return 'Flow report could not be written to file';
    }
  }

  /**
   * Get detailed block information from the original analysis
   */
  private getBlockDetails(blockId: string, sourceMethod: string): ExecutionBlock | null {
    if (!this.linearFlow) {
      return null;
    }

    const analysis = this.linearFlow.methodReferences.get(sourceMethod);
    if (!analysis) {
      return null;
    }

    return analysis.executionBlocks.find(block => block.blockId === blockId) || null;
  }

  /**
   * Get icon for step type
   */
  private getStepIcon(stepType: LinearStepType): string {
    switch (stepType) {
      case 'methodStart': return '🔵';
      case 'execution': return '⚡';
      case 'methodCall': return '📞';
      case 'methodReturn': return '↩️';
      case 'conditional': return '❓';
      case 'methodEnd': return '🔴';
      default: return '•';
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
    
    // Show inheritance information
    let methodTitle = `${analysis.className}.${analysis.methodName}()`;
    if (analysis.inheritedFrom) {
      methodTitle = `${analysis.className}.${analysis.methodName}() (inherited from ${analysis.inheritedFrom})`;
    }
    
    let output = `${indent}## 📋 Method: \`${methodTitle}\`\n\n`;

    if (analysis.analysisStatus !== 'complete') {
      output += `${indent}⚠️ **Status**: ${analysis.analysisStatus}`;
      if (analysis.errorMessage) {
        output += ` - ${analysis.errorMessage}`;
      }
      output += '\n\n';
      return output;
    }

    // Add inheritance notice
    if (analysis.inheritedFrom) {
      output += `${indent}🧬 **Inheritance**: Method found in parent class \`${analysis.inheritedFrom}\`\n\n`;
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
   * Get cache statistics including both in-memory and persistent cache
   */
  getCacheStats(): CacheStats & { persistent?: { entryCount: number; cacheFilePath: string; totalSizeKB: number } } {
    const inMemoryStats = this.cache.getStats();
    
    if (this.persistentCache) {
      const persistentStats = this.persistentCache.getStats();
      return {
        ...inMemoryStats,
        persistent: persistentStats
      };
    }
    
    return inMemoryStats;
  }

  /**
   * Clear both in-memory and persistent cache
   */
  clearCache(): void {
    this.cache.clear();
    if (this.persistentCache) {
      this.persistentCache.clear();
      console.log('[ANALYZER] Cleared persistent cache');
    }
  }

  /**
   * Clear only the persistent cache (keeps in-memory cache for current session)
   */
  clearPersistentCache(): void {
    if (this.persistentCache) {
      this.persistentCache.clear();
      console.log('[ANALYZER] Cleared persistent cache only');
    }
  }

  /**
   * Get the linear execution text for LLM processing
   * This is the key method for your use case!
   */
  getLinearExecutionText(): string {
    if (!this.linearFlow) {
      return 'No analysis performed yet. Please run analyzeMethodFlow() first.';
    }
    return this.generateLinearExecutionText();
  }

  /**
   * Get the linear execution flow data structure
   */
  getLinearExecutionFlow(): LinearExecutionFlow | null {
    return this.linearFlow;
  }
}

/**
 * Factory function to create flow analyzer
 */
export function createFlowAnalyzer(config?: Partial<AnalysisConfig>): FlowAnalyzer {
  return new CodeFlowAnalyzer(config);
}
