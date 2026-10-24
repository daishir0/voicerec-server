/**
 * 端末（iOS の SpeechAnalyzer / SFSpeechRecognizer）が返す区間を、文くらいの長さにまとめる。
 *
 * ⚠️ なぜ必要か（2026-10-24 に実際に壊れた）
 * SpeechAnalyzer はトークン単位で返すので、日本語だと「こ」「の」「赤」「い」と
 * **1文字ずつ**の区間になる。これをそのまま Segment 行にすると:
 *   - 画面に1文字ずつ1行で並び、1本の録音で 12,888 行になって読めない
 *   - `text LIKE '%北町%'` が**原理的に当たらない**。語が区間をまたぐため、
 *     MCP の search_transcripts と get_transcript_by_time が機能しない
 * Whisper は2秒ほどの文単位で返すので、同じテーブルに別の粒度が混ざることにもなる。
 * 受け取る量は制限しない（だいしろーさん指示）。まとめるのは保存する形だけ。
 */

export interface RawSegment {
  startSec: number;
  endSec: number;
  text: string;
}

/** 無音がこれ以上あいたら、別の発話として切る（秒） */
const GAP_SEC = 0.6;
/** 1区間の最長（秒）。切れ目の無い早口でも、ここで必ず切る */
const MAX_SEC = 15;
/** この文字で終わったら、そこで切る（文の途中で切らないため） */
const SENTENCE_END = /[。．.!?！？]$/;

/**
 * 隣り合う区間を、無音・最大長・文末のどれかに当たるまで連結する。
 * 時刻は「まとめた先頭の開始」と「まとめた末尾の終了」を使うので、ずれない。
 */
export function groupSegments(raw: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const seg of raw) {
    const text = seg.text;
    if (!text) continue;
    const last = out[out.length - 1];

    const gap = last ? seg.startSec - last.endSec : Infinity;
    const wouldBe = last ? seg.endSec - last.startSec : 0;
    const breakHere =
      !last ||
      gap >= GAP_SEC ||
      wouldBe > MAX_SEC ||
      SENTENCE_END.test(last.text);

    if (breakHere) {
      out.push({ startSec: seg.startSec, endSec: seg.endSec, text });
    } else {
      last.text += text;
      last.endSec = seg.endSec;
    }
  }
  // 端末によっては前後に空白が付く。保存する前に落とす
  return out
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
}
