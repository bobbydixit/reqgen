export function extractKeyElements(content: string, targetMethod?: string): string {
  const elements = [];
  
  // Extract methods
  const methodMatches = content.match(/(?:public|private|protected)?\s*\w+\s+(\w+)\s*\([^)]*\)/g);
  if (methodMatches) {
    elements.push(`**Methods Found**: ${methodMatches.length} methods detected`);
    if (targetMethod) {
      const hasTargetMethod = methodMatches.some(m => m.includes(targetMethod));
      elements.push(`**Target Method**: ${targetMethod} ${hasTargetMethod ? '✅ Found' : '❌ Not Found'}`);
    }
  }
  
  // Extract imports
  const importMatches = content.match(/import\s+[^;]+;/g);
  if (importMatches) {
    elements.push(`**Dependencies**: ${importMatches.length} imports detected`);
  }
  
  // Extract class inheritance
  const extendsMatch = content.match(/class\s+\w+\s+extends\s+(\w+)/);
  if (extendsMatch) {
    elements.push(`**Inheritance**: Extends ${extendsMatch[1]}`);
  }
  
  return elements.join('\n');
}

export function extractMethods(content: string): string[] {
  const methodMatches = content.match(/(?:public|private|protected)?\s*\w+\s+(\w+)\s*\([^)]*\)/g);
  return methodMatches || [];
}

export function extractImports(content: string): string[] {
  const importMatches = content.match(/import\s+[^;]+;/g);
  return importMatches || [];
}

export function extractInheritance(content: string): string | undefined {
  const extendsMatch = content.match(/class\s+\w+\s+extends\s+(\w+)/);
  return extendsMatch ? extendsMatch[1] : undefined;
}
