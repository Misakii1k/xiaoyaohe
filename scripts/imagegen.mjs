// 生图工具脚本（仅设计资产管线使用，不属于应用运行时代码）。
// 用法：node scripts/imagegen.mjs --prompt-file <文件> --out <输出.png> [--ratio 1:1] [--size 2K] [--retries 2]
// 密钥从 medbox/.env 或环境变量 AGNES_API_KEY 读取；.env 已被 gitignore。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function generateOnce({ apiBase, apiKey, prompt, size, ratio }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const res = await fetch(`${apiBase}/v1/images/generations`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'agnes-image-2.1-flash',
        prompt,
        size,
        ratio,
        return_base64: true,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    const json = JSON.parse(text);
    const item = json?.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item?.url) {
      const imgRes = await fetch(item.url, { signal: controller.signal });
      if (!imgRes.ok) throw new Error(`下载图片失败 HTTP ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer());
    }
    throw new Error(`响应缺少 b64_json/url: ${text.slice(0, 300)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const promptFile = args['prompt-file'];
  const out = args.out;
  if (!promptFile || !out) {
    console.error('用法: node scripts/imagegen.mjs --prompt-file <文件> --out <输出.png> [--ratio 1:1] [--size 2K]');
    process.exit(2);
  }
  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) {
    console.error('缺少 AGNES_API_KEY（medbox/.env 或环境变量）');
    process.exit(2);
  }
  const apiBase = (process.env.AGNES_API_BASE || 'https://apihub.agnes-ai.com').replace(/\/$/, '');
  const prompt = readFileSync(promptFile, 'utf8').trim();
  const size = args.size || '2K';
  const ratio = args.ratio || '1:1';
  const retries = Number(args.retries ?? 2);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) console.error(`重试 ${attempt}/${retries} ...`);
      const buf = await generateOnce({ apiBase, apiKey, prompt, size, ratio });
      if (buf.length < 10_000) throw new Error(`返回数据过小（${buf.length}B），疑似失败`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, buf);
      console.log(`OK ${out} (${(buf.length / 1024).toFixed(0)}KB, size=${size}, ratio=${ratio})`);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`失败: ${err.message ?? err}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  console.error(`放弃 ${out}: ${lastErr}`);
  process.exit(1);
}

main();
