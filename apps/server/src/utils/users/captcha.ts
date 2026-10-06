import { randomBytes, randomUUID } from "node:crypto";

// 去掉 0O1I 等易混淆字符。
const captchaCharacters = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const captchaLength = 4;
const captchaTtl = 5 * 60 * 1000;
const captchaStore = new Map<string, { code: string; expiresAt: number }>();

export function createCaptcha() {
  const code = Array.from(randomBytes(captchaLength), byte => captchaCharacters[byte % captchaCharacters.length]).join("");
  const id = randomUUID();
  const now = Date.now();
  for (const [key, entry] of captchaStore) if (entry.expiresAt < now) captchaStore.delete(key);
  captchaStore.set(id, { code, expiresAt: now + captchaTtl });
  return { id, svg: renderCaptchaSvg(code) };
}

export function verifyCaptcha(id: unknown, input: unknown) {
  if (typeof id !== "string" || typeof input !== "string") return false;
  const entry = captchaStore.get(id);
  // 验证码一次性，校验即作废，防止重放。
  captchaStore.delete(id);
  return !!entry && entry.expiresAt > Date.now() && entry.code === input.trim().toUpperCase();
}

function renderCaptchaSvg(code: string) {
  const width = 120;
  const height = 40;
  const palette = ["#409eff", "#67c23a", "#e6a23c", "#f56c6c", "#909399"];
  const rx = () => (Math.random() * width).toFixed(1);
  const ry = () => (Math.random() * height).toFixed(1);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#f5f7fa"/>`);
  for (let i = 0; i < 3; i++) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    parts.push(`<path d="M0 ${ry()} C 40 ${ry()}, 80 ${ry()}, 120 ${ry()}" stroke="${color}" stroke-width="1" fill="none" opacity="0.5"/>`);
  }
  for (let i = 0; i < 12; i++) {
    parts.push(`<circle cx="${rx()}" cy="${ry()}" r="1" fill="#909399" opacity="0.5"/>`);
  }
  const step = width / (code.length + 1);
  [...code].forEach((char, index) => {
    const x = step * (index + 0.8) + (Math.random() * 4 - 2);
    const y = 28 + (Math.random() * 8 - 4);
    const rotate = (Math.random() * 40 - 20).toFixed(1);
    const fill = palette[Math.floor(Math.random() * palette.length)];
    const size = 24 + Math.floor(Math.random() * 6);
    parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-size="${size}" font-weight="bold" transform="rotate(${rotate} ${x.toFixed(1)} ${y.toFixed(1)})">${char}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}