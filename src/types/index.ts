import * as vscode from 'vscode';

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

export interface ChatHandlers {
  handleHelp: (stream: vscode.ChatResponseStream) => Promise<vscode.ChatResult>;
  handleAnalyze: (request: AnalysisRequest, chatRequest: vscode.ChatRequest, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => Promise<vscode.ChatResult>;
  handleBatch: (request: AnalysisRequest, chatRequest: vscode.ChatRequest, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => Promise<vscode.ChatResult>;
}

export interface RequirementsPromptOptions {
  codeAnalysis: string;
  className: string;
  methodName?: string;
}
