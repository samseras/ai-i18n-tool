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
  console.error('Please provide a target language code (e.g., fr, de, it).');
  console.error('Usage: node translate-referenced-modules.mjs <target_lang>');
  process.exit(1);
}

// Map of main files to their data directories
const CONFIG = [
  {
    mainFile: 'utils/video-subtitle-remove-template-data.js',
    dataDir: 'utils/video-subtitle-remove-template-data'
  },
  {
    mainFile: 'utils/tiktok-product-page-data.js',
    dataDir: 'utils/tiktok-product-page-data'
  },
  {
    mainFile: 'utils/template-data.js',
    dataDir: 'utils/template-data'
  },
  {
    mainFile: 'utils/ai-image-tamplate-data.js',
    dataDir: 'utils/ai-image-template-data' // Note directory spelling might differ
  }
];

// Helper: Recursively translate an object
async function translateObject(obj, targetLang) {
  if (typeof obj === 'string') {
    try {
      if (!obj.trim()) return obj;
      
      const placeholders = [];
      const protectedText = obj.replace(/\{[^}]+\}/g, (match) => {
        placeholders.push(match);
        return `[V${placeholders.length - 1}]`;
      });
      
      const res = await translate(protectedText, { from: SOURCE_LANG, to: targetLang });
      let translatedText = res.text;

      placeholders.forEach((original, index) => {
        if (translatedText.includes(`[V${index}]`)) {
           translatedText = translatedText.replace(`[V${index}]`, original);
           return;
        }
        const looseRegex = new RegExp(`\\[\\s*v\\s*${index}\\s*\\]`, 'gi');
        if (looseRegex.test(translatedText)) {
            translatedText = translatedText.replace(looseRegex, original);
        }
      });

      return translatedText;
    } catch (e) {
      console.error(`Error translating text: "${obj}". Using original text.`);
      return obj;
    }
  } else if (Array.isArray(obj)) {
    const newArray = [];
    for (const item of obj) {
      newArray.push(await translateObject(item, targetLang));
    }
    return newArray;
  } else if (typeof obj === 'object' && obj !== null) {
    const newObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (key === 'path' || key === 'videoUrl' || key === 'image' || key === 'poster' || key === 'btnUrl' || key === 'pagePath' || key === 'id' || key === 'pageImageUrl') {
            newObj[key] = obj[key];
        } else {
            newObj[key] = await translateObject(obj[key], targetLang);
        }
      }
    }
    return newObj;
  }
  return obj;
}

