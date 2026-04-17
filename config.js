/**
 * Puppeteer Debugger Configuration
 *
 * This file contains all configuration settings for the application.
 * Use this file to customize server ports, Chrome settings, and other options.
 */

module.exports = {
  // Server configuration
  server: {
    // Port where the HTTP server and WebSocket will run
    port: 9000,
    // Host to bind the server to
    host: 'localhost'
  },

  // Chrome configuration
  chrome: {
    // Default port for Chrome remote debugging
    defaultPort: 9555,
    // Timeout for Chrome connection attempts (in milliseconds)
    connectTimeout: 5000
  },

  // UI configuration
  ui: {
    // Default theme (can be extended for dark/light themes)
    theme: 'light',
    // Maximum console messages to keep in memory
    maxConsoleMessages: 1000
  },

  // Development settings
  development: {
    // Enable debug logging
    debugLogging: false,
    // Enable CORS for development
    enableCors: false
  }
};