# RequirementsGen (@reqgen) 🚀

AI-powered VS Code Chat Participant that analyzes Java code and generates detailed product requirements documents using GitHub Copilot language models.

## Features

- 🔍 **Deep Code Analysis**: Automatically finds and analyzes Java classes in your workspace
- 📋 **Detailed Requirements Generation**: Creates comprehensive PRD-style requirements documents
- 🏭 **Batch Processing**: Analyze multiple classes in hour-long documentation cycles
- 🤖 **GitHub Copilot Integration**: Uses advanced language models (GPT-4o, Claude Sonnet)
- ⚡ **Real-time Streaming**: Get results as they're generated

## Usage

### Single Class Analysis

```
@reqgen analyze UserService
@reqgen analyze PaymentProcessor.processPayment
```

### Batch Analysis (Perfect for hour-long documentation cycles)

```
@reqgen batch analyze classes: UserService, PaymentProcessor, OrderManager
@reqgen batch multiple AuthService, EmailService, NotificationHandler
```

### Get Help

```
@reqgen help
```

## Requirements Document Format

The extension generates requirements in this proven format:

- **Introduction**: Business context and purpose
- **Requirements**: 6-10 detailed requirements with user stories
- **Acceptance Criteria**: 5 criteria per requirement using SHALL language
- **Dependencies**: Technical and business constraints

### Sample Output Structure

```markdown
# Requirements Document: UserService

## Introduction
Business context explaining the user management functionality...

## Requirements

### Requirement 1: User Registration Processing
**User Story:** As a new user, I want my registration to be processed securely...

#### Acceptance Criteria
1. WHEN a user submits registration data THEN the system SHALL validate all required fields
2. WHEN validation passes THEN the system SHALL create the user account
...

### Requirement 2: Authentication Management
...
```

## Installation

1. Install the extension
2. Ensure GitHub Copilot is enabled in VS Code
3. Open a Java workspace
4. Start chatting with `@reqgen`

## Commands

- `@reqgen analyze [ClassName]` - Analyze single class
- `@reqgen batch analyze classes: Class1, Class2, Class3` - Batch analysis
- `@reqgen help` - Show help and usage

## Powered By

- **VS Code Chat Participant API**
- **GitHub Copilot Language Models** 
- **Workspace File Analysis**
- **Java Code Pattern Recognition**

## Perfect For

- Product Managers creating PRDs from existing code
- Business Analysts documenting legacy systems  
- Development teams standardizing requirements
- Code audits and documentation sprints
- Hour-long batch processing sessions

## Example Use Cases

### E-commerce Platform
```
@reqgen batch analyze classes: OrderService, PaymentProcessor, InventoryManager, ShippingHandler
```

### User Management System
```
@reqgen batch analyze classes: UserService, AuthenticationService, ProfileManager, RoleHandler
```

### Content Management
```
@reqgen batch analyze classes: ContentService, MediaHandler, PublishingEngine, SearchIndexer
```

---

**Tip**: Use batch mode for comprehensive documentation cycles. Perfect for analyzing entire service layers or feature modules in one session!
