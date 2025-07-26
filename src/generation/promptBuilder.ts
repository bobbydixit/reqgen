import { RequirementsPromptOptions } from '../types';
import { REQUIREMENTS_TEMPLATE } from './templates';

export function buildRequirementsPrompt(options: RequirementsPromptOptions): string {
  const { codeAnalysis, className, methodName } = options;
  
  return REQUIREMENTS_TEMPLATE
    .replace('{codeAnalysis}', codeAnalysis)
    .replace('{className}', className)
    .replace('{methodName}', methodName ? ` - ${methodName} Method` : '');
}

export function interpolateTemplate(template: string, variables: Record<string, string | number>): string {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    result = result.replace(new RegExp(placeholder, 'g'), String(value));
  }
  
  return result;
}
