import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import OpenAI from 'openai';

const FIXTURES_DIR = path.join(__dirname, 'audio');
const JA_MP3 = path.join(FIXTURES_DIR, 'e2e_sample_ja.mp3');
const JA_M4A = path.join(FIXTURES_DIR, 'e2e_sample_ja.m4a');

const JA_TEXT = '今日は会議の後に三時からマーケティング部と打ち合わせがあります。結論としては来週月曜日に再度集まることになりました。';

async function main() {
  if (fs.existsSync(JA_M4A)) {
    console.log(`✓ Fixture already exists: ${JA_M4A}`);
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log('Generating JA sample via OpenAI TTS (one-time)...');
  const res = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: JA_TEXT,
    response_format: 'mp3',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(JA_MP3, buf);
  console.log(`✓ Saved ${JA_MP3} (${buf.length} bytes)`);

  // Convert to m4a (AAC) to match expected format
  execFileSync('ffmpeg', ['-y', '-i', JA_MP3, '-c:a', 'aac', '-b:a', '32k', JA_M4A]);
  const m4aSize = fs.statSync(JA_M4A).size;
  console.log(`✓ Converted to ${JA_M4A} (${m4aSize} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
