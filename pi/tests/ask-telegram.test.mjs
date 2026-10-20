import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Exercise the installed integration, not a copy of the session configuration.
// No Telegram traffic or real credentials are used.
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const piRoot = join(globalRoot, "@earendil-works/pi-coding-agent");
const requireFromPi = createRequire(join(piRoot, "package.json"));
const { createJiti } = requireFromPi("jiti");
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  alias: {
    "typebox/value": requireFromPi.resolve("typebox/value"),
    "typebox": requireFromPi.resolve("typebox"),
    "@earendil-works/pi-coding-agent": join(piRoot, "dist/index.js"),
    "@earendil-works/pi-tui": requireFromPi.resolve("@earendil-works/pi-tui"),
  },
});
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "test-chat";
process.env.TELEGRAM_SECRETS_FILE = "/nonexistent/telegram-test.env";
const extension = await jiti.import(join(homedir(), ".pi/agent/extensions/ask-telegram.ts"), { default: true });
const { getKeybindings } = await jiti.import(requireFromPi.resolve("@earendil-works/pi-tui"));
const theme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  dim: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
};

// Loading the real rpiv session also exercises Pi's real Editor and dialog view.
async function runScenario(t, scenario) {
  const tools = new Map();
  extension({ registerTool: (tool) => tools.set(tool.name, tool) });
  const controller = new AbortController();
  t.after(() => controller.abort());
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (String(url).endsWith("/sendMessage")) {
      return { ok: true, json: async () => ({ result: { message_id: 123, date: 1 } }) };
    }
    if (String(url).includes("/getUpdates")) {
      if (JSON.parse(init.body).offset === -1) return apiResponse([]);
      await untilAborted(init.signal);
      throw new DOMException("Aborted", "AbortError");
    }
    assert.ok(String(url).endsWith("/editMessageText"));
    return apiResponse(true);
  });
  let rendered = false;
  let listenerRemoved = false;
  const ctx = {
    hasUI: true,
    ui: {
      notify: (message) => assert.fail(message),
      onTerminalInput: () => () => { listenerRemoved = true; },
      custom: async (factory, options) => {
        assert.equal(options.overlay, true);
        const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} };
        const keybindings = getKeybindings();
        let result;
        const component = factory(tui, theme, keybindings, (value) => { result = value; });
        for (const [width, rows] of [[100, 40], [40, 18], [120, 50]]) {
          tui.terminal.rows = rows;
          component.invalidate();
          const lines = component.render(width);
          assert.ok(lines.length > 0);
          assert.ok(lines.length <= rows, `dialog exceeds ${rows} terminal rows`);
          assert.match(lines.join("\n"), /Choose a route/);
          assert.match(lines.join("\n"), /Type something/);
        }
        rendered = true;
        for (const key of scenario.keys) component.handleInput(key);
        assert.ok(result, "keyboard interaction should finish the questionnaire");
        return result;
      },
    },
  };
  const result = await tools.get("ask_telegram").execute(
    "test-call", { question: "Choose a route", options: ["First route", "Second route"] },
    controller.signal, undefined, ctx,
  );
  assert.equal(rendered, true);
  assert.equal(listenerRemoved, true);
  assert.equal(result.content[0].text, `User replied: ${scenario.expected}`);
}

for (const scenario of [
  { name: "first option", keys: ["\r"], expected: "First route" },
  { name: "second option", keys: ["\x1b[B", "\r"], expected: "Second route" },
  { name: "custom answer", keys: ["\x1b[B", "\x1b[B", "My route", "\r"], expected: "My route" },
  { name: "cancel", keys: ["\x1b"], expected: "No choice made" },
]) {
  test(`ask_telegram renders/resizes rpiv overlay: ${scenario.name}`, { timeout: 10000 }, (t) => runScenario(t, scenario));
}

function askTool() {
  const tools = new Map();
  extension({ registerTool: tool => tools.set(tool.name, tool) });
  return tools.get("ask_telegram");
}

