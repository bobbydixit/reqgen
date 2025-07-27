import * as path from 'path';
import * as vscode from 'vscode';

export function registerAnalyzeFileCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('document-generator.analyzeFile', async () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('Please open a source file to analyze');
      return;
    }
    
    const fileName = path.basename(activeEditor.document.fileName);
    // Extract class name from file name (remove common extensions)
    const className = fileName.replace(/\.(java|ts|js|py|cs|cpp|c|h|go|rs|kt)$/, '');
    
    vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
    vscode.commands.executeCommand('vscode.chat.open', {
      query: `@reqgen flow ${className}.main`
    });
  });
}
