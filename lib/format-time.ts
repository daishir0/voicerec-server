/**
 * 画面に時間を出すときの共通処理。
 *
 * 時間には性質の違う3つがあり、混ぜると読み手が誤解する。
 *   - 時刻  : その発話が「何時何分に」話されたか      → fmtClock
 *   - 経過  : 録音の先頭から何秒目か（再生位置）       → fmtOffset
 *   - 長さ  : その録音が何分あるか                     → fmtOffset（経過と同じ形でよい）
 *
 * ⚠️ タイムゾーンは Asia/Tokyo に固定する。
 * アップロード経路はファイル名の yyyymmdd-hhmmss を **JST として** 絶対時刻にしている
 * （app/api/recordings/upload/route.ts）。表示だけ閲覧者の端末まかせにすると、
 * 録音を海外や UTC の端末で開いたときに本文と時刻が食い違う。
 */

export const TIME_ZONE = 'Asia/Tokyo';

/** 経過（と長さ）。1:02:03 / 2:05 */
export function fmtOffset(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 時刻。14:02:05 */
export function fmtClock(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('ja-JP', {
    timeZone: TIME_ZONE, hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** 日付つきの時刻。10/25 00:00:03 */
export function fmtClockWithDate(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at);
  if (isNaN(d.getTime())) return '--/-- --:--:--';
  const date = d.toLocaleDateString('ja-JP', { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric' });
  return `${date} ${fmtClock(d)}`;
}

/** 日付と時刻。2026/10/24 14:02:05（一覧の列など） */
export function fmtDateTime(at: Date | string | number | null | undefined): string {
  if (at == null) return '-';
  const d = at instanceof Date ? at : new Date(at);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', {
    timeZone: TIME_ZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** 2つの時刻が Asia/Tokyo で同じ日か */
export function isSameDay(a: Date | string | number, b: Date | string | number): boolean {
  const f = (x: Date | string | number) =>
    (x instanceof Date ? x : new Date(x)).toLocaleDateString('ja-JP', { timeZone: TIME_ZONE });
  return f(a) === f(b);
}

/**
 * 発話の行頭に出す時刻。日をまたいだ行だけ日付を添える。
 * 長時間の録音だと 23:59 の次が 00:00 になり、時刻だけでは逆走して見えるため。
 */
export function fmtSegmentClock(at: Date | string | number, recordedAt: Date | string | number): string {
  return isSameDay(at, recordedAt) ? fmtClock(at) : fmtClockWithDate(at);
}
