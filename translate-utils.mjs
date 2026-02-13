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
  console.error('Usage: node translate-utils.mjs <target_lang>');
  process.exit(1);
}

const UTILS_FILE_PATH = path.join(process.cwd(), 'utils', 'discover-more-tools-helper.js');

// Helper: Recursively translate an object
async function translateObject(obj, targetLang) {
  if (typeof obj === 'string') {
    try {
      if (!obj.trim()) return obj;
      // Skip paths/urls which usually shouldn't be translated
      // Simple heuristic: if it looks like a path (no spaces, has slashes or dashes), skip it
      // But titles/names should be translated.
      // In this specific file, "path" keys should NOT be translated.
      // We will handle key filtering in the caller.

      // Protect variables
      const placeholders = [];
      const protectedText = obj.replace(/\{[^}]+\}/g, (match) => {
        placeholders.push(match);
        return `[V${placeholders.length - 1}]`;
      });
      
      const res = await translate(protectedText, { from: SOURCE_LANG, to: targetLang });
      let translatedText = res.text;

      // Restore variables
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
        // Skip "path" key translation
        if (key === 'path') {
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

async function main() {
  console.log(`Starting Utils Translation from ${SOURCE_LANG} to ${TARGET_LANG}...`);
  console.log(`Target file: ${UTILS_FILE_PATH}`);

  try {
    // 1. Load the module dynamically
    const fileUrl = 'file://' + UTILS_FILE_PATH;
    const module = await import(fileUrl + `?t=${Date.now()}`);

    // 2. Identify exportable data objects we want to translate
    // We look for objects that contain 'en' key
    const targetExports = [];
    for (const [key, value] of Object.entries(module)) {
        if (typeof value === 'object' && value !== null && value.hasOwnProperty('en')) {
            targetExports.push(key);
        }
    }

    console.log(`Found data objects to translate: ${targetExports.join(', ')}`);

    // 3. Read original file content as text
    let fileContent = fs.readFileSync(UTILS_FILE_PATH, 'utf-8');

    // 4. Process each data object
    for (const exportName of targetExports) {
        console.log(`Translating ${exportName}...`);
        const dataObj = module[exportName];
        
        // Get source data
        const sourceData = dataObj[SOURCE_LANG];
        
        // Translate
        const translatedData = await translateObject(sourceData, TARGET_LANG);
        
        // Update the object in memory (just for verification)
        dataObj[TARGET_LANG] = translatedData;

        // 5. Update the file content string
        // We need to find where this object is defined in the file and insert the new key
        // Regex to find: export const variableName = { ... "en": { ... }, ... };
        // We will look for the closing brace of the object and insert our new key before it,
        // OR simpler: replace the whole object definition.
        
        // Construct the new object string manually to preserve order usually
        // But since we want to keep comments and other structure of the FILE, we can't just JSON.stringify the whole thing.
        // Strategy: Find the "en": { ... } block, and append the new language block after it.
        
        // Find the position of "en": {
        // This is risky if "en": appears in multiple places or nested.
        // Better: Use regex to match the specific export definition
        
        // Match: export const exportName = { ... };
        // We use a regex that captures the content up to the closing semicolon or end of declaration
        // Note: This relies on standard formatting.
        
        // Let's try to locate the "en" block specifically within this export
        const exportStartRegex = new RegExp(`export const ${exportName} = \\{`, 's');
        const match = fileContent.match(exportStartRegex);
        
        if (!match) {
            console.warn(`Could not find definition for ${exportName} in file text. Skipping.`);
            continue;
        }
        
        const startIndex = match.index;
        // Find the "en": { ... } block inside this object
        // We can search for '"en":' or 'en:' after startIndex
        
        // Actually, a safer way to modify the file without breaking formatting:
        // 1. Serialize the NEW translated data block to JSON string
        // 2. Insert it into the file.
        
        const newLangBlockString = `  "${TARGET_LANG}": ${JSON.stringify(translatedData, null, 2).replace(/\n/g, '\n  ')}`;
        
        // Check if target lang already exists to avoid duplication
        const targetLangRegex = new RegExp(`"${TARGET_LANG}"\\s*:`, 'g');
        // Limit search scope? No, simple check first.
        
        // We will insert it after the last language block.
        // Let's assume standard formatting: keys are "zh", "en", "pt".
        // We find the last closing brace of a language block inside this export.
        
        // Let's look for the end of the "en" block.
        // It's hard to parse matching braces with regex.
        
        // ALTERNATIVE STRATEGY:
        // Reconstruct the WHOLE object string from the module data (which now has the new lang)
        // and replace the original definition.
        // Limitation: This destroys comments INSIDE the object if any.
        // But your file seems to be pure data for these exports.
        
        const newObjectString = `export const ${exportName} = ${JSON.stringify(dataObj, null, 2)};`;
        
        // We need to replace the old definition.
        // Find start: export const name = {
        // Find end: }; (semicolon optional)
        
        // To find the matching end brace properly, we can use a counter
        let openBraces = 0;
        let foundStart = false;
        let endIndex = -1;
        
        for (let i = startIndex; i < fileContent.length; i++) {
            if (fileContent[i] === '{') {
                openBraces++;
                foundStart = true;
            } else if (fileContent[i] === '}') {
                openBraces--;
            }
            
            if (foundStart && openBraces === 0) {
                endIndex = i + 1; // include the closing brace
                break;
            }
        }
        
        if (endIndex !== -1) {
             // Check for semicolon
             if (fileContent[endIndex] === ';') endIndex++;
             
             const originalDefinition = fileContent.substring(startIndex, endIndex);
             // Replace
             fileContent = fileContent.replace(originalDefinition, newObjectString);
             console.log(`Updated ${exportName} with ${TARGET_LANG}.`);
        } else {
            console.warn(`Could not find closing brace for ${exportName}.`);
        }
    }

    // 6. Write back to file
    fs.writeFileSync(UTILS_FILE_PATH, fileContent, 'utf-8');
    console.log('Done!');

  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
