import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const COMPONENTS_FILE = path.join(ROOT_DIR, 'architecture', 'components.json');

function main() {
  console.log('Validating architecture constraints...');
  
  if (!fs.existsSync(COMPONENTS_FILE)) {
    console.error(`❌ Components file not found at ${COMPONENTS_FILE}`);
    process.exit(1);
  }

  const components = JSON.parse(fs.readFileSync(COMPONENTS_FILE, 'utf-8'));
  let hasErrors = false;

  const validateEntity = (entityName, entityData, category) => {
    const fullPath = path.join(ROOT_DIR, entityData.path);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ [${category}.${entityName}] Path does not exist: ${entityData.path}`);
      hasErrors = true;
      return;
    }

    if (entityData.type === 'typescript-library' || entityData.type === 'nextjs-app' || entityData.type === 'typescript-cli') {
      const pkgPath = path.join(fullPath, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        console.error(`❌ [${category}.${entityName}] Missing package.json at ${pkgPath}`);
        hasErrors = true;
        return;
      }
      
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const actualDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      for (const expectedDep of (entityData.dependencies || [])) {
        if (!actualDeps[expectedDep]) {
          console.error(`❌ [${category}.${entityName}] Missing expected internal dependency: ${expectedDep}`);
          hasErrors = true;
        }
      }
    }
    
    if (entityData.type === 'python-worker') {
      const tomlPath = path.join(fullPath, 'pyproject.toml');
      if (!fs.existsSync(tomlPath)) {
        console.error(`❌ [${category}.${entityName}] Missing pyproject.toml at ${tomlPath}`);
        hasErrors = true;
      }
    }
  };

  for (const [appName, appData] of Object.entries(components.applications || {})) {
    validateEntity(appName, appData, 'applications');
  }

  for (const [pkgName, pkgData] of Object.entries(components.packages || {})) {
    validateEntity(pkgName, pkgData, 'packages');
  }

  for (const [contractName, contractData] of Object.entries(components.contracts || {})) {
    const fullPath = path.join(ROOT_DIR, contractData.path);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ [contracts.${contractName}] Contract file does not exist: ${contractData.path}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error('\n💥 Architecture validation failed. Please update architecture/components.json or fix the dependencies.');
    process.exit(1);
  }

  console.log('✅ Architecture validation passed!');
}

main();
