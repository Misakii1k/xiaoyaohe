#!/usr/bin/env node
/**
 * 离线批量评估脚手架：对比本地药片计数算法（pillDetection.ts）与可选云端 /api/count-pills 接口的准确率与耗时。
 *
 * 用法：
 *   node scripts/bench-pills.mjs --help
 *   node scripts/bench-pills.mjs --dir ./fixtures/pills [--mode loose|blister] [--endpoint https://.../api/count-pills]
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function printHelp() {
  console.log(`药片计数离线对比评估脚本 (v4.0)

用法:
  node scripts/bench-pills.mjs --dir <照片目录> [选项]

选项:
  --dir <path>        待评测照片目录（支持 .jpg/.jpeg/.png/.webp，可在同目录放 labels.json 标注真实粒数）
  --mode <mode>       评测模式: loose（散落，默认）或 blister（整板泡罩）
  --endpoint <url>    可选，指定云端 /api/count-pills 地址以横向对比云端准确率与耗时
  --max-dim <px>      图片最长边缩放像素，默认 1024
  -h, --help          显示此帮助并退出

labels.json 格式示例:
  {
    "sample-1.jpg": 12,
    "blister-1.png": 8
  }
`);
}

function parseArgs(argv) {
  const args = {
    help: false,
    dir: '',
    mode: 'loose',
    endpoint: '',
    maxDim: 1024,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-h' || token === '--help') {
      args.help = true;
    } else if (token === '--dir') {
      args.dir = argv[i + 1] ?? '';
      i += 1;
    } else if (token === '--mode') {
      const m = argv[i + 1];
      if (m === 'loose' || m === 'blister') args.mode = m;
      i += 1;
    } else if (token === '--endpoint') {
      args.endpoint = argv[i + 1] ?? '';
      i += 1;
    } else if (token === '--max-dim') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 128 && n <= 4096) args.maxDim = Math.round(n);
      i += 1;
    }
  }
  return args;
}

function defaultBlisterGrid(width, height) {
  return {
    rows: 2,
    cols: 5,
    corners: [
      { x: width * 0.08, y: height * 0.08 },
      { x: width * 0.92, y: height * 0.08 },
      { x: width * 0.92, y: height * 0.92 },
      { x: width * 0.08, y: height * 0.92 },
    ],
  };
}

async function loadDetectorModule() {
  const { createServer } = await import('vite');
  const root = path.resolve(import.meta.dirname, '..');
  const server = await createServer({
    root,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  const mod = await server.ssrLoadModule('/src/features/pillDetection.ts');
  return {
    mod,
    close: () => server.close(),
  };
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (!opts.dir) {
    console.error('错误：请使用 --dir <path> 指定照片目录，或传入 --help 查看用法。');
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), opts.dir);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    console.error(`错误：目录不存在：${targetDir}`);
    process.exit(1);
  }

  const labelsPath = path.join(targetDir, 'labels.json');
  const labels = fs.existsSync(labelsPath)
    ? JSON.parse(fs.readFileSync(labelsPath, 'utf8'))
    : {};

  const files = fs
    .readdirSync(targetDir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.log(`目录中没有可评测图片（.jpg/.png/.webp）：${targetDir}`);
    process.exit(0);
  }

  const { default: sharp } = await import('sharp');
  const { mod, close } = await loadDetectorModule();

  let localAbsErrSum = 0;
  let localLabelCount = 0;
  let remoteAbsErrSum = 0;
  let remoteLabelCount = 0;

  try {
    console.log(`模式: ${opts.mode} | 样本数: ${files.length}${opts.endpoint ? ` | 云端: ${opts.endpoint}` : ''}`);
    console.log('文件名\t期望\t本地\t本地耗时\t云端\t云端耗时');

    for (const file of files) {
      const fullPath = path.join(targetDir, file);
      const resized = sharp(fullPath)
        .rotate()
        .resize({ width: opts.maxDim, height: opts.maxDim, fit: 'inside', withoutEnlargement: true });

      const { data, info } = await resized
        .clone()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const imgData = {
        width: info.width,
        height: info.height,
        data: new Uint8ClampedArray(data),
        colorSpace: 'srgb',
      };

      const t0 = performance.now();
      let localCount = 0;
      if (opts.mode === 'blister') {
        const res = mod.evaluateBlisterGrid(imgData, defaultBlisterGrid(info.width, info.height));
        localCount = res.points.length;
      } else {
        const res = mod.detectPillsFromImageData(imgData);
        localCount = res.points.length;
      }
      const localMs = Math.round(performance.now() - t0);

      let remoteCountText = '-';
      let remoteMsText = '-';
      const expected = typeof labels[file] === 'number' ? labels[file] : undefined;

      if (typeof expected === 'number') {
        localAbsErrSum += Math.abs(localCount - expected);
        localLabelCount += 1;
      }

      if (opts.endpoint) {
        const jpegBuf = await resized.clone().jpeg({ quality: 86 }).toBuffer();
        const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
        const rt0 = performance.now();
        try {
          const resp = await fetch(opts.endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: new URL(opts.endpoint).origin,
            },
            body: JSON.stringify({ image: dataUrl, mode: opts.mode }),
          });
          const body = await resp.json();
          const rMs = Math.round(performance.now() - rt0);
          remoteMsText = `${rMs}ms`;
          if (resp.ok && typeof body.count === 'number') {
            remoteCountText = String(body.count);
            if (typeof expected === 'number') {
              remoteAbsErrSum += Math.abs(body.count - expected);
              remoteLabelCount += 1;
            }
          } else {
            remoteCountText = `ERR(${resp.status})`;
          }
        } catch (err) {
          remoteCountText = `ERR(${err instanceof Error ? err.message : String(err)})`;
        }
      }

      console.log(
        `${file}\t${expected ?? '-'}\t${localCount}\t${localMs}ms\t${remoteCountText}\t${remoteMsText}`,
      );
    }

    if (localLabelCount > 0) {
      console.log(`\n本地算法平均绝对误差 (MAE, ${localLabelCount} 张): ${(localAbsErrSum / localLabelCount).toFixed(2)}`);
    }
    if (remoteLabelCount > 0) {
      console.log(`云端模型平均绝对误差 (MAE, ${remoteLabelCount} 张): ${(remoteAbsErrSum / remoteLabelCount).toFixed(2)}`);
    }
  } finally {
    await close();
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
