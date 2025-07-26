export const REQUIREMENTS_TEMPLATE = `You are a senior business analyst and product requirements expert. Your task is to analyze Java code and generate detailed product requirements documents.

{codeAnalysis}

Based on this code analysis, generate a comprehensive requirements document following this EXACT format:

# Requirements Document: {className}{methodName}

## Introduction

Provide a clear business context introduction explaining what this code accomplishes from a user/business perspective.

## Requirements

### Requirement 1: [Core Functionality]

**User Story:** As a [user type], I want [capability], so that [business value].

#### Acceptance Criteria

1. WHEN [condition] THEN the system SHALL [behavior]
2. WHEN [condition] THEN the system SHALL [behavior]
3. WHEN [condition] THEN the system SHALL [behavior]
4. WHEN [condition] THEN the system SHALL [behavior]
5. WHEN [condition] THEN the system SHALL [behavior]

### Requirement 2: [Secondary Functionality]

**User Story:** As a [user type], I want [capability], so that [business value].

#### Acceptance Criteria

1. WHEN [condition] THEN the system SHALL [behavior]
2. WHEN [condition] THEN the system SHALL [behavior]
3. WHEN [condition] THEN the system SHALL [behavior]
4. WHEN [condition] THEN the system SHALL [behavior]
5. WHEN [condition] THEN the system SHALL [behavior]

[Continue with 6-10 total requirements covering all aspects: validation, error handling, integration, configuration, data persistence, security, performance, etc.]

## Dependencies and Constraints

List any technical dependencies, business constraints, or integration requirements.

CRITICAL INSTRUCTIONS:
- Focus on WHAT the system should do, NOT HOW it should be implemented
- Write from business/product perspective, not technical implementation
- Use SHALL language for definitive requirements
- Each requirement must have exactly 5 acceptance criteria
- Cover functional, non-functional, integration, and operational requirements
- Do not mention specific classes, methods, or technical architecture details
- Write as if this is a specification for building the feature from scratch`;

export const HELP_TEMPLATE = `# 🚀 RequirementsGen (@reqgen) Help

## Commands

### Single Analysis
\`\`\`
@reqgen analyze ClassName.methodName
@reqgen analyze UserService.createUser
@reqgen analyze PaymentProcessor.processPayment
\`\`\`

### Batch Analysis (Hour-long cycles)
\`\`\`
@reqgen batch analyze classes: UserService, PaymentProcessor, OrderManager
@reqgen batch multiple AuthService, EmailService, NotificationHandler
\`\`\`

### What I Generate
- 📋 **Detailed Requirements Documents** in proven PRD format
- 🔍 **Deep Code Analysis** with inheritance chains
- 📊 **Business Rule Validation** requirements  
- 🔄 **State Management** specifications
- 📈 **Integration Requirements** for system coordination

### Powered By
- 🤖 **GitHub Copilot** language models (GPT-4o, Claude Sonnet)
- 📁 **VS Code Workspace** analysis
- ⚡ **Real-time streaming** responses

Try: \`@reqgen analyze [YourClassName]\` to get started!`;

export const BATCH_HEADER_TEMPLATE = `# 🏭 Batch Requirements Generation

Analyzing {classCount} classes for detailed requirements generation...

`;

export const BATCH_COMPLETION_TEMPLATE = `

# 🎉 Batch Analysis Complete

- **Total Classes Analyzed**: {processedCount}/{totalClasses}
- **Status**: {status}

Each class now has detailed requirements documentation ready for your PRD process!`;
