import { mkdirSync, readFileSync, rmdirSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";

// The terminal side of the race reuses the rpiv-ask-user-question extension's
// questionnaire dialog (the same UI the ask_user_question tool renders).
// These imports go through the package's on-disk module files because its
// package.json "exports" map only exposes "." and "./events" as public
// subpaths — the internals we reuse are not public exports.
import {
  buildItemsForQuestion,
  loadQuestionnaireSession,
} from "../npm/node_modules/@juicesharp/rpiv-ask-user-question/ask-user-question.js";
import { fullRowBudget } from "../npm/node_modules/@juicesharp/rpiv-ask-user-question/presentation.js";
import { normalizeQuestionParams } from "../npm/node_modules/@juicesharp/rpiv-ask-user-question/tool/normalize-params.js";
import { validateQuestionnaire } from "../npm/node_modules/@juicesharp/rpiv-ask-user-question/tool/validate-questionnaire.js";
import {
  MAX_HEADER_LENGTH,
  MAX_LABEL_LENGTH,
} from "../npm/node_modules/@juicesharp/rpiv-ask-user-question/tool/types.js";
import {
  COLLAPSE_KEY_OFF,
  formatKeySpecForDisplay,
  loadConfig,
  resolveCollapseKey,
} from "../npm/node_modules/@juicesharp/rpiv-ask-user-question/config.js";

/** Standard terminal attention bell — same signal rpiv's tool emits before waiting. */
function emitTerminalAttention(): void {
  try {
    if (process.stdout.isTTY) process.stdout.write("\x07");
  } catch {}
}

/**
 * Collapse/expand raw-key listener while the rpiv questionnaire overlay is
 * hidden. Mirrors rpiv's internal registerCollapseKeyListener.
 */
function registerCollapseKeyListener(
  ctx: any,
  collapseKey: string,
  sessionRef: { current: any },
  overlayHandleRef: { current: any },
): (() => void) | undefined {
  if (collapseKey === COLLAPSE_KEY_OFF || typeof ctx.ui.onTerminalInput !== "function") return undefined;
  let hasAnnouncedHide = false;
  return ctx.ui.onTerminalInput((data: any) => {
    const handle = overlayHandleRef.current;
    if (!handle) return undefined;
    if (!handle.isHidden() && !handle.isFocused()) return undefined;
    if (!matchesKey(data, collapseKey as Parameters<typeof matchesKey>[1])) return undefined;
    if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
    sessionRef.current?.toggleCollapsedExternal();
    if (handle.isHidden() && !hasAnnouncedHide) {
      hasAnnouncedHide = true;
      ctx.ui.notify?.(`ask_user_question hidden — press ${formatKeySpecForDisplay(collapseKey)} to reopen`, "info");
    }
    return { consume: true };
  });
}

type TelegramSecrets = {
  botToken: string;
  chatId: string;
};

function loadTelegramSecrets(): TelegramSecrets {
  const secretsFile = process.env.TELEGRAM_SECRETS_FILE ??
    join(homedir(), ".pi", "agent", "private", "telegram.env");
  const values: Record<string, string> = {};

  try {
    for (const line of readFileSync(secretsFile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    // Environment variables remain available when the local secrets file is absent.
  }

  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? values.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? values.TELEGRAM_CHAT_ID ?? "",
  };
}

const { botToken: BOT_TOKEN, chatId: CHAT_ID } = loadTelegramSecrets();

// getUpdates has one shared queue per bot, not per Pi session or chat. Refuse a
// second local prompt before it sends a message or consumes anyone's updates.
function acquireTelegramPrompt(): () => void {
  const botKey = createHash("sha256").update(BOT_TOKEN).digest("hex").slice(0, 24);
  const lockPath = join(tmpdir(), `pi-ask-telegram-${process.getuid?.() ?? "user"}-${botKey}.lock`);
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(`Another ask_telegram prompt owns this bot (${lockPath}). Finish or cancel it first. If its Pi process crashed, remove this lock directory only after confirming no prompt is running.`);
  }
  try {
    writeFileSync(join(lockPath, "owner"), `Pi PID: ${process.pid}\n`, { mode: 0o600 });
  } catch (error) {
    rmdirSync(lockPath);
    throw error;
  }
  return () => {
    unlinkSync(join(lockPath, "owner"));
    rmdirSync(lockPath);
  };
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: string | number };
  text?: string;
  reply_to_message?: { message_id: number };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: { id: string; data?: string; message?: TelegramMessage };
}