function apiResponse(result) {
  return { ok: true, json: async () => ({ ok: true, result }) };
}

function untilAborted(signal) {
  return new Promise(resolve => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", resolve, { once: true });
  });
}

function telegramMock(t, updates, staleUpdates = []) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const method = String(url).split("/").at(-1).split("?")[0];
    requests.push({ method, url: String(url), init });
    if (method === "sendMessage") return { ok: true, json: async () => ({ result: { message_id: 123, date: 1 } }) };
    if (method === "getUpdates") {
      if (JSON.parse(init.body).offset === -1) return apiResponse(staleUpdates);
      return updates(init, requests);
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  });
  return requests;
}

const click = { update_id: 1, callback_query: { id: "click", data: "1", message: { message_id: 123, chat: { id: "test-chat" } } } };

test("Telegram button works without a terminal UI", { timeout: 3000 }, async t => {
  const requests = telegramMock(t, async () => ({ ok: true, json: async () => ({ result: [click] }) }));
  const result = await askTool().execute("headless", { question: "Choose", options: ["First", "Second"] }, undefined, undefined, { hasUI: false });
  assert.equal(result.content[0].text, "User replied: Second");
  assert.equal(requests.some(r => r.method === "answerCallbackQuery"), true);
});

test("terminal answer cancels its Telegram poll before returning", { timeout: 3000 }, async t => {
  let pollSignal;
  telegramMock(t, async init => {
    pollSignal = init.signal;
    await new Promise(resolve => {
      if (init.signal?.aborted) resolve();
      else init.signal?.addEventListener("abort", resolve, { once: true });
    });
    throw new DOMException("Aborted", "AbortError");
  });
  const ctx = { hasUI: true, ui: { notify() {}, custom: async factory => {
    let answer;
    factory({ requestRender() {} }, theme, {}, value => { answer = value; }).handleInput("\r");
    return answer;
  } } };
  const result = await askTool().execute("terminal", { question: "Choose", options: ["First"] }, undefined, undefined, ctx);
  assert.equal(result.content[0].text, "User replied: First");
  assert.ok(pollSignal?.aborted, "finished prompts must not keep consuming another prompt's button clicks");
});

function pendingUI() {
  let closed = 0;
  let listenerRemoved = false;
  const ctx = { hasUI: true, ui: {
    notify() {},
    onTerminalInput: () => () => { listenerRemoved = true; },
    custom: factory => new Promise(resolve => {
      factory({ requestRender() {} }, theme, {}, value => { closed++; resolve(value); });
    }),
  } };
  return { ctx, get closed() { return closed; }, get listenerRemoved() { return listenerRemoved; } };
}

const prompt = { question: "Choose", options: ["First", "Second"] };
const headless = { hasUI: false };

test("Telegram wins with the terminal open, closes it, and clears buttons", { timeout: 3000 }, async t => {
  const ui = pendingUI();
  const requests = telegramMock(t, async () => apiResponse([click]));
  const result = await askTool().execute("telegram", prompt, undefined, undefined, ui.ctx);
  assert.equal(result.content[0].text, "User replied: Second");
  assert.equal(ui.closed, 1);
  assert.equal(ui.listenerRemoved, true);
  const edit = JSON.parse(requests.find(r => r.method === "editMessageText").init.body);
  assert.deepEqual(edit.reply_markup, { inline_keyboard: [] });
  assert.match(edit.text, /Answered via telegram: Second/);
});

test("RPC mode does not race an unsupported custom UI", { timeout: 3000 }, async t => {
  telegramMock(t, async () => apiResponse([click]));
  const result = await askTool().execute("rpc", prompt, undefined, undefined, {
    hasUI: true, mode: "rpc", ui: { custom() { assert.fail("RPC cannot render custom components"); } },
  });
  assert.equal(result.content[0].text, "User replied: Second");
});

