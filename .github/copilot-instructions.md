---
applyTo: "**"
---

# Botpress v12 Copilot Instructions

## Project Overview
This is a **Botpress v12** fork - a powerful open-source conversational AI platform built with TypeScript and Node.js. Botpress is a modular chatbot development framework that enables developers to create sophisticated conversational applications with natural language understanding, multiple channel integrations, and a visual flow designer.

## Architecture & Structure

### Core Components
- **Core Engine** (`packages/bp/`): The main Botpress application with dependency injection using Inversify
- **Modules** (`modules/`): Pluggable modules that extend functionality (NLU, analytics, channels, etc.)
- **Admin UI** (`packages/ui-admin/`): React-based administration interface
- **Shared Libraries** (`packages/ui-shared/`): Common React components and utilities
- **SDK** (`packages/bp/src/sdk/`): TypeScript definitions and API interfaces

### Key Architecture Patterns
- **Dependency Injection**: Uses Inversify with decorators (`@injectable`, `@inject`)
- **Module System**: Pluggable architecture with `ModuleEntryPoint` interface
- **Event-Driven**: Middleware-based event processing with hooks
- **Monorepo Structure**: Yarn workspaces for package management
- **TypeScript-First**: Strongly typed with comprehensive SDK definitions

## Development Guidelines

### Code Style & Conventions
- **TypeScript**: Prefer strict typing, use interfaces over types
- **Async/Await**: Use async/await over promises, handle errors with try/catch
- **Lodash**: Extensively used for utilities (`_.get`, `_.map`, `_.merge`, etc.)
- **Optional Chaining**: Use `?.` operator for safe property access
- **Strict Equality**: Always use `===` instead of `==`
- **Null Coalescing**: Prefer `??` over `||` when appropriate
- **Minimal Code**: Keep it simple - less code = fewer bugs

### File Organization
- **Barrel Exports**: Use index files to export from directories
- **Separation of Concerns**: Split logic into focused, single-purpose files
- **Module Structure**: Follow `/src/backend/` and `/src/views/` pattern for modules
- **Configuration**: Use JSON schemas for module configuration validation

## Module Development

### Module Entry Point Structure
```typescript
const entryPoint: sdk.ModuleEntryPoint = {
  onServerStarted?: (bp: typeof sdk) => Promise<void>,
  onServerReady?: (bp: typeof sdk) => Promise<void>,
  onBotMount?: (bp: typeof sdk, botId: string) => Promise<void>,
  onBotUnmount?: (bp: typeof sdk, botId: string) => Promise<void>,
  onFlowChanged?: (bp: typeof sdk, botId: string, flow: sdk.Flow) => Promise<void>,
  skills?: sdk.Skill[],
  botTemplates?: sdk.BotTemplate[],
  dialogConditions?: sdk.Condition[],
  translations?: { [lang: string]: object },
  definition: {
    name: string,
    fullName: string,
    menuIcon: string,
    menuText: string,
    homepage: string,
    noInterface?: boolean
  }
}
```

### SDK Usage Patterns
- **Logger**: Always use scoped logging: `bp.logger.info()`, `bp.logger.forBot(botId)`
- **Database**: Access via `bp.database` (Knex instance)
- **Configuration**: Use `bp.config.getModuleConfigForBot(moduleName, botId)`
- **Events**: Register middleware with `bp.events.registerMiddleware()`
- **HTTP**: Create bot-specific routes with `bp.http.createRouterForBot()`

### Common Patterns
```typescript
// Module initialization
const onServerStarted = async (bp: typeof sdk) => {
  // Database setup, middleware registration
}

const onServerReady = async (bp: typeof sdk) => {
  // API routes, final setup
}

// Bot lifecycle
const onBotMount = async (bp: typeof sdk, botId: string) => {
  const config = await bp.config.getModuleConfigForBot('module-name', botId)
  // Bot-specific initialization
}
```

## Key APIs & Services

### Core Services
- **ModuleLoader**: Manages module lifecycle and loading
- **ConfigReader**: Handles configuration with precedence (defaults → global → env → bot-specific)
- **GhostService**: File system abstraction for bot content
- **EventEngine**: Processes incoming/outgoing events through middleware
- **DialogEngine**: Manages conversation flows and state
- **BotService**: Bot management and lifecycle operations

### Hook System
Available hooks: `before_incoming_middleware`, `after_incoming_middleware`, `before_outgoing_middleware`, `after_event_processed`, `before_session_timeout`, `after_server_start`, `after_bot_mount`, `after_bot_unmount`

### Event Processing
- Events flow through middleware chains
- Use `event.setFlag()` to control processing
- State management via `event.state` (temp, session, user, bot)

## Database & Storage

### Database Access
- **Knex**: Use `bp.database` for SQL operations
- **Migrations**: Handle in module's `onServerStarted` lifecycle
- **Ghost**: Use `bp.ghost` for file operations (bot content, configurations)

### Configuration Precedence
1. Default values (lowest priority)
2. Global configuration
3. Environment variables
4. Bot-specific configuration (highest priority)

## Testing & Build

### Testing Framework
- **Jest**: Unit tests (`jest.unit.config.ts`)
- **E2E Tests**: Integration tests (`jest.e2e.config.ts`)
- **Linting**: ESLint with TypeScript rules

### Build System
- **Gulp**: Primary build system
- **Module Builder**: Specialized builder for modules
- **Yarn**: Package management with workspaces
- **Docker**: Containerization support

## Common Gotchas & Best Practices

### Performance
- Use `@Memoize()` decorator for expensive operations
- Implement caching where appropriate (LRU cache pattern)
- Handle background processes carefully with proper cleanup

### Error Handling
- Always wrap external calls in try/catch
- Use `bp.logger.attachError(err)` for proper error logging
- Implement graceful degradation for non-critical failures

### Memory Management
- Clean up listeners in `onBotUnmount` and `onModuleUnmount`
- Clear caches appropriately
- Use WeakMap/WeakSet for temporary references

### Security
- Validate all inputs using Joi schemas
- Use proper authentication middleware
- Sanitize user content before storage/display

## Environment & Configuration

### Environment Variables
- `NODE_ENV`: Environment mode (development, production)
- `CLUSTER_ENABLED`: Enable clustering
- `BPFS_STORAGE`: Storage backend (disk, database)
- `DATABASE_URL`: Database connection string

### Configuration Files
- `botpress.config.ts`: Main configuration
- `config/`: Module-specific configurations
- `data/`: Runtime data and bot content

## Debugging & Development

### Debugging Tools
- Use `DEBUG` environment variable for detailed logging
- Studio debugging interface for flow execution
- Event logs for tracing conversations
- Performance profiling with built-in tools

### Development Workflow
1. Start with `yarn start` for development
2. Use `yarn watch` for auto-rebuilding
3. Module development: `yarn build` in module directory
4. Testing: `yarn test:unit` or `yarn test:e2e`

Remember: Botpress v12 is a mature, production-ready platform. Focus on stability, performance, and maintainability when making changes. Always consider backward compatibility and the impact on existing bots when modifying core functionality.