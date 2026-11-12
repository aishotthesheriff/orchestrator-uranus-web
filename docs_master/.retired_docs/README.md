# Quest to Uranus - Documentation Index

This directory contains comprehensive documentation for the Quest to Uranus game system. The documentation is organized into current versions (in the `current/` folder) and general guides in the root.

## Current Documentation (Latest Versions)

All up-to-date technical documentation is located in the [`current/`](./current/) folder:

### Core System Architecture
- **[GAME_EXECUTION_FLOW.md](./current/GAME_EXECUTION_FLOW.md)** - Complete game execution flow architecture, core components, and system design
- **[DATABASE_ARCHITECTURE_V2.md](./current/DATABASE_ARCHITECTURE_V2.md)** - Database schema, relationships, and data flow (auto-generated from live DB)
- **[CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md](./current/CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md)** - Client-side functionality, UI components, and React architecture
- **[MODULE_STORAGE.md](./current/MODULE_STORAGE.md)** - Storage layer architecture, execution flows, and data access patterns
- **[MODULE_ROUTES.md](./current/MODULE_ROUTES.md)** - Routes architecture, HTTP API gateway, WebSocket server, and background job processing
- **[MODULE_AI_SERVICE.md](./current/MODULE_AI_SERVICE.md)** - AI service architecture, dual-path execution (PCE/Legacy), and LLM integration
- **[MODULE_SERVER_ENTRY.md](./current/MODULE_SERVER_ENTRY.md)** - Express app initialization, security, health/metrics, and route mounting

### API & Integration
- **[API_GUIDE.md](./current/API_GUIDE.md)** - Complete API reference with endpoints, requests, and responses
- **[API_SECURITY.md](./current/API_SECURITY.md)** - Security architecture, authentication, authorization, and best practices
- **[API_TEST_GUIDE.md](./current/API_TEST_GUIDE.md)** - Testing procedures and examples for API endpoints

### Image System
- **[IMAGE_SYSTEM_ARCHITECTURE.md](./current/IMAGE_SYSTEM_ARCHITECTURE.md)** - Image generation architecture, caching, job processing, and multi-model support

### Game Systems
- **[EVENT_SYSTEM.md](./current/EVENT_SYSTEM.md)** - Event system, triggers, and procedural generation
- **[LOADING_STATE_ARCHITECTURE.md](./current/LOADING_STATE_ARCHITECTURE.md)** - Loading states, user experience, and async operation handling

### Prompt & Content System
- **[PROMPT_UI_FLOW_PCE.md](./current/PROMPT_UI_FLOW_PCE.md)** - Prompt UI workflow, PCE integration, and user interactions
- **[PCE_TECHNICAL_AUDIT.md](./current/PCE_TECHNICAL_AUDIT.md)** - Prompt Composition Engine technical audit and implementation details
- **[DEVTOOLS_USER_GUIDE.md](./current/DEVTOOLS_USER_GUIDE.md)** - Complete user guide for DevTools interface, all tabs, and content management workflows

### Operations & Deployment
- **[DOCKER.md](./current/DOCKER.md)** - Docker setup, deployment procedures, and containerization

### Analysis & Comparison
- **[DOCUMENTATION_COMPARISON_ANALYSIS.md](./current/DOCUMENTATION_COMPARISON_ANALYSIS.md)** - Cross-reference analysis and consistency review across documentation

## General Documentation

Core guides and user-facing documentation in the root directory:

### System Guides
- **[MAINTAINER_GUIDE.md](./MAINTAINER_GUIDE.md)** - System architecture overview, maintenance procedures, and operational guide
- **[SERVER_FUNCTIONAL_DOCUMENTATION.md](./SERVER_FUNCTIONAL_DOCUMENTATION.md)** - Server-side functionality and business logic overview
- **[MULTI_MODEL_IMAGE_ARCHITECTURE.md](./MULTI_MODEL_IMAGE_ARCHITECTURE.md)** - Multi-model image generation architecture

### Settings & Configuration
- **[SETTINGS_SYSTEM.md](./SETTINGS_SYSTEM.md)** - Settings management system, API, UI, and reference release integration

### Game-Specific Documentation
- **[PLAYER_GUIDE.md](./PLAYER_GUIDE.md)** - Player instructions and game mechanics
- **[GAME_PAGE_DOCUMENTATION.md](./GAME_PAGE_DOCUMENTATION.md)** - Game page functionality and user interface