test("cursor is established before sending; immediate replies are preserved", { timeout: 3000 }, async t => {
  const requests = telegramMock(t, async init => {
    assert.equal(JSON.parse(init.body).offset, 41);
    return apiResponse([{ ...click, update_id: 41 }]);
  }, [{ update_id: 40 }]);
  await askTool().execute("cursor", prompt, undefined, undefined, headless);
  assert.deepEqual(requests.slice(0, 3).map(r => r.method), ["getUpdates", "sendMessage", "getUpdates"]);
});

test("foreign chats, stale replies and malformed/out-of-range buttons cannot answer", { timeout: 3000 }, async t => {
  const callback = (id, data, chat = "test-chat", message = 123) => ({ update_id: id, callback_query: {
    id: `click-${id}`, data, message: { message_id: message, chat: { id: chat } },
  } });
  const message = (id, chat, text, date = 1, reply) => ({ update_id: id, message: {
    chat: { id: chat }, text, date, ...(reply ? { reply_to_message: { message_id: reply } } : {}),
  } });
  const requests = telegramMock(t, async () => apiResponse([
    callback(1, "0", "foreign-chat"), callback(2, "0", "test-chat", 999),
    callback(3, "1junk"), callback(4, "99"), callback(5, "-1"),
    message(6, "foreign-chat", "First"), message(7, "test-chat", "First", 0),
    message(8, "test-chat", "First", 1, 999), message(9, "test-chat", "   "),
    message(10, "test-chat", "2", 1, 123),
  ]));
  const result = await askTool().execute("validation", prompt, undefined, undefined, headless);
  assert.equal(result.content[0].text, "User replied: Second");
  assert.equal(requests.filter(r => r.method === "answerCallbackQuery").length, 3);
});

test("free text remains available", { timeout: 3000 }, async t => {
  telegramMock(t, async () => apiResponse([{ update_id: 1, message: {
    chat: { id: "test-chat" }, text: "  A custom answer  ", date: 1,
  } }]));
  const result = await askTool().execute("text", prompt, undefined, undefined, headless);
  assert.equal(result.content[0].text, "User replied: A custom answer");
});

test("an already aborted call sends nothing", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("aborted calls must not send requests"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(askTool().execute("aborted", prompt, controller.signal, undefined, headless), /abort/i);
});

test("abort cancels pending fetch, closes the UI and releases ownership", { timeout: 3000 }, async t => {
  const controller = new AbortController();
  const ui = pendingUI();
  let pollSignal;
  const requests = telegramMock(t, async init => {
    pollSignal = init.signal;
    setImmediate(() => controller.abort());
    await untilAborted(init.signal);
    throw new DOMException("Aborted", "AbortError");
  });
  await assert.rejects(askTool().execute("abort", prompt, controller.signal, undefined, ui.ctx), /abort/i);
  assert.ok(pollSignal.aborted);
  assert.equal(ui.closed, 1);
  assert.equal(ui.listenerRemoved, true);
  const edit = JSON.parse(requests.find(r => r.method === "editMessageText").init.body);
  assert.match(edit.text, /cancelled/);
  assert.doesNotMatch(edit.text, /via undefined/);
  telegramMock(t, async () => apiResponse([click]));
  await askTool().execute("after-abort", prompt, undefined, undefined, headless);
});

test("409 conflicts fail promptly, close the UI and release ownership", { timeout: 3000 }, async t => {
  const ui = pendingUI();
  let polls = 0;
  telegramMock(t, async () => {
    polls++;
    return { ok: false, status: 409, json: async () => ({ ok: false, error_code: 409, description: "Conflict" }) };
  });
  await assert.rejects(askTool().execute("conflict", prompt, undefined, undefined, ui.ctx), /Another session or program is polling/);
  assert.equal(polls, 1);
  assert.equal(ui.closed, 1);
  telegramMock(t, async () => apiResponse([click]));
  await askTool().execute("after-conflict", prompt, undefined, undefined, headless);
});

