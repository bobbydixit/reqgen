# Contributing to RequirementsGen

Thank you for your interest in contributing to RequirementsGen! This document provides guidelines for contributing to the project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Install dependencies**: `npm install`
4. **Compile the extension**: `npm run compile`
5. **Test your changes**: Press `F5` to launch the extension host

## Development Workflow

### Setting Up the Development Environment

```bash
git clone https://github.com/your-username/requirements-generator.git
cd requirements-generator
npm install
npm run watch  # For continuous compilation
```

### Testing Your Changes

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. In the new window, open a Java project
4. Test the chat participant with `@reqgen help`

## Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic
- Ensure all code compiles without warnings

## Submitting Changes

1. **Create a feature branch**: `git checkout -b feature/your-feature-name`
2. **Make your changes** with clear, descriptive commits
3. **Test thoroughly** with various Java codebases
4. **Update documentation** if needed
5. **Submit a pull request** with:
   - Clear description of changes
   - Test cases covered
   - Screenshots/examples if applicable

## Types of Contributions

### Bug Fixes
- Fix parsing issues with Java code
- Resolve chat participant registration problems
- Improve error handling and user feedback

### Features
- Support for additional programming languages
- Enhanced code analysis capabilities
- New requirements document formats
- Integration with other VS Code extensions

### Documentation
- Improve README and usage examples
- Add more comprehensive API documentation
- Create video tutorials or walkthroughs
- Translate documentation to other languages

### Testing
- Add unit tests for core functionality
- Create integration tests for chat participant
- Test with diverse Java codebases
- Performance testing and optimization

## Project Structure

```
src/
├── extension.ts          # Main extension entry point
├── analysis/            # Code analysis modules (future)
├── templates/           # Requirements templates (future)
└── utils/               # Utility functions (future)
```

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create GitHub release
4. Publish to VS Code Marketplace (maintainers only)

## Community Guidelines

- Be respectful and inclusive
- Provide constructive feedback
- Help newcomers get started
- Share ideas and discuss improvements

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for general questions
- Check existing issues before creating new ones

Thank you for contributing to RequirementsGen!
