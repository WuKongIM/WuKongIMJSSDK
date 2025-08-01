const fs = require('fs');
const path = require('path');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

// Generate version.ts content
const versionContent = `// This file is auto-generated during build process
export const SDK_VERSION = "${packageJson.version}";
`;

// Write version.ts
fs.writeFileSync(path.join(__dirname, '../src/version.ts'), versionContent);

console.log(`Generated version.ts with SDK_VERSION = "${packageJson.version}"`);