test("transport failures do not expose credentials or keep retrying", { timeout: 3000 }, async t => {
  let polls = 0;
  telegramMock(t, async () => { polls++; throw new Error("fetch https://api.telegram.org/bottest-token/getUpdates failed"); });
  await assert.rejects(askTool().execute("network", prompt, undefined, undefined, headless), error => {
    assert.match(error.message, /request failed or timed out/);
    assert.doesNotMatch(error.message, /test-token/);
    return true;
  });
  assert.equal(polls, 1);
});

test("failed sends release the bot for a subsequent prompt", { timeout: 3000 }, async t => {
  t.mock.method(globalThis, "fetch", async url => String(url).endsWith("getUpdates")
    ? apiResponse([])
    : { ok: false, status: 400, json: async () => ({ ok: false, description: "Bad request" }) });
  await assert.rejects(askTool().execute("send-fail", prompt, undefined, undefined, headless), /sendMessage failed/);
  telegramMock(t, async () => apiResponse([click]));
  await askTool().execute("after-fail", prompt, undefined, undefined, headless);
});

test("cleanup API failure does not change a successful answer or retain ownership", { timeout: 3000 }, async t => {
  const warnings = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const method = String(url).split("/").at(-1);
    if (method === "getUpdates") return apiResponse(JSON.parse(init.body).offset === -1 ? [] : [click]);
    if (method === "sendMessage") return apiResponse({ message_id: 123, date: 1 });
    if (method === "editMessageText") return { ok: false, status: 400, json: async () => ({ ok: false }) };
    return apiResponse(true);
  });
  const result = await askTool().execute("cleanup-fail", prompt, undefined, undefined, {
    hasUI: false, ui: { notify: message => warnings.push(message) },
  });
  assert.equal(result.content[0].text, "User replied: Second");
  assert.equal(warnings.length, 1);
  telegramMock(t, async () => apiResponse([click]));
  await askTool().execute("after-cleanup-fail", prompt, undefined, undefined, headless);
});

test("ownership rejects overlapping prompts, including a separate Pi process", { timeout: 10000 }, async t => {
  const controller = new AbortController();
  let signalPolling;
  const polling = new Promise(resolve => { signalPolling = resolve; });
  const requests = telegramMock(t, async init => {
    signalPolling();
    await untilAborted(init.signal);
    throw new DOMException("Aborted", "AbortError");
  });
  const first = askTool().execute("owner", prompt, controller.signal, undefined, headless);
  // Attach the rejection assertion before triggering an abort.
  const firstFinished = assert.rejects(first, /abort/i);
  try {
    await polling;
    const before = requests.length;
    await assert.rejects(askTool().execute("overlap", prompt, undefined, undefined, headless), /Another ask_telegram prompt owns/);
    assert.equal(requests.length, before, "a second prompt must not flush updates or send a competing question");
    const childSource = `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      const req = createRequire(${JSON.stringify(join(piRoot, "package.json"))});
      const { createJiti } = req('jiti');
      const jiti = createJiti(import.meta.url, { fsCache: false, alias: ${JSON.stringify({
        "typebox/value": requireFromPi.resolve("typebox/value"),
        "typebox": requireFromPi.resolve("typebox"),
        "@earendil-works/pi-coding-agent": join(piRoot, "dist/index.js"),
        "@earendil-works/pi-tui": requireFromPi.resolve("@earendil-works/pi-tui"),
      })} });
      const ext = await jiti.import(${JSON.stringify(join(homedir(), ".pi/agent/extensions/ask-telegram.ts"))}, { default: true });
      const tools = new Map();
      ext({ registerTool: tool => tools.set(tool.name, tool) });
      globalThis.fetch = () => assert.fail('competing process must not call Telegram');
      await assert.rejects(tools.get('ask_telegram').execute('child', ${JSON.stringify(prompt)}, undefined, undefined, { hasUI: false }), /Another ask_telegram prompt owns/);
      console.log('locked');
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", childSource], { encoding: "utf8", timeout: 7000 });
    assert.equal(output.trim(), "locked");
  } finally {
    controller.abort();
    await firstFinished;
  }
});
