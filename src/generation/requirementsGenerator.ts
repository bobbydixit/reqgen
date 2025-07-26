import * as vscode from 'vscode';
import { analyzeJavaClass } from '../analysis/javaAnalyzer';
import { buildRequirementsPrompt } from './promptBuilder';

export async function generateRequirements(
  className: string,
  methodName: string | undefined,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {

  // 1. Find and analyze the Java class
  const codeAnalysis = await analyzeJavaClass(className, methodName);
  
  // 2. Generate requirements using the language model
  const requirementsPrompt = buildRequirementsPrompt({
    codeAnalysis,
    className,
    methodName
  });
  
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    throw new Error('No GitHub Copilot models available. Please ensure you have GitHub Copilot enabled.');
  }

  const model = request.model || models[0];
  
  const messages = [
    vscode.LanguageModelChatMessage.User(requirementsPrompt)
  ];

  stream.markdown(`🤖 **Using Model**: ${model.family}\n\n`);

  const response = await model.sendRequest(messages, {}, token);
  
  // Stream the response
  for await (const fragment of response.text) {
    stream.markdown(fragment);
  }
}
