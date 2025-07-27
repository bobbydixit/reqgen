/**
 * Simple language detection based on file extension
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  
  switch (ext) {
    case 'java':
      return 'java';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    case 'cs':
      return 'csharp';
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'c':
      return 'c';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'kt':
      return 'kotlin';
    case 'scala':
      return 'scala';
    default:
      return 'java'; // Default fallback
  }
}