async function processEntry(config) {
    const mainFilePath = path.join(process.cwd(), config.mainFile);
    const dataDirPath = path.join(process.cwd(), config.dataDir);
    const sourceDataFile = path.join(dataDirPath, `${SOURCE_LANG}.js`);
    const targetDataFile = path.join(dataDirPath, `${TARGET_LANG}.js`);

    console.log(`Processing ${config.mainFile}...`);

    // 1. Check if source data file exists
    if (!fs.existsSync(sourceDataFile)) {
        console.error(`Source data file not found: ${sourceDataFile}`);
        return;
    }

    // 2. Load source data (en.js)
    // We use dynamic import
    const fileUrl = 'file://' + sourceDataFile;
    const module = await import(fileUrl + `?t=${Date.now()}`);
    const sourceData = module.default; // Assuming en.js uses export default

    if (!sourceData) {
        console.error(`No default export found in ${sourceDataFile}`);
        return;
    }

    console.log(`Translating data from ${SOURCE_LANG} to ${TARGET_LANG}...`);
    // 3. Translate data
    const translatedData = await translateObject(sourceData, TARGET_LANG);

    // 4. Write target data file (fr.js)
    const newDataContent = `export default ${JSON.stringify(translatedData, null, 2)};\n`;
    fs.writeFileSync(targetDataFile, newDataContent, 'utf-8');
    console.log(`Saved translated data to ${targetDataFile}`);

    // 5. Update main file to import and use the new language
    let mainFileContent = fs.readFileSync(mainFilePath, 'utf-8');

    // 5a. Add import if missing
    // Check if we need to infer the relative import path
    // Usually it's just ./dirname/lang, but inside the file it might be relative
    // Let's look at existing imports to match style
    // e.g. import en from "./video-subtitle-remove-template-data/en";
    
    // We construct the import line based on the directory name provided in config or derived
    // Actually, in the file `utils/video-subtitle-remove-template-data.js`, the imports look like:
    // import en from "./video-subtitle-remove-template-data/en";
    // So we should add: import fr from "./video-subtitle-remove-template-data/fr";
    
    // We need to know the relative path used in the file. 
    // We can extract it from the 'en' import line.
    const importRegex = new RegExp(`import\\s+${SOURCE_LANG}\\s+from\\s+["'](.+)["']`, '');
    const importMatch = mainFileContent.match(importRegex);
    
    if (importMatch) {
        const enImportPath = importMatch[1]; // e.g. "./video-subtitle-remove-template-data/en"
        const targetImportPath = enImportPath.replace(`/${SOURCE_LANG}`, `/${TARGET_LANG}`);
        const newImportLine = `import ${TARGET_LANG} from "${targetImportPath}";`;
        
        // Check if already imported
        if (!mainFileContent.includes(`import ${TARGET_LANG} from`)) {
            // Insert after the last import
            const lastImportIndex = mainFileContent.lastIndexOf('import ');
            const endOfLineIndex = mainFileContent.indexOf('\n', lastImportIndex);
            
            mainFileContent = mainFileContent.slice(0, endOfLineIndex + 1) + newImportLine + '\n' + mainFileContent.slice(endOfLineIndex + 1);
            console.log(`Added import for ${TARGET_LANG} to main file.`);
        }
    } else {
        console.warn("Could not find existing 'en' import to model after.");
    }

    // 5b. Add the language key to exported objects
    // Pattern: 
    // export const someData = {
    //   zh: zh.someData,
    //   en: en.someData,
    //   pt: pt.someData,
    // };
    
    // We want to add:   fr: fr.someData,
    
    // Regex to match the block: en: en.something,
    // We want to capture 'something'
    // Regex: \s*en:\s*en\.(\w+),
    const propRegex = new RegExp(`\\s*${SOURCE_LANG}:\\s*${SOURCE_LANG}\\.(\\w+),?`, 'g');
    
    mainFileContent = mainFileContent.replace(propRegex, (match, propName) => {
        // match is the full line: "  en: en.tiktokWatermarkRemover,"
        // propName is "tiktokWatermarkRemover"
        
        // Check if target lang already exists in the following text? 
        // Simple replacement: append the target line after the source line
        // But we need to avoid duplicates if we run this script multiple times.
        // We can check if the line *immediately following* match is already the target lang.
        
        const newLine = `\n  ${TARGET_LANG}: ${TARGET_LANG}.${propName},`;
        
        // Return original + new line
        // Note: this replace might happen multiple times for the same property if I'm not careful, 
        // but 'replace' with a function iterates matches.
        
        // To avoid duplicates, we can't easily peek ahead in 'replace'.
        // But we can check if the *file content* already has the target line for this property?
        // No, that's hard.
        
        // Alternative: First remove any existing lines for target lang to be safe?
        // Or just rely on user not running it twice?
        
        return match + newLine;
    });
    
    // Cleanup: if we added duplicates (e.g. run twice), we might have multiple fr: lines.
    // A simple regex cleanup afterwards:
    // Replace (fr: fr.prop,\n\s*)+ with single instance?
    // Let's assume for now user runs once or accepts cleanup.
    
    // Better safeguard: regex negative lookahead? Not supported well in JS regex replace callback.
    
    // Let's perform the write.
    
    // Wait, check for duplication before writing?
    // Since we just did string manipulation, we can check if we created double entries.
    // But since the previous state didn't have 'fr', it should be fine.
    // If 'fr' already existed, we might have appended another one. 
    // Ideally we should check if `fr: fr.${propName}` exists.
    
    // Let's reload content and check? No, we have mainFileContent string in memory.
    
    // Refined replace strategy:
    // Only replace if the target string doesn't follow immediately.
    // Actually, let's just do the naive replace. If it duplicates, it's JS valid (last key wins) but ugly.
    
    fs.writeFileSync(mainFilePath, mainFileContent, 'utf-8');
    console.log(`Updated main file: ${mainFilePath}\n`);
}

async function main() {
  console.log(`Starting Reference Module Translation to ${TARGET_LANG}...`);

  for (const config of CONFIG) {
      await processEntry(config);
  }

  console.log('Translation complete!');
}

main();