## Quick Reference

### For Developers
1. Start with [MAINTAINER_GUIDE.md](./MAINTAINER_GUIDE.md) for system overview
2. Review [GAME_EXECUTION_FLOW.md](./current/GAME_EXECUTION_FLOW.md) for core execution architecture
3. Check [API_GUIDE.md](./current/API_GUIDE.md) for endpoint documentation
4. Review [MODULE_STORAGE.md](./current/MODULE_STORAGE.md) for data access patterns
5. Review [DATABASE_ARCHITECTURE_V2.md](./current/DATABASE_ARCHITECTURE_V2.md) for database structure
6. See [SETTINGS_SYSTEM.md](./SETTINGS_SYSTEM.md) for configuration management
7. Check [MODULE_ROUTES.md](./current/MODULE_ROUTES.md) for server orchestration
8. Review [MODULE_AI_SERVICE.md](./current/MODULE_AI_SERVICE.md) for AI integration

### For Content Creators
1. Read [DEVTOOLS_USER_GUIDE.md](./current/DEVTOOLS_USER_GUIDE.md) for complete DevTools interface documentation
2. Read [PROMPT_UI_FLOW_PCE.md](./current/PROMPT_UI_FLOW_PCE.md) for prompt management workflow
3. Review [EVENT_SYSTEM.md](./current/EVENT_SYSTEM.md) for event creation
4. Check [PCE_TECHNICAL_AUDIT.md](./current/PCE_TECHNICAL_AUDIT.md) for PCE implementation details

### For Players
1. Start with [PLAYER_GUIDE.md](./PLAYER_GUIDE.md) for game instructions
2. Check [GAME_PAGE_DOCUMENTATION.md](./GAME_PAGE_DOCUMENTATION.md) for UI help

### For Administrators
1. Read [DEVTOOLS_USER_GUIDE.md](./current/DEVTOOLS_USER_GUIDE.md) for DevTools interface and content management
2. Review [SETTINGS_SYSTEM.md](./SETTINGS_SYSTEM.md) for configuration management
3. Check [API_GUIDE.md](./current/API_GUIDE.md) for API endpoints

### For DevOps/Operations
1. Review [DOCKER.md](./current/DOCKER.md) for deployment procedures
2. Check [API_SECURITY.md](./current/API_SECURITY.md) for security architecture
3. Review [IMAGE_SYSTEM_ARCHITECTURE.md](./current/IMAGE_SYSTEM_ARCHITECTURE.md) for image generation infrastructure

## Documentation Structure

The documentation follows a modular architecture:
- **Module Documentation**: Detailed technical docs for specific components (Storage, Routes, AI Service)
- **System Documentation**: High-level architecture and flow documentation
- **API Documentation**: Endpoint references and testing guides
- **User Guides**: Player-facing and maintainer-facing guides

## Documentation Standards

### File Naming
- Use UPPERCASE with underscores for file names
- Include descriptive suffixes: `_GUIDE.md`, `_DOCUMENTATION.md`, `_ARCHITECTURE.md`
- Version suffixes (e.g., `_V2.md`) indicate updated versions

### Content Structure
- Start with overview and purpose
- Include detailed technical information
- Provide examples and code snippets
- Include troubleshooting sections where relevant
- Cross-reference related documentation

### Maintenance
- Update documentation when making system changes
- Include version information for major updates
- Keep examples current and working
- Review and update cross-references regularly
- Current versions live in `current/` folder

## Contributing to Documentation

1. **New Features**: Create or update relevant documentation files in `current/` folder
2. **Bug Fixes**: Update troubleshooting sections if applicable
3. **API Changes**: Update [API_GUIDE.md](./current/API_GUIDE.md) and related files
4. **UI Changes**: Update [CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md](./current/CLIENT_FUNCTIONAL_DOCUMENTATION_V2.md) and user guides
5. **Architecture Changes**: Update [GAME_EXECUTION_FLOW.md](./current/GAME_EXECUTION_FLOW.md) and module documentation
6. **Module Changes**: Update corresponding MODULE_*.md files in `current/` folder

## Questions or Issues

If you find documentation that is:
- Outdated or incorrect
- Missing important information
- Unclear or confusing
- Inconsistent with other docs

Please update the relevant file or create an issue for discussion.
