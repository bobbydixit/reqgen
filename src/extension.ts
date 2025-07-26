// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { createChatParticipant } from './chat/chatParticipant';
import { registerAnalyzeFileCommand } from './commands/analyzeFileCommand';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  console.log('RequirementsGen (@reqgen) chat participant is now active!');

  // Register the chat participant
  const chatParticipant = createChatParticipant(context);
  context.subscriptions.push(chatParticipant);

  // Register commands
  const analyzeFileCommand = registerAnalyzeFileCommand(context);
  context.subscriptions.push(analyzeFileCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
