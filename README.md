# Flow Analysis VS Code Extension

AI-powered VS Code Chat Participant that provides linear code walkthrough analysis using GitHub Copilot language models. Like stepping through a debugger, but with AI-generated explanations.

## Features

- 🚀 **Linear Code Flow Analysis**: Step-by-step execution walkthrough like a debugger
- 🔍 **Smart Method Tracing**: Automatically finds and analyzes method execution paths
- 🧠 **Dynamic Programming Cache**: Optimized performance with intelligent caching
- ⚡ **Real-time Streaming**: Live responses as analysis progresses
- 🤖 **Model Selection**: Choose from available GitHub Copilot models (GPT-4o, Claude 3.5 Sonnet, etc.)

## Basic Usage

```
@reqgen flow ClassName.methodName
@reqgen flow UserService.createUser
@reqgen flow PaymentProcessor.processPayment
```

## Model & Cache Management

```
@reqgen flow change-model      # Select a different AI model
@reqgen flow current-model     # Show current model
@reqgen flow clear-cache       # Reset analysis cache
```

## Help

```
@reqgen help
```

## Available AI Models

When you first run a flow analysis, you'll be prompted to choose from your available GitHub Copilot models:

- **Dynamic Model Detection**: All models available through your GitHub Copilot subscription
- **Recommended Default**: First model is marked as recommended
- **Model Information**: Each model shows vendor, family, and capabilities
- **Easy Switching**: Change models anytime with `@reqgen flow change-model`

Your model choice is remembered for the session. The extension adapts to whatever models are available through your GitHub Copilot subscription.
