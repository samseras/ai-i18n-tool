# AI i18n Tool

Automated internationalization tool using OpenAI to translate JavaScript language packs.

## Features

- Translates based on English (`en`) source files.
- Preserves directory structure (e.g., `locales/en/modules/foo.js` -> `locales/zh/modules/foo.js`).
- Preserves `export default` or `module.exports` structure.
- Supports root files (e.g., `locales/en.js`) and nested modules.
- On-demand language generation.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure API Key:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and add your OpenAI API Key (`OPENAI_API_KEY`).

## Usage

Run the script with the target language code as an argument.

Example: Translate to Chinese (Simplified)
```bash
npm run translate zh
```

Example: Translate to Portuguese
```bash
npm run translate pt
```

## Directory Structure

Expected structure:
```
locales/
├── en.js              # Root English file
├── en/
│   └── modules/       # English modules
│       └── common.js
├── zh.js              # Generated Chinese file
└── zh/
    └── modules/       # Generated Chinese modules
        └── common.js
```
