import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { translate } from 'google-translate-api-x';
import { fileURLToPath } from 'url';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const SOURCE_LANG = 'en';
const TARGET_LANG = process.argv[2];

if (!TARGET_LANG) {
  console.error('Please provide a target language code (e.g., zh, pt, es).');
  console.error('Usage: node translate.mjs <target_lang>');
  process.exit(1);
}

const ROOT_DIR = process.cwd();
const LOCALES_DIR = path.join(ROOT_DIR, 'locales');
const SOURCE_DIR = path.join(LOCALES_DIR, SOURCE_LANG);
const TARGET_DIR = path.join(LOCALES_DIR, TARGET_LANG);

// Helper function to recursively find files
function getAllFiles(dirPath, arrayOfFiles) {
  let files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else {
      if (file.endsWith('.js')) {
        arrayOfFiles.push(path.join(dirPath, file));
      }
    }
  });

  return arrayOfFiles;
}

// Helper: Recursively translate an object
async function translateObject(obj, targetLang) {
  if (typeof obj === 'string') {
    try {
      // Skip empty strings
      if (!obj.trim()) return obj;

      // 1. Protect variables like {name}, {age}, {0}, etc.
      // We replace them with a placeholder that Google Translate won't mess up easily
      // Using "[V0]", "[V1]" which is treated as a non-translatable token usually
      const placeholders = [];
      const protectedText = obj.replace(/\{[^}]+\}/g, (match) => {
        placeholders.push(match);
        return `[V${placeholders.length - 1}]`;
      });
      
      // 2. Translate the text with placeholders
      const res = await translate(protectedText, { from: SOURCE_LANG, to: targetLang });
      let translatedText = res.text;

      // 3. Restore variables
      placeholders.forEach((original, index) => {
        // Pattern: [V0], [V 0], [ V0 ], (V0), etc.
        // We look for V followed by the index, surrounded by brackets or parens or just spaces
        // The most common mangling is adding spaces: [ V 0 ]
        
        // Strategy: First try strict match
        if (translatedText.includes(`[V${index}]`)) {
           translatedText = translatedText.replace(`[V${index}]`, original);
           return;
        }

        // Regex for loose match: allowing spaces, different brackets, case insensitivity
        const looseRegex = new RegExp(`\\[\\s*v\\s*${index}\\s*\\]`, 'gi');
        if (looseRegex.test(translatedText)) {
            translatedText = translatedText.replace(looseRegex, original);
            return;
        }
        
        // Very loose fallback: just matching V0 if it stands out
        // Be careful with this one
        const veryLooseRegex = new RegExp(`v\\s*${index}`, 'gi');
        // Only replace if we are reasonably sure it's our placeholder (e.g. lost brackets)
        // This is risky so maybe log a warning if we resort to this
        // console.warn(`Warning: resorting to loose match for variable ${original} (index ${index}) in "${translatedText}"`);
        // translatedText = translatedText.replace(veryLooseRegex, original);
      });

      return translatedText;
    } catch (e) {
      console.error(`Error translating text: "${obj}". Using original text.`);
      return obj;
    }
  } else if (Array.isArray(obj)) {
    // Handle Arrays
    const newArray = [];
    for (const item of obj) {
      newArray.push(await translateObject(item, targetLang));
    }
    return newArray;
  } else if (typeof obj === 'object' && obj !== null) {
    // Handle Objects
    const newObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = await translateObject(obj[key], targetLang);
      }
    }
    return newObj;
  }
  return obj;
}

async function processFile(sourcePath, targetPath, targetLang) {
  try {
    console.log(`Processing: ${path.basename(sourcePath)}`);
    
    // 1. Dynamic import the source JS file
    // Note: This works because Node 20 supports dynamic import() for both CJS and ESM
    const fileUrl = 'file://' + sourcePath;
    
    // Clear cache by appending query param (for dynamic imports this helps if re-running in same process, though in CLI script it matters less)
    const module = await import(fileUrl + `?t=${Date.now()}`);
    const sourceData = module.default;

    if (!sourceData) {
        console.log(`Skipping ${path.basename(sourcePath)}: No default export found.`);
        return;
    }

    // 2. Translate the object structure
    const translatedData = await translateObject(sourceData, targetLang);

    // 3. Convert back to JS file format (ES Module)
    const newFileContent = `export default ${JSON.stringify(translatedData, null, 2)};\n`;

    // 4. Ensure target directory exists
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 5. Write file
    fs.writeFileSync(targetPath, newFileContent, 'utf-8');
    console.log(`Saved to: ${targetPath}`);

  } catch (error) {
    console.error(`Failed to process ${sourcePath}:`, error);
  }
}

async function main() {
  console.log(`Starting Google Translation (Web) from ${SOURCE_LANG} to ${TARGET_LANG}...`);

  try {
    // 1. Handle root language file (e.g., locales/en.js)
    const rootFile = path.join(LOCALES_DIR, `${SOURCE_LANG}.js`);
    if (fs.existsSync(rootFile)) {
       const targetRootFile = path.join(LOCALES_DIR, `${TARGET_LANG}.js`);
       // For root file, we usually just need to replace the path
       const content = fs.readFileSync(rootFile, 'utf-8');
       const translatedContent = content.replace(new RegExp(`/${SOURCE_LANG}/`, 'g'), `/${TARGET_LANG}/`);
       
       const targetRootDir = path.dirname(targetRootFile);
       if (!fs.existsSync(targetRootDir)) {
         fs.mkdirSync(targetRootDir, { recursive: true });
       }

       fs.writeFileSync(targetRootFile, translatedContent, 'utf-8');
       console.log(`Processed root file: ${targetRootFile}`);
    }

    // 2. Handle directory files (e.g., locales/en/modules/...)
    if (fs.existsSync(SOURCE_DIR)) {
        const allFiles = getAllFiles(SOURCE_DIR);
        
        console.log(`Found ${allFiles.length} files in ${SOURCE_LANG} directory.`);

        for (const file of allFiles) {
          const relativePath = path.relative(SOURCE_DIR, file); // e.g., modules/aboutUs.js
          const targetPath = path.join(TARGET_DIR, relativePath);
          
          await processFile(file, targetPath, TARGET_LANG);
        }
    } else {
        console.log(`Directory ${SOURCE_DIR} does not exist.`);
    }

    console.log('Translation complete!');
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
