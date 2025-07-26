import * as vscode from 'vscode';
import { interpolateTemplate } from '../generation/promptBuilder';
import { generateRequirements } from '../generation/requirementsGenerator';
import { BATCH_COMPLETION_TEMPLATE, BATCH_HEADER_TEMPLATE, HELP_TEMPLATE } from '../generation/templates';
import { AnalysisRequest } from '../types';

export async function handleHelpRequest(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
  stream.markdown(HELP_TEMPLATE);
  return { metadata: { command: 'help' } };
}

export async function handleAnalyzeRequest(
  analysisRequest: AnalysisRequest,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {

  const className = analysisRequest.className;
  const methodName = analysisRequest.method;
  
  if (!className) {
    stream.markdown(`❌ **Error**: No class name detected.

**Usage**: \`@reqgen analyze ClassName\` or \`@reqgen analyze ClassName.methodName\``);
    return { metadata: { command: 'analyze_error' } };
  }

  stream.markdown(`# 🔍 Analyzing: \`${className}${methodName ? '.' + methodName : ''}\`

Performing deep code analysis and generating requirements documentation...

`);

  try {
    await generateRequirements(className, methodName, request, stream, token);
    return { metadata: { command: 'analyze', className, methodName } };
  } catch (error) {
    stream.markdown(`❌ **Analysis failed**: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { metadata: { command: 'analyze_error' } };
  }
}

export async function handleBatchRequest(
  analysisRequest: AnalysisRequest,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {

  const classes = analysisRequest.classes || [];
  
  if (classes.length === 0) {
    stream.markdown(`❌ **Error**: No classes specified for batch analysis.

**Usage**: \`@reqgen batch analyze classes: Class1, Class2, Class3\``);
    return { metadata: { command: 'batch_error' } };
  }

  stream.markdown(interpolateTemplate(BATCH_HEADER_TEMPLATE, {
    classCount: classes.length
  }));

  let processedCount = 0;
  
  for (const className of classes) {
    if (token.isCancellationRequested) {
      stream.markdown(`\n⏹️ **Batch processing cancelled** after ${processedCount} classes.`);
      break;
    }

    processedCount++;
    stream.markdown(`## 🔍 Analyzing Class ${processedCount}/${classes.length}: \`${className}\`\n`);
    
    try {
      await generateRequirements(className, undefined, request, stream, token);
      stream.markdown(`\n✅ **Completed**: ${className}\n---\n`);
      
      // Small delay between classes to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      stream.markdown(`\n❌ **Error analyzing ${className}**: ${error instanceof Error ? error.message : 'Unknown error'}\n---\n`);
    }
  }

  const status = processedCount === classes.length ? 'All completed successfully' : 'Partially completed';
  
  stream.markdown(interpolateTemplate(BATCH_COMPLETION_TEMPLATE, {
    processedCount: processedCount.toString(),
    totalClasses: classes.length.toString(),
    status
  }));

  return { metadata: { command: 'batch', processedCount, totalClasses: classes.length } };
}
