#!/usr/bin/env node

import readline from "node:readline";
import { stdin as input, stdout as output, exit } from "node:process";
import crypto from "node:crypto";

const baseUrl = process.env.WORKER_BASE_URL || "http://127.0.0.1:18787";

async function main() {
  console.log("=== Soga Panel 邮箱验证码注册验证脚本 ===");
  console.log("请确保已经启动 wrangler dev，并配置好邮件服务环境变量。\n");

  const rl = readline.createInterface({ input, output });

  const ask = (query) =>
    new Promise((resolve) => {
      rl.question(query, (answer) => resolve(answer.trim()));
    });

  const fetchImpl =
    typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : (await import("node-fetch")).default;

  try {
    const randomSuffix = crypto.randomBytes(3).toString("hex");
    const defaultEmail = `test-${randomSuffix}@example.com`;
    const defaultUsername = `user_${randomSuffix}`;
    const defaultPassword = `Passw0rd!${randomSuffix}`;

    const emailAnswer = await ask(`请输入测试邮箱 (默认: ${defaultEmail}): `);
    const email = emailAnswer || defaultEmail;

    const usernameAnswer = await ask(`请输入用户名 (默认: ${defaultUsername}): `);
    const username = usernameAnswer || defaultUsername;

    const passwordAnswer = await ask(`请输入密码 (默认: ${defaultPassword}): `);
    const password = passwordAnswer || defaultPassword;

    console.log(`\n[1/3] 向 ${email} 发送验证码...`);
    const sendResponse = await fetchImpl(`${baseUrl}/api/auth/send-email-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const sendPayload = await sendResponse.json().catch(() => ({}));

    if (!sendResponse.ok || sendPayload.code !== 0) {
      throw new Error(sendPayload?.message || `发送验证码失败 (HTTP ${sendResponse.status})`);
    }

    console.log(
      `发送成功：${sendPayload.data?.message || "验证码已发送"}（冷却 ${
        sendPayload.data?.cooldown ?? "?"
      } 秒，有效期 ${sendPayload.data?.expire_minutes ?? "?"} 分钟）`
    );
    console.log("请前往邮箱获取验证码。\n");

    const verificationCode = await ask("请输入邮箱中的验证码: ");
    if (!verificationCode) {
      throw new Error("未输入验证码，流程终止");
    }

    console.log("\n[2/3] 提交注册请求...");
    const registerResponse = await fetchImpl(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        username,
        password,
        verificationCode,
      }),
    });
    const registerPayload = await registerResponse.json().catch(() => ({}));

    if (!registerResponse.ok || registerPayload.code !== 0) {
      throw new Error(registerPayload?.message || `注册失败 (HTTP ${registerResponse.status})`);
    }

    console.log("注册成功！账号信息：");
    console.log(`- 用户名: ${registerPayload.data?.user?.username}`);
    console.log(`- 邮箱: ${registerPayload.data?.user?.email}`);
    console.log(`- Token: ${registerPayload.data?.token?.slice(0, 16)}...`);

    console.log("\n[3/3] 完成。已自动返回登录状态，可使用上方信息验证登录流程。");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`\n脚本执行失败：${error.message}`);
  exit(1);
});
