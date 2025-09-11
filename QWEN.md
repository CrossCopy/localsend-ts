# LocalSend TypeScript Implementation

This project is a TypeScript implementation of the LocalSend protocol, which enables local network file sharing between devices without requiring an internet connection.

## Project Overview

LocalSend provides a secure way to transfer files between devices on the same network. This TypeScript implementation includes both a CLI tool and a library that can be used in other projects.

### Key Features

- Cross-platform file sharing (Windows, macOS, Linux)
- Secure transfers with PIN authentication
- Support for large file transfers with progress tracking
- Device discovery using multicast UDP and HTTP scanning
- RESTful API for integration with other applications
- Built with modern TypeScript and Hono framework

### Technologies Used

- **Runtime**: Bun (primary), with Node.js and Deno compatibility
- **Framework**: Hono for API routing
- **Validation**: Valibot for schema validation
- **CLI**: Citty for command-line interface
- **Build Tool**: Bun build system
- **Documentation**: OpenAPI/Swagger with Scalar API Reference

## Project Structure

```
src/
├── api/           # Server and client implementations
├── discovery/     # Device discovery mechanisms
├── sdk/           # Auto-generated API client
├── types.ts       # Type definitions and schemas
├── config.ts      # Configuration constants
├── index.ts       # Main exports
└── cli.ts         # Command-line interface
```

## CLI Usage

The CLI provides three main commands:

1. **Send**: Send files to another device
   ```
   localsend send <target-ip> <file-path>
   ```

2. **Receive**: Start a receiver to accept files
   ```
   localsend receive
   ```

3. **Discover**: Find devices on the local network
   ```
   localsend discover
   ```

For detailed usage, run:
```
localsend --help
```

## Library Usage

The library can be imported and used in other TypeScript/JavaScript projects:

```typescript
import {
  LocalSendServer,
  LocalSendClient,
  MulticastDiscovery
} from 'localsend'

// Create a server
const server = new LocalSendHonoServer(deviceInfo)
await server.start()

// Create a client
const client = new LocalSendClient(deviceInfo)
```

See `src/cli.ts` for detailed usage examples.

## Development

### Building

To build the project:
```bash
bun run build
```

This will:
1. Generate the SDK from the OpenAPI spec
2. Compile the CLI to `dist/cli.js`
3. Make the CLI executable

### Development Server

To run in development mode:
```bash
bun run dev
```

### Formatting

To format the code:
```bash
bun run format
```

## API Documentation

When running the server, API documentation is available at:
- OpenAPI spec: `http://localhost:<port>/openapi`
- Interactive docs: `http://localhost:<port>/docs`

## Testing

To run tests (if available):
```bash
# Test command would be specified here if tests existed
```

Note: This project currently doesn't have explicit test files in the src directory.

## Contributing

This project uses Changesets for version management. To contribute:

1. Make your changes
2. Run `bun changeset` to create a changeset
3. Commit your changes
4. Submit a pull request

## Deployment

The built CLI can be installed globally with:
```bash
npm install -g localsend
```

Or run directly with:
```bash
npx localsend
```