type TelegramResults = {
  getUpdates: TelegramUpdate[];
  sendMessage: TelegramMessage;
  answerCallbackQuery: boolean;
  editMessageText: TelegramMessage | boolean;
};

async function telegramRequest<M extends keyof TelegramResults>(method: M, payload: Record<string, unknown>, signal?: AbortSignal): Promise<TelegramResults[M]> {
  let response: Response;
  let data: { ok?: boolean; error_code?: number; description?: string; result: TelegramResults[M] };
  try {
    response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(3000),
    });
    data = await response.json();
  } catch {
    if (signal?.aborted) throw new Error("Aborted");
    // Fetch errors can include the request URL, which contains the bot token.
    throw new Error(`Telegram ${method} request failed or timed out`);
  }
  if (!response.ok || data.ok === false) {
    const conflict = response.status === 409 || data.error_code === 409;
    const description = String(data.description ?? response.statusText ?? "API error").replaceAll(BOT_TOKEN, "[redacted]");
    throw new Error(`Telegram ${method} failed (${data.error_code ?? response.status}): ${description}${conflict ? ". Another session or program is polling this bot; reload or stop the old poller before retrying." : ""}`);
  }
  return data.result;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_telegram",
    label: "Ask Telegram (Dual Prompt)",
    description: "Ask the user a question on both Telegram and the Terminal simultaneously. The first one to receive an answer wins. The terminal renders the rpiv-ask-user-question questionnaire dialog (with a 'Type something.' custom-answer row and notes); Telegram shows numbered buttons plus a free-text reply option.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
      required: ["question", "options"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { question, options } = params as { question: string, options: string[] };

      if (!BOT_TOKEN || !CHAT_ID) {
        throw new Error(`Telegram credentials unavailable; create ${process.env.TELEGRAM_SECRETS_FILE ?? "~/.pi/agent/private/telegram.env"} or set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID`);
      }

      signal?.throwIfAborted();
      const releasePrompt = acquireTelegramPrompt();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      let closeTerminalUI: (() => void) | undefined;
      let terminalPromise: Promise<string | null> | undefined;
      let telegramPromise: Promise<{ source: string; choice: string }> | undefined;
      let messageId: number | undefined;
      let messageText = "";
      let result: { source: string; choice: string } | null = null;
      try {
        // Establish the cursor BEFORE sending the question so an immediate click
        // cannot be discarded by a stale-update flush after sendMessage.
        const stale = await telegramRequest("getUpdates", { offset: -1, timeout: 0 }, controller.signal);
        let lastUpdateId = stale.reduce((id, update) => Math.max(id, update.update_id), 0);

        // Telegram inline keyboard buttons do not wrap: long button labels get
        // truncated on narrow screens. Instead, render the full option text in the
        // message body as a numbered list and use compact number-only buttons.
        const optionLines = (options || []).map((opt, index) => `${index + 1}. ${opt}`).join('\n');
        messageText = options && options.length > 0 ? `${question}\n\n${optionLines}` : question;

        const inline_keyboard = (options || []).map((opt, index) => {
          return [{ text: String(index + 1), callback_data: String(index) }];
        });

        const payload = {
          chat_id: CHAT_ID, text: messageText,
          ...(inline_keyboard.length > 0 ? { reply_markup: { inline_keyboard } } : {}),
        };

        const sent = await telegramRequest("sendMessage", payload, controller.signal);
        messageId = sent.message_id;
        const sentDate = sent.date;

        // Keep the original selector as a fallback if rpiv cannot render (for
        // example, an unsupported option set or a failed lazy module load).
        const runLegacyTerminalUI = (): Promise<string | null> =>
          ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
            closeTerminalUI = () => done(null);

            const container = new Container();
            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
            container.addChild(new Text(theme.fg("accent", theme.bold("Question (Answer here or on Telegram)")), 1, 0));
            container.addChild(new Text(question, 1, 1));

            const selectItems = options.map(opt => ({ value: opt, label: opt }));
            const selectList = new SelectList(selectItems, Math.min(selectItems.length, 10), {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("dim", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("dim", t),
            });

            selectList.onSelect = (item) => done(item.value);
            selectList.onCancel = () => done(null);
            container.addChild(selectList);

            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

            return {
              render: (w) => container.render(w),
              invalidate: () => container.invalidate(),
              handleInput: (data) => {
                selectList.handleInput(data);
                tui.requestRender();
              },
            };
          });

        // rpiv requires compact labels and a compact tab header. Keep the full
        // Telegram option text and map a selected display label back to it below.
        const displayLabels = options.map(opt =>
          opt.length <= MAX_LABEL_LENGTH ? opt : opt.slice(0, MAX_LABEL_LENGTH - 1) + "…",
        );

        const choiceFromResult = (result: any): string | null => {
          if (!result || result.cancelled) return null;
          const answer = result.answers?.[0];
          if (!answer) return null;

          let choice = answer.kind === "multi"
            ? (answer.selected || []).join(", ")
            : answer.answer || "";
          const index = displayLabels.indexOf(choice);
          if (index >= 0) choice = options[index];

          const notes = [answer.notes, result.globalNote].filter(Boolean).join(" / ");
          return notes ? `${choice} (note: ${notes})` : choice;
        };

        // Render the terminal leg with rpiv-ask-user-question's full
        // questionnaire UI, including custom text, notes, and collapse support.
        terminalPromise = ctx.hasUI && (!ctx.mode || ctx.mode === "tui") ? (async (): Promise<string | null> => {
          if (controller.signal.aborted) return null;

          const header = question.replace(/\s+/g, " ").trim().slice(0, MAX_HEADER_LENGTH) || "Question";
          const typed = normalizeQuestionParams({
            questions: [{
              question,
              header,
              options: displayLabels.map(label => ({ label, description: "" })),
            }],
          });

          // The legacy selector remains available for option arrays that do not
          // meet rpiv's questionnaire contract (notably fewer than two choices).
          const validation = validateQuestionnaire(typed);
          if (!validation.ok) {
            ctx.ui.notify?.(`ask_telegram: using simple selector — ${validation.message}`, "warning");
            return runLegacyTerminalUI();
          }

          const sessionLoad = await loadQuestionnaireSession();
          if (controller.signal.aborted) return null;
          if (!sessionLoad.ok) {
            ctx.ui.notify?.(`ask_telegram: using simple selector — rpiv questionnaire failed to load (${sessionLoad.error})`, "warning");
            return runLegacyTerminalUI();
          }
          const { QuestionnaireSession } = sessionLoad.module;

          const collapseKey = resolveCollapseKey(loadConfig());
          const sessionRef = { current: null as any };
          const overlayHandleRef = { current: undefined as any };
          const removeOverlayInputListener = registerCollapseKeyListener(
            ctx,
            collapseKey,
            sessionRef,
            overlayHandleRef,
          );
          const canReopenWhileHidden = removeOverlayInputListener !== undefined;

          try {
            emitTerminalAttention();
            const result = await ctx.ui.custom<any>((tui, theme, keybindings, done) => {
              closeTerminalUI = () => done(null);
              const session = new QuestionnaireSession({
                tui,
                theme,
                params: typed,
                itemsByTab: typed.questions.map(buildItemsForQuestion),
                done,
                keybindings,
                editInput: async (value: string) => {
                  try {
                    const [{ SettingsManager }, { editWithExternalEditor }] = await Promise.all([
                      import("@earendil-works/pi-coding-agent"),
                      import("../npm/node_modules/@juicesharp/rpiv-ask-user-question/state/external-editor.js"),
                    ]);
                    const editorCommand = SettingsManager.create(ctx.cwd, undefined, {
                      projectTrusted: ctx.isProjectTrusted(),
                    }).getExternalEditorCommand();
                    if (!editorCommand) throw new Error("No external editor command is configured");
                    return await editWithExternalEditor(tui, editorCommand, value);
                  } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    ctx.ui.notify(`External editor failed: ${message}`, "error");
                    return undefined;
                  }
                },
                collapseKey,
                canReopenWhileHidden,
                // This dialog is an overlay, so it may use the whole terminal height.
                rowBudget: fullRowBudget,
              });
              sessionRef.current = session;
              return session.component;
            }, {
              overlay: true,
              overlayOptions: {
                anchor: "bottom-center",
                width: "100%",
                maxHeight: "100%",
                margin: { left: 0, right: 0, bottom: 0 },
              },
              onHandle: (handle: any) => {
                overlayHandleRef.current = handle;
                sessionRef.current?.setOverlayHandle(handle);
              },
            });
            return choiceFromResult(result);
          } finally {
            removeOverlayInputListener?.();
          }
        })().finally(() => { closeTerminalUI = undefined; }) : undefined;

        // Create the Telegram polling promise
        telegramPromise = (async () => {
          while (true) {
            controller.signal.throwIfAborted();
            const updates = await telegramRequest("getUpdates", {
              offset: lastUpdateId + 1, timeout: 5,
            }, controller.signal);
            for (const update of updates) {
              lastUpdateId = Math.max(lastUpdateId, update.update_id);
              const callback = update.callback_query;
              if (callback?.message?.message_id === messageId && String(callback.message.chat?.id) === CHAT_ID) {
                const index = /^\d+$/.test(callback.data ?? "") ? Number(callback.data) : -1;
                const valid = Number.isSafeInteger(index) && index >= 0 && index < options.length;
                await telegramRequest("answerCallbackQuery", {
                  callback_query_id: callback.id, text: valid ? "Selected!" : "Invalid option",
                }, controller.signal);
                if (valid) return { source: "telegram", choice: options[index] };
              }

              const message = update.message;
              if (String(message?.chat?.id) !== CHAT_ID || !message?.text || message.date < sentDate) continue;
              if (message.reply_to_message && message.reply_to_message.message_id !== messageId) continue;
              const raw = message.text.trim();
              if (!raw) continue;
              const index = /^\d+$/.test(raw) ? Number(raw) - 1 : -1;
              const choice = index >= 0 && index < options.length ? options[index] : raw;
              return { source: "telegram", choice };
            }
          }
        })();

        const cancelled = new Promise<never>((_resolve, reject) => {
          const rejectAbort = () => reject(new Error("Aborted"));
          if (controller.signal.aborted) rejectAbort();
          else controller.signal.addEventListener("abort", rejectAbort, { once: true });
        });
        result = await Promise.race([
          ...(terminalPromise ? [terminalPromise.then(choice => choice ? { source: "terminal", choice } : null)] : []),
          telegramPromise,
          cancelled,
        ]);
        controller.signal.throwIfAborted();
        return {
          content: [{ type: "text", text: `User replied: ${result?.choice || "No choice made"}` }],
          details: {},
        };
      } finally {
        // Stop the losing leg on EVERY exit, including cancellation/API/UI errors.
        // Do not close the terminal from inside the poller: that can make a null
        // terminal result win the race ahead of the actual Telegram answer.
        controller.abort();
        signal?.removeEventListener("abort", abort);
        try {
          closeTerminalUI?.();
          await Promise.allSettled([terminalPromise, telegramPromise]);
          if (messageId !== undefined) {
            const status = result?.choice
              ? `✅ Answered via ${result.source}: ${result.choice}`
              : "Prompt cancelled or unavailable. Please request a new question.";
            await telegramRequest("editMessageText", {
              chat_id: CHAT_ID, message_id: messageId,
              text: `${messageText}\n\n${status}`,
              reply_markup: { inline_keyboard: [] },
            }).catch(() => {
              ctx.ui?.notify?.("ask_telegram: could not clear the old Telegram buttons; they are no longer active.", "warning");
            });
          }
        } finally {
          releasePrompt();
        }
      }
    }
  });

  pi.registerTool({
    name: "notify_telegram",
    label: "Notify Telegram (One-way)",
    description: "Send a one-way informational message to Telegram. Use for progress updates, status notices, and completion summaries. Unlike ask_telegram, this never renders a terminal dialog and never waits for a reply — the user is not required to interact.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message text to send to Telegram." },
        silent: { type: "boolean", description: "Send without a notification sound/vibration on the device." },
      },
      required: ["message"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { message, silent } = params as { message: string, silent?: boolean };

      const payload: any = { chat_id: CHAT_ID, text: message };
      if (silent) { payload.disable_notification = true; }

      const sendRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!sendRes.ok) throw new Error("Failed to send Telegram message");

      return {
        content: [{ type: "text", text: "Telegram message sent." }],
        details: {},
      };
    }
  });
}
