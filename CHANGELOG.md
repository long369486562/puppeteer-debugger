# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-17

### Added
- Initial release of Puppeteer Debugger
- Web UI for connecting to Chrome DevTools Protocol
- Dual-mode JavaScript execution (Browser context & Puppeteer API)
- Real-time console output display
- Page management (view, create, switch, close)
- Responsive design with modern UI
- WebSocket communication for real-time updates
- Configuration system with config.js
- Integration tests

### Features
- 🔗 Connect to running Chrome instances via CDP
- 📄 Manage browser pages with intuitive UI
- 💻 Execute JavaScript in two modes:
  - Browser context (access to window, document, etc.)
  - Puppeteer API (page.goto, page.click, etc.)
- 📝 Display execution results and console logs
- 🎨 Clean, responsive web interface
- ⚡ Real-time communication via WebSocket

### Technical Details
- Built with Node.js, puppeteer-core, and ws
- No frontend framework dependencies (vanilla JS)
- Modern CSS with Grid and Flexbox layouts
- Chrome DevTools Protocol integration
- Configurable server and Chrome ports

## [Unreleased]

### Planned
- Add code syntax highlighting
- Support for multiple Chrome instances
- Export/import code snippets
- Performance monitoring panel
- Dark mode theme support