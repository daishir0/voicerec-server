/**
 * 文字起こしモデルのシステム全体設定。
 *
 * - 環境変数 `TRANSCRIPTION_MODE` で切り替え（未設定なら whisper-only）
 * - 反映には `sudo systemctl restart voicerec.service` が必要（next start 本番モード）
 * - 将来 DB 一元管理に切替えても呼び出し側を壊さないため async シグネチャ
 */

export type TranscriptionMode = 'whisper-only' | 'dual' | 'gpt4o-only';

const VALID_MODES: TranscriptionMode[] = ['whisper-only', 'dual', 'gpt4o-only'];
const DEFAULT_MODE: TranscriptionMode = 'whisper-only';

function parseMode(raw: string | undefined): TranscriptionMode {
  if (!raw) return DEFAULT_MODE;
  const normalised = raw.trim().toLowerCase();
  if ((VALID_MODES as string[]).includes(normalised)) {
    return normalised as TranscriptionMode;
  }
  // 不正値は警告して既定にフォールバック（サーバ起動を止めない）
  console.warn(
    `[transcription-config] invalid TRANSCRIPTION_MODE="${raw}", falling back to "${DEFAULT_MODE}"`
  );
  return DEFAULT_MODE;
}

export async function getTranscriptionMode(): Promise<TranscriptionMode> {
  return parseMode(process.env.TRANSCRIPTION_MODE);
}

export function getTranscriptionModeSync(): TranscriptionMode {
  return parseMode(process.env.TRANSCRIPTION_MODE);
}
