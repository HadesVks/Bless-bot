const fs = require('fs');
const path = require('path');

const mainFile = path.join(__dirname, 'main.js');
let code = fs.readFileSync(mainFile, 'utf8');

const requireRegex = /(?:const|let|var)\s+(?:{[^}]+}|[a-zA-Z0-9_]+)\s*=\s*require\(['"]\.\/commands\/([a-zA-Z0-9_-]+)['"]\);?/g;

let match;
const missingModules = [];

while ((match = requireRegex.exec(code)) !== null) {
    const fullStatement = match[0];
    const moduleName = match[1];
    const modulePath = path.join(__dirname, 'commands', `${moduleName}.js`);
    
    if (!fs.existsSync(modulePath)) {
        missingModules.push({ statement: fullStatement, name: moduleName });
    }
}

if (missingModules.length > 0) {
    console.log(`Found ${missingModules.length} missing modules in main.js. Fixing...`);
    
    missingModules.forEach(({ statement, name }) => {
        console.log(`Removing import for: ${name}`);
        code = code.replace(statement, `// [DELETED] ${statement}`);
    });

    fs.writeFileSync(mainFile, code);
    console.log('main.js has been fixed!');
} else {
    console.log('No missing modules found in main.js.');
}
