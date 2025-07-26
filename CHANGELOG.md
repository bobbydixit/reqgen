# Change Log

All notable changes to the RequirementsGen extension will be documented in this file.

## [0.1.0] - 2025-07-26

### Added
- Initial release of RequirementsGen (@reqgen) chat participant
- Single class analysis with `@reqgen analyze ClassName`
- Batch processing with `@reqgen batch analyze classes: Class1, Class2, Class3`
- GitHub Copilot integration (GPT-4o, Claude Sonnet support)
- Real-time streaming responses
- Automatic Java workspace file discovery
- Product requirements document generation in standardized format
- Help system with `@reqgen help`
- Support for method-level analysis (`ClassName.methodName`)
- Error handling and user feedback
- VS Code Chat Participant API integration

### Features
- **Deep Code Analysis**: Automatically finds and analyzes Java classes
- **Requirements Generation**: Creates comprehensive PRD-style documents
- **Batch Processing**: Hour-long documentation cycles for multiple classes
- **AI Integration**: Uses advanced language models for intelligent analysis
- **Workspace Integration**: Seamless VS Code workspace file analysis

### Technical Details
- Built with TypeScript and VS Code Extension API
- Uses webpack for optimized bundling
- Supports VS Code 1.102.0+
- MIT licensed for open source usage

---

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.
