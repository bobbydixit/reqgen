import * as path from 'path';
import * as vscode from 'vscode';

export function registerAnalyzeFileCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('document-generator.analyzeFile', async () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('Please open a Java file to analyze');
      return;
    }
    
    const fileName = path.basename(activeEditor.document.fileName);
    vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
    vscode.commands.executeCommand('vscode.chat.open', {
      query: `@reqgen analyze ${fileName}`
    });
  });
}
