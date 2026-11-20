/**
 * eval/auto/tsScanner.ts
 *
 * Wrapper mínimo sobre el escáner léxico oficial de TypeScript 7 (`typescript/unstable/ast/scanner`)
 * para tokenizar código TypeScript/JavaScript preservando offsets UTF-16 exactos, literales RegExp
 * y expresiones `${...}` dentro de template literals sin expresiones regulares frágiles.
 */

import { LanguageVariant, SyntaxKind } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";

export { SyntaxKind };

export interface TsToken {
  kind: SyntaxKind;
  start: number;
  end: number;
  text: string;
}

/** Tokens tras los cuales `/` (o `/=`) representa división y NO un literal RegExp. */
const NON_REGEX_PREV_KINDS = new Set<SyntaxKind>([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.PlusPlusToken,
  SyntaxKind.MinusMinusToken,
  SyntaxKind.ThisKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword,
]);

/**
 * Tokeniza `code` omitiendo espacios y comentarios, con re-escaneo contextual de template literals
 * y literales RegExp. Los índices `start`/`end` corresponden directamente al string `code`.
 */
export function tokenizeTs(code: string): TsToken[] {
  const scanner = createScanner(true, LanguageVariant.Standard, code);
  const templateBraceStack: number[] = [];
  const tokens: TsToken[] = [];
  let prevKind: SyntaxKind | null = null;

  for (;;) {
    let kind = scanner.scan();
    if (kind === SyntaxKind.EndOfFile) break;

    if (kind === SyntaxKind.TemplateHead) {
      templateBraceStack.push(1);
    } else if (templateBraceStack.length > 0) {
      if (kind === SyntaxKind.OpenBraceToken) {
        templateBraceStack[templateBraceStack.length - 1]++;
      } else if (kind === SyntaxKind.CloseBraceToken) {
        templateBraceStack[templateBraceStack.length - 1]--;
        if (templateBraceStack[templateBraceStack.length - 1] === 0) {
          templateBraceStack.pop();
          kind = scanner.reScanTemplateToken(false);
          if (kind === SyntaxKind.TemplateMiddle) {
            templateBraceStack.push(1);
          }
        }
      }
    } else if (
      (kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) &&
      (prevKind === null || !NON_REGEX_PREV_KINDS.has(prevKind))
    ) {
      kind = scanner.reScanSlashToken();
    }

    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();
    tokens.push({
      kind,
      start,
      end,
      text: code.slice(start, end),
    });
    prevKind = kind;
  }

  return tokens;
}

/** Devuelve el índice del `}` que cierra el `{` en `openBraceTokIdx`, o `-1` si está desbalanceado. */
export function findMatchingBraceToken(tokens: readonly TsToken[], openBraceTokIdx: number): number {
  let depth = 0;
  for (let i = openBraceTokIdx; i < tokens.length; i++) {
    const k = tokens[i].kind;
    if (k === SyntaxKind.OpenBraceToken) depth++;
    else if (k === SyntaxKind.CloseBraceToken) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
