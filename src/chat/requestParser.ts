import { AnalysisRequest } from '../types';

export function parseRequest(prompt: string): AnalysisRequest {
  const lines = prompt.split('\n');
  const firstLine = lines[0].toLowerCase();
  
  // Check for batch mode
  if (firstLine.includes('batch') || firstLine.includes('multiple') || firstLine.includes('classes')) {
    const classMatches = prompt.match(/class(?:es)?\s*:?\s*([^\n]+)/i);
    if (classMatches) {
      const classList = classMatches[1].split(',').map(c => c.trim()).filter(c => c);
      return { classes: classList, batchMode: true };
    }
  }
  
  // Extract class name and method
  const classMatch = prompt.match(/(\w+(?:Executor|Manager|Service|Controller|Handler))/);
  const methodMatch = prompt.match(/(\w+(?:Request|Process|Execute|Handle))/);
  
  return {
    className: classMatch ? classMatch[1] : undefined,
    method: methodMatch ? methodMatch[1] : undefined,
    batchMode: false
  };
}
