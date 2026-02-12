require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Google Generative AI client
if (!process.env.GOOGLE_API_KEY) {
  console.error("Error: GOOGLE_API_KEY is missing in .env file.");
  console.error("Please get a free key at https://makersuite.google.com/app/apikey and add it to your .env file.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const SOURCE_LANG = 'en';
const TARGET_LANG = process.argv[2];

if (!TARGET_LANG) {
  console.error('Please provide a target language code (e.g., zh, pt, es).');
  console.error('Usage: node translate.js <target_lang>');
  process.exit(1);
}

const ROOT_DIR = process.cwd();
const LOCALES_DIR = path.join(ROOT_DIR, 'locales');
const SOURCE_DIR = path.join(LOCALES_DIR, SOURCE_LANG);
const TARGET_DIR = path.join(LOCALES_DIR, TARGET_LANG);

async function translateText(content, targetLang) {
  const prompt = `
You are a professional translator for a software application.
Translate the values in the following JavaScript object from English to ${targetLang}.

Requirements:
1. **Precision**: Ensure the translation is accurate and appropriate for a UI context.
2. **Conciseness**: Keep the translated text SHORT and concise. Avoid wordy explanations. The text must fit in UI buttons and labels.
3. **Structure**: 
   - Keep all keys exactly the same.
   - Keep the nested structure exactly the same.
   - Keep comments if possible.
4. **Output**: 
   - Return ONLY the valid JavaScript code (e.g., module.exports = { ... } or export default { ... }).
   - Do NOT wrap the output in markdown code blocks (like \`\`\`javascript ... \`\`\`). 
   - Do NOT add any conversational text.

Input Code:
${content}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let translatedCode = response.text().trim();
    
    // Remove markdown code blocks if present (Gemini often adds them)
    if (translatedCode.startsWith('```')) {
      translatedCode = translatedCode.replace(/^```(javascript|js)?\n/, '').replace(/\n```$/, '');
    }

    return translatedCode;
  } catch (error) {
    console.error('Error translating:', error);
    throw error;
  }
}

async function main() {
  console.log(`Starting translation from ${SOURCE_LANG} to ${TARGET_LANG}...`);

  try {
    // 1. Handle root language file (e.g., locales/en.js)
    const rootFile = path.join(LOCALES_DIR, `${SOURCE_LANG}.js`);
    if (fs.existsSync(rootFile)) {
       console.log(`Found root file: ${SOURCE_LANG}.js`);
       const content = fs.readFileSync(rootFile, 'utf-8');
       console.log(`Translating: ${SOURCE_LANG}.js...`);
       const translatedContent = await translateText(content, TARGET_LANG);
       
       const targetRootFile = path.join(LOCALES_DIR, `${TARGET_LANG}.js`);
       fs.writeFileSync(targetRootFile, translatedContent, 'utf-8');
       console.log(`Saved to: ${targetRootFile}`);
    }

    // 2. Handle directory files (e.g., locales/en/modules/...)
    if (fs.existsSync(SOURCE_DIR)) {
        const files = await glob(`${SOURCE_DIR}/**/*.js`);
        
        console.log(`Found ${files.length} files in ${SOURCE_LANG} directory.`);

        for (const file of files) {
          const relativePath = path.relative(SOURCE_DIR, file);
          const targetPath = path.join(TARGET_DIR, relativePath);
          const targetDir = path.dirname(targetPath);

          console.log(`Translating: ${relativePath}...`);

          // Read source file
          const content = fs.readFileSync(file, 'utf-8');

          // Translate content
          const translatedContent = await translateText(content, TARGET_LANG);

          // Ensure target directory exists
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          // Write translated file
          fs.writeFileSync(targetPath, translatedContent, 'utf-8');
          console.log(`Saved to: ${targetPath}`);
        }
    } else {
        console.log(`Directory ${SOURCE_DIR} does not exist, skipping directory scan.`);
    }

    console.log('Translation complete!');
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
