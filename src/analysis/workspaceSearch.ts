import * as vscode from 'vscode';

export async function findJavaClass(className: string): Promise<vscode.Uri[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error('No workspace folder found');
  }

  // Use VS Code's workspace search
  const files = await vscode.workspace.findFiles(
    `**/${className}.java`,
    '**/node_modules/**',
    10
  );

  if (files.length === 0) {
    throw new Error(`Class ${className} not found in workspace`);
  }

  return files;
}

export async function readFileContent(fileUri: vscode.Uri): Promise<string> {
  const document = await vscode.workspace.openTextDocument(fileUri);
  return document.getText();
}

export async function getFileLineCount(fileUri: vscode.Uri): Promise<number> {
  const document = await vscode.workspace.openTextDocument(fileUri);
  return document.lineCount;
}
