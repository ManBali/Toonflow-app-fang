import { randomBytes } from "node:crypto";
import type { publicUser } from "@/utils/users";

// ACT: Webhook 由使用方直接提供，先写死在通知模块；如需多环境或换群，再挪到 settings.json。
const webhookUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/d856cc59-2979-4691-9c6c-4dc32fe0b456";
const codeTtl = 5 * 60 * 1000;
const resendInterval = 60 * 1000;
// 登录验证码与限频状态都是进程内单例，服务重启后需重新发送。
const loginCodes = new Map<string, { code: string; expiresAt: number }>();
const lastSentAt = new Map<string, number>();

async function sendText(text: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "text", content: { text } }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as { code?: number; msg?: string };
  if (!response.ok || result.code !== 0) throw new Error(`飞书消息发送失败（${result.msg ?? response.status}）`);
}

export async function createLoginCode(username: string) {
  const now = Date.now();
  const last = lastSentAt.get(username);
  if (last && now - last < resendInterval) throw Object.assign(new Error("验证码发送过于频繁，请一分钟后再试"), { status: 429 });
  lastSentAt.set(username, now);
  for (const [key, entry] of loginCodes) if (entry.expiresAt < now) loginCodes.delete(key);
  // ACT: 验证码只在服务端内存与飞书消息中出现，接口响应不回显，无法绕过飞书取得。
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  loginCodes.set(username, { code, expiresAt: now + codeTtl });
  await sendText(`【Catflow 登录验证码】${code}，5 分钟内有效。若非本人操作，请忽略本消息。`);
  return code;
}

// 匹配成功即消耗（防重放）；输错不销毁，允许重试，过期或重发后自动作废。
export function consumeLoginCode(username: unknown, code: unknown) {
  if (typeof username !== "string" || typeof code !== "string") return false;
  const entry = loginCodes.get(username);
  if (!entry || entry.expiresAt < Date.now() || entry.code !== code.trim()) return false;
  loginCodes.delete(username);
  return true;
}

// ACT: 浏览器与系统识别用简化启发式，覆盖主流场景；需要精确到小版本时再引入 UA 解析库。
export function parseUserAgent(userAgent: string) {
  const browser = (() => {
    for (const [pattern, name] of [
      [/Edg\/([\d.]+)/, "Edge"], [/OPR\/([\d.]+)/, "Opera"], [/Chrome\/([\d.]+)/, "Chrome"],
      [/Firefox\/([\d.]+)/, "Firefox"], [/Version\/([\d.]+).*Safari/, "Safari"],
    ] as const) {
      const matched = userAgent.match(pattern);
      if (matched) return `${name} ${matched[1]?.split(".")[0] ?? ""}`.trim();
    }
    return "未知浏览器";
  })();
  const system = /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Linux/.test(userAgent) ? "Linux" : "未知系统";
  return { browser, system };
}

export async function notifyLogin(user: publicUser, userAgent: string) {
  const { browser, system } = parseUserAgent(userAgent);
  await sendText([
    "【Catflow】用户登录通知",
    `用户名：${user.displayName}（${user.username}）`,
    `用户 ID：${user.id}`,
    `浏览器：${browser}`,
    `系统：${system}`,
    `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
  ].join("\n"));
}
