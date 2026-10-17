/**
 * SmartGain Icon Generator
 * Generates extension icons at 16, 32, 48, 128px using node-canvas.
 * Run: node generate-icons.js
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

function drawIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;

    // Background: deep navy circle
    const bgGrad = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, r);
    bgGrad.addColorStop(0, '#1A1040');
    bgGrad.addColorStop(1, '#0A0A14');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Glow
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.7);
    glowGrad.addColorStop(0, 'rgba(124,58,237,0.3)');
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Waveform bars — center-symmetric
    const barCount = 7;
    const maxBarH = size * 0.55;
    const barW = Math.max(1, size * 0.065);
    const spacing = (size * 0.72) / barCount;
    const startX = cx - (barCount / 2) * spacing + spacing * 0.2;

    const heights = [0.25, 0.5, 0.75, 1.0, 0.75, 0.5, 0.25];

    const grad = ctx.createLinearGradient(0, cy - maxBarH / 2, 0, cy + maxBarH / 2);
    grad.addColorStop(0, '#06B6D4');
    grad.addColorStop(0.4, '#A78BFA');
    grad.addColorStop(1, '#7C3AED');
    ctx.fillStyle = grad;

    heights.forEach((h, i) => {
        const bh = h * maxBarH;
        const x = startX + i * spacing;
        const y = cy - bh / 2;
        const rad = Math.min(barW / 2, 2);
        roundRect(ctx, x, y, barW, bh, rad);
        ctx.fill();
    });

    return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

sizes.forEach(size => {
    const canvas = drawIcon(size);
    const buf = canvas.toBuffer('image/png');
    const out = path.join(outDir, `icon${size}.png`);
    fs.writeFileSync(out, buf);
    console.log(`✓ Generated icon${size}.png`);
});
console.log('\n✅ All icons generated in /icons/');
