import kuromoji from 'kuromoji';
import path from 'path';
import { hiraganaToKatakana } from './phonetic';

export interface Token {
  surface: string;   // 表層形
  reading: string;   // 読み（カタカナ）
  position: number;  // テキスト内の開始位置
}

export interface NGram {
  text: string;      // 元テキストの該当部分
  reading: string;   // カタカナ読み（結合）
  startPos: number;  // テキスト内開始位置
  endPos: number;    // テキスト内終了位置
  n: number;         // n-gramのn
}

// 句読点・記号のみかを判定
function isPunctuation(surface: string): boolean {
  return /^[\s\u3000\u3001\u3002\uff01\uff0c\uff0e\uff1f\u30fb\u30fc！、。？・「」『』【】（）().,!?;:\s]+$/.test(surface);
}

let tokenizerInstance: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;

export async function initTokenizer(): Promise<void> {
  if (tokenizerInstance) return;

  const dictPath = path.join(process.cwd(), 'node_modules/kuromoji/dict');

  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictPath }).build((err, tokenizer) => {
      if (err) {
        reject(err);
        return;
      }
      tokenizerInstance = tokenizer;
      resolve();
    });
  });
}

export async function tokenize(text: string): Promise<Token[]> {
  await initTokenizer();
  if (!tokenizerInstance) throw new Error('Tokenizer not initialized');

  const rawTokens = tokenizerInstance.tokenize(text);
  const result: Token[] = [];
  let pos = 0;

  for (const t of rawTokens) {
    const surface = t.surface_form;
    if (isPunctuation(surface)) {
      pos += surface.length;
      continue;
    }

    // 読みの取得：reading があればカタカナ、なければ表層形をカタカナ変換
    let reading: string;
    if (t.reading && t.reading !== '*') {
      reading = t.reading;
    } else {
      reading = hiraganaToKatakana(surface);
    }

    result.push({ surface, reading, position: pos });
    pos += surface.length;
  }

  return result;
}

export async function generateNGrams(text: string, maxN = 3): Promise<NGram[]> {
  const tokens = await tokenize(text);
  const ngrams: NGram[] = [];

  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const slice = tokens.slice(i, i + n);
      const combinedText = slice.map((t) => t.surface).join('');
      const combinedReading = slice.map((t) => t.reading).join('');
      const startPos = slice[0].position;
      const lastToken = slice[slice.length - 1];
      const endPos = lastToken.position + lastToken.surface.length;

      ngrams.push({
        text: combinedText,
        reading: combinedReading,
        startPos,
        endPos,
        n,
      });
    }
  }

  return ngrams;
}
