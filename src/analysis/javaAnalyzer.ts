import { CodeAnalysis } from '../types';
import { extractKeyElements } from './codeExtractor';
import { findJavaClass, getFileLineCount, readFileContent } from './workspaceSearch';

export async function analyzeJavaClass(className: string, methodName?: string): Promise<string> {
  // Search for Java files containing the class
  const files = await findJavaClass(className);
  
  // Read the first matching file
  const fileUri = files[0];
  const content = await readFileContent(fileUri);
  const lineCount = await getFileLineCount(fileUri);

  // Basic analysis - in a real implementation, you'd use a Java parser
  const analysis = `
## File Analysis: ${className}

**Location**: ${fileUri.fsPath}
**Lines of Code**: ${lineCount}

### Class Content Preview:
\`\`\`java
${content.substring(0, 2000)}${content.length > 2000 ? '...\n[TRUNCATED]' : ''}
\`\`\`

### Key Elements Detected:
${extractKeyElements(content, methodName)}
`;

  return analysis;
}

export async function getCodeAnalysis(className: string, methodName?: string): Promise<CodeAnalysis> {
  const files = await findJavaClass(className);
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
