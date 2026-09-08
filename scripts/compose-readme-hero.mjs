import sharp from 'sharp';
import fs from 'fs';

async function composeHero() {
  const svgPath = 'assets/readme/source/hero-layout.svg';
  const subjectPath = 'assets/readme/source/hero-subject.png';
  const outPngPath = 'assets/readme/hero.png';
  const outSvgPath = 'assets/readme/hero.svg';

  // 1. 读取并渲染 SVG 背景底板
  const svgBuffer = fs.readFileSync(svgPath);
  
  // 2. 缩放透明主体素材
  const resizedSubject = await sharp(subjectPath)
    .resize(400, 400, { fit: 'inside' })
    .png()
    .toBuffer();

  // 3. 合成 PNG 封面 (1200x600)
  const baseImg = await sharp(svgBuffer).png().toBuffer();

  await sharp(baseImg)
    .composite([
      {
        input: resizedSubject,
        left: 710,
        top: 85,
      },
    ])
    .png({ quality: 95, compressionLevel: 9 })
    .toFile(outPngPath);

  console.log('Generated: ' + outPngPath);

  // 4. 生成包含内联主体 base64 的独立 hero.svg
  const subjectBase64 = resizedSubject.toString('base64');
  let svgContent = fs.readFileSync(svgPath, 'utf8');
  const imageElement = '\n  <g id="hero-subject">\n    <image href="data:image/png;base64,' + subjectBase64 + '" x="710" y="85" width="400" height="400" />\n  </g>\n</svg>';
  svgContent = svgContent.replace('</svg>', imageElement);
  fs.writeFileSync(outSvgPath, svgContent, 'utf8');
  console.log('Generated: ' + outSvgPath);
}

composeHero().catch(err => {
  console.error(err);
  process.exit(1);
});
