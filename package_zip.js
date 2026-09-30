const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetDir = 'C:\\Users\\Administrator\\.gemini\\antigravity-ide\\scratch\\gadgetguard';
const tempDir = path.join(process.env.TEMP, 'gadgetguard_clean');
const zipFile = 'C:\\Users\\Administrator\\Desktop\\gadgetguard.zip';

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

function copyFiltered(src, dst) {
  const items = fs.readdirSync(src);
  for (const item of items) {
    if (item === 'node_modules' || item === '.git') continue;
    const sPath = path.join(src, item);
    const dPath = path.join(dst, item);
    const stat = fs.statSync(sPath);
    if (stat.isDirectory()) {
      fs.mkdirSync(dPath, { recursive: true });
      copyFiltered(sPath, dPath);
    } else {
      fs.copyFileSync(sPath, dPath);
    }
  }
}

console.log('Copying project files without node_modules...');
copyFiltered(targetDir, tempDir);

if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

console.log('Compressing to gadgetguard.zip on Desktop...');
execSync(`tar -a -c -f "${zipFile}" -C "${tempDir}" .`, { stdio: 'inherit' });

fs.rmSync(tempDir, { recursive: true, force: true });

const stat = fs.statSync(zipFile);
console.log('SUCCESS: Zip archive created at:', zipFile);
console.log('Size:', (stat.size / 1024).toFixed(1), 'KB');
