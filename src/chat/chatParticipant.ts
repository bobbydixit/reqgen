import * as vscode from 'vscode';
import { createFlowAnalysisParticipant } from '../flow/integration';

export function createChatParticipant(context: vscode.ExtensionContext): vscode.ChatParticipant {
  const chatParticipant = vscode.chat.createChatParticipant('document-generator.reqgen', chatRequestHandler);
  // Icon removed to prevent file not found error
  
  // Set up followup provider for flow analysis suggestions
  chatParticipant.followupProvider = {
    provideFollowups: (result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken) => {
      return [
        {
          prompt: '@reqgen flow ClassName methodName',
          label: '🚀 Flow Analysis',
          command: 'flow'
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
  
  console.log('[REQGEN] Chat request received:', request.prompt);
  
  try {
    const prompt = request.prompt.trim();
    console.log('[REQGEN] Trimmed prompt:', prompt);
    
    // Handle help requests
    if (prompt.startsWith('help')) {
      console.log('[REQGEN] Help request detected');
      stream.markdown(`# 🚀 Flow Analysis Help

## Commands

### Flow Analysis (Linear Code Walkthrough)
\`\`\`
@reqgen flow ClassName methodName
@reqgen flow current methodName
@reqgen flow UserService createUser
@reqgen flow FourWheelerFinalQuoteFetchExecutor processExecutorRequest
\`\`\`

### Model & Cache Management
\`\`\`
@reqgen flow change-model      # Select a different AI model
@reqgen flow current-model     # Show current model
@reqgen flow clear-cache       # Reset analysis cache
\`\`\`

### What I Generate
- 🚀 **Linear Code Flow Analysis** like stepping through a debugger
- 📋 **Step-by-step execution walkthrough** showing method calls and logic flow
- 🔍 **Call stack tracing** with conservative step-in strategy
- 📊 **Decision branch analysis** for complex conditional logic

### AI Models Available
Choose from your available GitHub Copilot models:
- Models are automatically detected from your GitHub Copilot subscription
- First model in the list is marked as "Recommended"
- You can switch models anytime during your session

### Powered By
- 🤖 **GitHub Copilot** language models with user selection
- 📁 **VS Code Workspace** analysis
- ⚡ **Real-time streaming** responses
- 🧠 **Dynamic Programming** cache for performance

Try: \`@reqgen flow ClassName methodName\` to get started!`);
      return { metadata: { command: 'help' } };
    }
    
    console.log('[REQGEN] Flow analysis request, creating participant');
    // Handle flow analysis requests (including default)
    const flowParticipant = createFlowAnalysisParticipant();
    console.log('[REQGEN] Flow participant created, calling handleFlowRequest');
    const result = await flowParticipant.handleFlowRequest(request, stream, token);
    console.log('[REQGEN] Flow request completed with result:', result);
    return result;
    
  } catch (error) {
    console.error('[REQGEN] Chat request error:', error);
    stream.markdown(`❌ **Error**: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    return { metadata: { command: 'error' } };
  }
}
