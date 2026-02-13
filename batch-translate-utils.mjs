import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { translate } from "google-translate-api-x";
import { fileURLToPath } from "url";

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const SOURCE_LANG = "en";
const TARGET_LANG = process.argv[2];

if (!TARGET_LANG) {
  console.error("Please provide a target language code (e.g., fr, de, it).");
  console.error("Usage: node batch-translate-utils.mjs <target_lang>");
  process.exit(1);
}

// List of files to process
const TARGET_FILES = [
  // 'utils/video-subtitle-remove-template-data.js',
  // "utils/template-data.js",
  // "utils/ai-image-tamplate-data.js",
  // "utils/tiktok-product-page-data.js",
  "utils/movie-avatar-template-data.js",
  "utils/instant-avatar-clone-data.js",
];

// Helper: Recursively translate an object
async function translateObject(obj, targetLang) {
  if (typeof obj === "string") {
    try {
      if (!obj.trim()) return obj;

      // Protect variables like {name} -> [V0]
      const placeholders = [];
      const protectedText = obj.replace(/\{[^}]+\}/g, (match) => {
        placeholders.push(match);
        return `[V${placeholders.length - 1}]`;
      });

      // Add delay to avoid rate limiting if necessary, though google-translate-api-x handles some
      // await new Promise(resolve => setTimeout(resolve, 100));

      const res = await translate(protectedText, {
        from: SOURCE_LANG,
        to: targetLang,
      });
      let translatedText = res.text;

      // Restore variables
      placeholders.forEach((original, index) => {
        if (translatedText.includes(`[V${index}]`)) {
          translatedText = translatedText.replace(`[V${index}]`, original);
          return;
        }
        const looseRegex = new RegExp(`\\[\\s*v\\s*${index}\\s*\\]`, "gi");
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
  } else if (typeof obj === "object" && obj !== null) {
    const newObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Skip specific keys that shouldn't be translated
        if (
          key === "path" ||
          key === "videoUrl" ||
          key === "image" ||
          key === "poster" ||
          key === "btnUrl" ||
          key === "pagePath" ||
          key === "id" ||
          key === "pageImageUrl"
        ) {
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

async function processFile(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  console.log(`Processing file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  try {
    // 1. Load the module dynamically
    // Add timestamp to bypass cache
    const fileUrl = "file://" + filePath;
    const module = await import(fileUrl + `?t=${Date.now()}`);

    // 2. Identify exportable data objects we want to translate
    // We look for objects that contain 'en' key directly
    const targetExports = [];
    for (const [key, value] of Object.entries(module)) {
      if (
        typeof value === "object" &&
        value !== null &&
        value.hasOwnProperty("en")
      ) {
        targetExports.push(key);
      }
    }

    if (targetExports.length === 0) {
      console.log(
        `No translatable exports found in ${relativePath} (looking for objects with 'en' key).`,
      );
      return;
    }

    console.log(`Found data objects to translate: ${targetExports.join(", ")}`);

    // 3. Read original file content as text
    let fileContent = fs.readFileSync(filePath, "utf-8");

    // 4. Process each data object
    for (const exportName of targetExports) {
      console.log(`Translating ${exportName} -> ${TARGET_LANG}...`);
      const dataObj = module[exportName];

      // Get source data
      const sourceData = dataObj[SOURCE_LANG];
      if (!sourceData) {
        console.warn(
          `No source data found for ${SOURCE_LANG} in ${exportName}. Skipping.`,
        );
        continue;
      }

      // Translate
      const translatedData = await translateObject(sourceData, TARGET_LANG);

      // 5. Update the file content string
      // Regex to find: export const variableName = {
      const exportStartRegex = new RegExp(
        `export const ${exportName} = \\{`,
        "s",
      );
      const match = fileContent.match(exportStartRegex);

      if (!match) {
        console.warn(
          `Could not find definition for ${exportName} in file text. Skipping.`,
        );
        continue;
      }

      const startIndex = match.index;

      // Construct the new language block
      // Ensure indentation matches the file style (usually 2 spaces)
      const jsonString = JSON.stringify(translatedData, null, 2);
      // Indent the JSON string to match the file structure (add 2 spaces)
      const indentedJson = jsonString.replace(/\n/g, "\n  ");
      const newLangBlockString = `\n  "${TARGET_LANG}": ${indentedJson},`;

      // Check if target lang already exists to avoid duplication
      // We search within the scope of this object definition
      // A simple heuristic: search for "TARGET_LANG": starting from startIndex
      // But to be safer, let's find the closing brace of the "en" block and insert after it
      // OR find the closing brace of the whole object and insert before it.

      // Strategy: Insert before the last closing brace of the export object.

      // Find the matching closing brace for the export object
      let openBraces = 0;
      let foundStart = false;
      let endIndex = -1;

      for (let i = startIndex; i < fileContent.length; i++) {
        if (fileContent[i] === "{") {
          openBraces++;
          foundStart = true;
        } else if (fileContent[i] === "}") {
          openBraces--;
        }

        if (foundStart && openBraces === 0) {
          endIndex = i; // The index of the closing brace '}'
          break;
        }
      }

      if (endIndex !== -1) {
        // Check if key already exists in the file content within this block
        // This is a bit rough but safer than regexing nested json
        const blockContent = fileContent.substring(startIndex, endIndex);
        if (blockContent.includes(`"${TARGET_LANG}":`)) {
          console.log(
            `Language ${TARGET_LANG} already exists in ${exportName}. Skipping insertion (would duplicate).`,
          );
          // Optionally we could replace it, but appending is safer for now.
          // To replace, we'd need to parse the range of the existing key.
          continue;
        }

        // Insert before the closing brace
        const beforeClosing = fileContent.substring(0, endIndex);
        const afterClosing = fileContent.substring(endIndex);

        // If the previous line doesn't end with a comma, we might need to add one?
        // JSON.stringify valid JS objects usually have commas between keys.
        // But we are editing text.
        // Let's assume the previous block (e.g. 'en') ends with '},' or '}'
        // We should ensure the previous element has a comma if we append.

        // Let's look backwards from endIndex to find the last non-whitespace char
        let lastCharIndex = endIndex - 1;
        while (/\s/.test(fileContent[lastCharIndex])) lastCharIndex--;

        let insertionString = newLangBlockString;
        if (fileContent[lastCharIndex] !== ",") {
          // Add a comma to the previous item
          // This is tricky because we can't easily insert into the string at lastCharIndex + 1
          // We can replace the substring.

          // Actually, if we just insert the new block, we assume the user's file is valid JS.
          // Most likely the last item (e.g. 'pt') doesn't have a trailing comma.
          // So we need to add a comma to it.

          const beforeLastChar = fileContent.substring(0, lastCharIndex + 1);
          const between = fileContent.substring(lastCharIndex + 1, endIndex);

          fileContent =
            beforeLastChar + "," + between + insertionString + afterClosing;
        } else {
          fileContent = beforeClosing + insertionString + afterClosing;
        }

        console.log(`Updated ${exportName} with ${TARGET_LANG}.`);

        // Adjust endIndex for next iterations if we modify fileContent?
        // Since we process exports sequentially and they are likely sequential in file,
        // modification changes indices.
        // BUT, we reload fileContent from string.
        // Wait, we are modifying `fileContent` variable in a loop.
        // We need to re-calculate regex matches or offsets?
        // YES. The startIndex for subsequent exports might shift.
        // However, we `match` regex against `fileContent` at the start of loop?
        // NO, we matched `fileContent` before modification.
        // The `fileContent` variable is updated.
        // We need to re-run the match inside the loop?
        // Actually, finding `exportStartRegex` again is safer.
      } else {
        console.warn(`Could not find closing brace for ${exportName}.`);
      }
    }

    // Write back to file
    fs.writeFileSync(filePath, fileContent, "utf-8");
    console.log(`Finished processing ${relativePath}\n`);
  } catch (error) {
    console.error(`Failed to process ${relativePath}:`, error);
  }
}

async function main() {
  console.log(
    `Starting Batch Translation from ${SOURCE_LANG} to ${TARGET_LANG}...`,
  );

  for (const file of TARGET_FILES) {
    await processFile(file);
  }

  console.log("Batch Translation complete!");
}

main();
