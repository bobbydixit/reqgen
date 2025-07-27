import * as vscode from 'vscode';

/**
 * Language-agnostic class/symbol finder using VS Code's powerful APIs
 */
export async function findClassOrSymbol(className: string): Promise<vscode.Uri[]> {
  console.log('[SEARCH] findClassOrSymbol called with:', className);
  
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error('No workspace folder found');
  }

  // First try: Use VS Code's workspace symbol provider for intelligent search
  try {
    console.log('[SEARCH] Trying workspace symbol provider');
    const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', className) as vscode.SymbolInformation[];
    
    if (symbols && symbols.length > 0) {
      console.log('[SEARCH] Found symbols:', symbols.length);
      
      // Filter for class symbols and get their file URIs
      const classSymbols = symbols.filter(symbol => 
        symbol.kind === vscode.SymbolKind.Class && 
        symbol.name === className
      );
      
      if (classSymbols.length > 0) {
        const files = classSymbols.map(symbol => symbol.location.uri);
        console.log('[SEARCH] Found class files via symbols:', files.map(f => f.fsPath));
        return files;
      }
    }
  } catch (error) {
    console.log('[SEARCH] Workspace symbol provider failed:', error);
  }

  // Fallback: Use file search with intelligent patterns
  console.log('[SEARCH] Falling back to file search');
  return await findFilesByPattern(className);
}

/**
 * Intelligent file search with language detection and binary exclusion
 */
export async function findFilesByPattern(className: string): Promise<vscode.Uri[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error('No workspace folder found');
  }

  // Define common source file extensions
  const sourceExtensions = ['.java', '.ts', '.js', '.py', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.kt'];
  
  // Build pattern for all source extensions
  const patterns = sourceExtensions.map(ext => `**/${className}${ext}`);
  
  // Common binary/build directories to exclude
  const excludePattern = '{' + [
    '**/node_modules/**',
    '**/target/**',
    '**/build/**', 
    '**/bin/**',
    '**/out/**',
    '**/dist/**',
    '**/.git/**',
    '**/*.class',
    '**/*.jar',
    '**/*.war',
    '**/*.dll',
    '**/*.exe',
    '**/*.so',
    '**/*.dylib'
  ].join(',') + '}';

  const allFiles: vscode.Uri[] = [];
  
  // Search for each pattern
  for (const pattern of patterns) {
    try {
      const files = await vscode.workspace.findFiles(pattern, excludePattern, 50);
      allFiles.push(...files);
    } catch (error) {
      console.warn('[SEARCH] Pattern search failed for:', pattern, error);
    }
  }

  console.log('[SEARCH] Found files before filtering:', allFiles.map(f => f.fsPath));

  // Additional filtering for source files only
  const sourceFiles = allFiles.filter(file => {
    const path = file.fsPath.toLowerCase();
    
    // Must be a source file extension
    const isSourceFile = sourceExtensions.some(ext => path.endsWith(ext));
    if (!isSourceFile) return false;
    
    // Exclude binary/build directories
    const excludeDirs = ['/target/', '/build/', '/bin/', '/out/', '/dist/', '/.git/', '/node_modules/'];
    const inExcludedDir = excludeDirs.some(dir => path.includes(dir));
    
    return !inExcludedDir;
  });

  console.log('[SEARCH] Source files after filtering:', sourceFiles.map(f => f.fsPath));

  if (sourceFiles.length === 0) {
    throw new Error(`Class/symbol '${className}' not found in workspace. Searched for source files but only found compiled/binary versions in build directories.`);
  }

  return sourceFiles;
}

export async function readFileContent(fileUri: vscode.Uri): Promise<string> {
  const document = await vscode.workspace.openTextDocument(fileUri);
  return document.getText();
}

export async function getFileLineCount(fileUri: vscode.Uri): Promise<number> {
  const document = await vscode.workspace.openTextDocument(fileUri);
  return document.lineCount;
}
