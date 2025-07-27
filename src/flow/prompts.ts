export const METHOD_ANALYSIS_PROMPT = `You are a code execution tracer that documents method execution flow step-by-step, like a debugger walkthrough.

ANALYSIS TASK:
Analyze the specified method within the provided class file. Focus on the target method but use the full class context for better understanding of variables, fields, and method relationships.

TARGET METHOD:
Class: {className}
Method: {methodName}
Language: {language}

FULL CLASS FILE:
\`\`\`{language}
{fileContent}
\`\`\`

FOCUS: Analyze the method "{methodName}" within this class, but use the full class context for understanding.

EXECUTION FLOW ANALYSIS:
Break the method into execution blocks and document the flow. For each block:

1. **Identify semantic blocks** (not line-by-line):
   - Variable assignments
   - Method calls
   - Conditional statements
   - Loops
   - Complex expressions (like: methodA() && methodB())
   - Return statements

2. **For complex expressions**, handle execution semantics:
   - Short-circuit evaluation (&&, ||)
   - Conditional execution order
   - Method call dependencies

3. **For method calls**, make step-in decisions:
   - **Step Into**: Own application code (classes in this codebase)
   - **Don't Step Into**: Framework code, utility libraries, external APIs
   - **Mark as External**: Calls where implementation not found

OUTPUT FORMAT:
Use structured markdown with this exact format:

## Method Analysis: {className}.{methodName}()

### Execution Blocks:

#### Block 1: [Block Description]
**Type**: [assignment|methodCall|conditional|loop|shortCircuit|return]
**Description**: [What this block does in plain English]

**Execution Flow**:
[Detailed step-by-step execution description]

**Method Calls**:
{If any method calls in this block}
- **Call**: \`className.methodName()\`
  - **Step Into**: [Yes/No] ([Reasoning])
  - **Expected Behavior**: [What this method likely does]

#### Block 2: [Next Block Description]
[Continue with remaining blocks...]

### Method Call Summary:
{List all method calls found with step-in decisions}

#### Step Into (Own Code):
- \`ClassName.methodName()\` - [Brief description]
- \`AnotherClass.anotherMethod()\` - [Brief description]

#### External Calls (No Step-In):
- \`frameworkClass.utilityMethod()\` - Framework utility
- \`library.externalAPI()\` - External service call

#### Implementation Not Found:
- \`SomeClass.missingMethod()\` - ⚠️ Implementation not available
  - **Inferred Purpose**: [Best guess from method name/context]
  - **Expected Behavior**: [What this method likely does]

ANALYSIS GUIDELINES:

**Complex Expressions**:
For: \`var c = methodA() && methodB();\`
Document as:
- methodA() executes first (always)
- methodB() executes only if methodA() returns true
- Variable c gets the final result

**Step-In Strategy**:
- **Step Into**: Classes that appear to be application code
- **Don't Step Into**: 
  - Standard library classes (String, List, Map, etc.)
  - Framework classes (Spring, Hibernate, etc.)
  - Utility libraries (Apache Commons, etc.)
  - External service calls

**Error Handling**:
- If method implementation not found, mark as "Implementation Not Found"
- Provide inferred purpose from method name and context
- Continue analysis without stopping

**Be Specific**:
- Use actual class names and method names from the code
- Include parameter information when relevant
- Describe the logical flow, not just the syntax

Generate the complete analysis following this format exactly.`;

export const buildMethodAnalysisPrompt = (
  className: string,
  methodName: string,
  fileContent: string,
  language: string
): string => {
  return METHOD_ANALYSIS_PROMPT
    .replace(/{className}/g, className)
    .replace(/{methodName}/g, methodName)
    .replace(/{fileContent}/g, fileContent)
    .replace(/{language}/g, language);
};

// Configuration for analysis limits
export const ANALYSIS_CONFIG = {
  maxCallStackDepth: 8,
  maxTotalMethods: 30,
  maxAnalysisTimeMs: 45000,
  stepIntoStrategy: 'conservative' as const,
  enableCaching: true,
  cacheExpiryMs: 300000, // 5 minutes
};

// Prompt for when method implementation is not found
export const MISSING_METHOD_PROMPT = `You are documenting a method call where the implementation is not available.

METHOD CALL: {className}.{methodName}({parameters})
CONTEXT: Called from {callingMethod} in {callingClass}

Provide documentation for this missing method:

## External Method Call
**Method**: \`{className}.{methodName}({parameters})\`
**Status**: ⚠️ Implementation not found
**Inferred Purpose**: [Based on method name and context, what does this method likely do?]
**Expected Behavior**: 
- [What inputs does it likely expect?]
- [What processing does it likely perform?]
- [What does it likely return?]
**Open Questions**: 
- [What specific details need to be clarified?]
- [What edge cases might exist?]
- [What error conditions might occur?]

Keep it concise but informative. Focus on what can be reasonably inferred from the method signature and calling context.`;

export const buildMissingMethodPrompt = (
  className: string,
  methodName: string,
  parameters: string,
  callingClass: string,
  callingMethod: string
): string => {
  return MISSING_METHOD_PROMPT
    .replace(/{className}/g, className)
    .replace(/{methodName}/g, methodName)
    .replace(/{parameters}/g, parameters)
    .replace(/{callingClass}/g, callingClass)
    .replace(/{callingMethod}/g, callingMethod);
};
