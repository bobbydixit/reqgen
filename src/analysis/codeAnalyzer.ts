import { CodeAnalysis } from '../types';
import { extractKeyElements } from './codeExtractor';
import { findClassOrSymbol, getFileLineCount, readFileContent } from './workspaceSearch';

export async function analyzeClass(className: string, methodName?: string): Promise<string> {
  // Search for files containing the class
  const files = await findClassOrSymbol(className);
  
  // Read the first matching file
  const fileUri = files[0];
  const content = await readFileContent(fileUri);
  const lineCount = await getFileLineCount(fileUri);

  // Detect language from file extension
  const fileExtension = fileUri.fsPath.split('.').pop()?.toLowerCase() || 'unknown';
  const languageMap: Record<string, string> = {
    'java': 'java',
    'ts': 'typescript',
    'js': 'javascript',
    'py': 'python',
    'cs': 'csharp',
    'cpp': 'cpp',
    'c': 'c',
    'go': 'go',
    'rs': 'rust',
    'kt': 'kotlin'
  };
  const language = languageMap[fileExtension] || fileExtension;

  // Basic analysis - language agnostic
  const analysis = `
## File Analysis: ${className}

**Location**: ${fileUri.fsPath}
**Language**: ${language}
**Lines of Code**: ${lineCount}

### Class Content Preview:
\`\`\`${language}
${content.substring(0, 2000)}${content.length > 2000 ? '...\n[TRUNCATED]' : ''}
\`\`\`

### Key Elements Detected:
${extractKeyElements(content, methodName)}
`;

  return analysis;
}

export async function getCodeAnalysis(className: string, methodName?: string): Promise<CodeAnalysis> {
  const files = await findClassOrSymbol(className);
  const fileUri = files[0];
  const content = await readFileContent(fileUri);
  const lineCount = await getFileLineCount(fileUri);

  return {
    className,
    filePath: fileUri.fsPath,
    lineCount,
    content: content.substring(0, 2000), // Truncate for analysis
    methods: [], // Will be populated by codeExtractor
    imports: [], // Will be populated by codeExtractor
    inheritance: undefined // Will be populated by codeExtractor
  };
}
