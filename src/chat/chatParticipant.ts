import * as path from 'path';
import * as vscode from 'vscode';
import { handleAnalyzeRequest, handleBatchRequest, handleHelpRequest } from './chatHandler';
import { parseRequest } from './requestParser';

export function createChatParticipant(context: vscode.ExtensionContext): vscode.ChatParticipant {
  const chatParticipant = vscode.chat.createChatParticipant('document-generator.reqgen', chatRequestHandler);
  chatParticipant.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'icon.png'));
  
  // Set up followup provider for suggestions
  chatParticipant.followupProvider = {
    provideFollowups: (result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken) => {
      return [
        {
          prompt: '@reqgen analyze another class',
          label: '🔍 Analyze Another Class',
          command: 'analyze'
        },
        {
          prompt: '@reqgen batch analyze multiple classes',
          label: '📚 Batch Analysis',
          command: 'batch'
        },
        {
          prompt: '@reqgen help',
          label: '❓ Help',
          command: 'help'
        }
      ];
    }
  };

  return chatParticipant;
}

async function chatRequestHandler(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  
  try {
    const prompt = request.prompt.trim();
    
    // Parse the request
    const analysisRequest = parseRequest(prompt);
    
    if (prompt.startsWith('help')) {
      return await handleHelpRequest(stream);
    }
    
    if (prompt.startsWith('batch')) {
      return await handleBatchRequest(analysisRequest, request, stream, token);
    }
    
    if (prompt.startsWith('analyze')) {
      return await handleAnalyzeRequest(analysisRequest, request, stream, token);
    }
    
    // Default behavior - try to analyze the request
    return await handleAnalyzeRequest(analysisRequest, request, stream, token);
    
  } catch (error) {
    stream.markdown(`❌ **Error**: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    return { metadata: { command: 'error' } };
  }
}
