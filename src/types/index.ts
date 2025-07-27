
// Legacy interfaces - kept for potential future use or existing code compatibility
export interface AnalysisRequest {
  method?: string;
  className?: string;
  filePath?: string;
  classes?: string[];
  batchMode?: boolean;
}

export interface CodeAnalysis {
  className: string;
  filePath: string;
  lineCount: number;
  content: string;
  methods: string[];
  imports: string[];
  inheritance?: string;
}

export interface RequirementsPromptOptions {
  codeAnalysis: string;
  className: string;
  methodName?: string;
}

// Note: Flow analysis uses its own types defined in src/flow/types.ts
