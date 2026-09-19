import * as fs from 'fs';
import * as path from 'path';

function validateSql(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  console.log(`=== VALIDATING SQL SCRIPT: ${path.basename(filePath)} ===`);

  const lines = content.split(/\r?\n/);
  let openParenCount = 0;
  let inDollarQuote = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  let currentStatement = '';
  let statementStartLine = 1;
  const statements: { startLine: number; sql: string }[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const trimmed = line.trim();

    // Check for orphaned keywords at the start of a non-comment line
    if (!inBlockComment && !inDollarQuote) {
      if (trimmed.startsWith('OR ') || trimmed.startsWith('AND ') || trimmed === 'OR' || trimmed === 'AND') {
        // If currentStatement is empty, this line is starting an orphaned expression!
        if (!currentStatement.trim()) {
          throw new Error(`Syntax Error on line ${lineIdx + 1}: Line starts with orphaned operator: "${trimmed}"`);
        }
      }
    }

    let i = 0;
    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1] || '';

      // Line comments
      if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && !inBlockComment && char === '-' && nextChar === '-') {
        break; // Ignore remainder of line
      }

      // Block comments
      if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && char === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      if (inBlockComment) {
        i++;
        continue;
      }

      // Dollar quotes ($$ or $tag$)
      if (!inSingleQuote && !inDoubleQuote && char === '$' && nextChar === '$') {
        inDollarQuote = !inDollarQuote;
        currentStatement += '$$';
        i += 2;
        continue;
      }

      if (inDollarQuote) {
        currentStatement += char;
        i++;
        continue;
      }

      // String literals (single quotes)
      if (char === "'" && !inDoubleQuote) {
        if (inSingleQuote && nextChar === "'") {
          // Escaped single quote ('')
          currentStatement += "''";
          i += 2;
          continue;
        }
        inSingleQuote = !inSingleQuote;
        currentStatement += char;
        i++;
        continue;
      }

      if (inSingleQuote) {
        currentStatement += char;
        i++;
        continue;
      }

      // Identifiers (double quotes)
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        currentStatement += char;
        i++;
        continue;
      }

      if (inDoubleQuote) {
        currentStatement += char;
        i++;
        continue;
      }

      // Parentheses tracking
      if (char === '(') {
        openParenCount++;
      } else if (char === ')') {
        openParenCount--;
        if (openParenCount < 0) {
          throw new Error(`Unmatched closing parenthesis on line ${lineIdx + 1}: char ${i + 1}`);
        }
      }

      // Semicolon (statement termination)
      if (char === ';') {
        currentStatement += char;
        if (openParenCount === 0) {
          statements.push({ startLine: statementStartLine, sql: currentStatement.trim() });
          currentStatement = '';
          statementStartLine = lineIdx + 2;
          i++;
          continue;
        }
      }

      currentStatement += char;
      i++;
    }

    currentStatement += '\n';
  }

  if (openParenCount !== 0) {
    throw new Error(`Unmatched opening parentheses! Remaining unclosed: ${openParenCount}`);
  }
  if (inSingleQuote) {
    throw new Error('Unterminated single-quote string literal in SQL script');
  }
  if (inDoubleQuote) {
    throw new Error('Unterminated double-quote identifier in SQL script');
  }
  if (inDollarQuote) {
    throw new Error('Unterminated dollar-quote block ($$) in SQL script');
  }
  if (inBlockComment) {
    throw new Error('Unterminated block comment (/* ... */) in SQL script');
  }

  // Trailing statement check
  if (currentStatement.trim()) {
    statements.push({ startLine: statementStartLine, sql: currentStatement.trim() });
  }

  console.log(`✅ Parentheses balance check PASSED (0 unclosed parens).`);
  console.log(`✅ String & identifier quoting check PASSED.`);
  console.log(`✅ Total distinct statements identified: ${statements.length}`);

  // Detailed validation per statement
  for (let idx = 0; idx < statements.length; idx++) {
    const s = statements[idx];
    const firstWord = s.sql.split(/\s+/)[0]?.toUpperCase();
    console.log(`   [Statement ${idx + 1} (Line ~${s.startLine})]: ${firstWord} ... (${s.sql.length} chars)`);

    // Ensure statement ends with semicolon
    if (!s.sql.endsWith(';')) {
      console.warn(`   ⚠️ Warning: Statement ${idx + 1} does not end with semicolon`);
    }

    // Check CREATE POLICY
    if (s.sql.toUpperCase().startsWith('CREATE POLICY')) {
      if (!s.sql.toUpperCase().includes(' ON ')) {
        throw new Error(`CREATE POLICY statement ${idx + 1} missing 'ON <table>' clause`);
      }
      if (!s.sql.toUpperCase().includes('USING')) {
        throw new Error(`CREATE POLICY statement ${idx + 1} missing 'USING' clause`);
      }
    }
  }

  console.log('\n🎉 ALL STATIC SQL SYNTAX VALIDATIONS PASSED!\n');
  return true;
}

const targetFile = path.resolve(process.cwd(), 'supabase_security_p0h_rls.sql');
validateSql(targetFile);
