import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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

      // Telegram inline keyboard buttons do not wrap: long button labels get
      // truncated on narrow screens. Instead, render the full option text in the
      // message body as a numbered list and use compact number-only buttons.
      const optionLines = (options || []).map((opt, index) => `${index + 1}. ${opt}`).join('\n');
      const messageText = options && options.length > 0 ? `${question}\n\n${optionLines}` : question;

      const inline_keyboard = (options || []).map((opt, index) => {
        return [{ text: String(index + 1), callback_data: String(index) }];
      });

      const payload: any = { chat_id: CHAT_ID, text: messageText };
      if (inline_keyboard.length > 0) { payload.reply_markup = { inline_keyboard }; }

      const sendRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!sendRes.ok) throw new Error("Failed to send Telegram message");

      const sendData = await sendRes.json();
      const messageId = sendData.result.message_id;
      const sentDate = sendData.result.date;

      // Flush stale updates
      try { await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1&timeout=1`); } catch (e) {}

      // We'll expose this so the terminal UI can be force-closed when Telegram wins.
      let closeTerminalUI: ((result: any) => void) | undefined;

      // Keep the original selector as a fallback if rpiv cannot render (for
      // example, an unsupported option set or a failed lazy module load).
      const runLegacyTerminalUI = (): Promise<string | null> =>
        ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
          closeTerminalUI = done;

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
      const terminalPromise = (async (): Promise<string | null> => {
        if (!ctx.hasUI) return null;

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
            closeTerminalUI = done;
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
      })();

      // Create the Telegram polling promise
      const telegramPromise = (async () => {
        let lastUpdateId = 0;
        while (!signal?.aborted) {
          try {
            const updatesRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`);
            if (!updatesRes.ok) continue;

            const updatesData = await updatesRes.json();
            for (const update of updatesData.result) {
              lastUpdateId = update.update_id;

              if (update.callback_query && update.callback_query.message.message_id === messageId) {
                const dataIndex = parseInt(update.callback_query.data, 10);
                const choice = options[dataIndex];
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ callback_query_id: update.callback_query.id, text: `Selected!` })
                });

                // Force close the terminal UI since Telegram won!
                if (closeTerminalUI) closeTerminalUI(null);
                return { source: "telegram", choice };
              }

              if (update.message && update.message.text && update.message.date >= sentDate) {
                const raw = update.message.text.trim();
                let choice = raw;
                // Allow replying with the option number shown in the message body.
                if (/^\d+$/.test(raw) && options) {
                  const index = parseInt(raw, 10) - 1;
                  if (index >= 0 && index < options.length) choice = options[index];
                }
                // Force close the terminal UI since Telegram won!
                if (closeTerminalUI) closeTerminalUI(null);
                return { source: "telegram", choice };
              }
            }
          } catch (err) {}
        }
        return null;
      })();

      // Race them! First resolved terminal/Telegram answer wins.
      const result = await Promise.race([
        terminalPromise.then(choice => choice ? { source: "terminal", choice } : null),
        telegramPromise,
      ]);

      if (signal?.aborted) throw new Error("Aborted");

      const finalChoice = result?.choice || "No choice made";

      // Cleanup: update the Telegram message so the buttons disappear
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID, message_id: messageId,
          text: `${messageText}\n\n✅ Answered via ${result?.source}: ${finalChoice}`
        })
      }).catch(() => {});

      return {
        content: [{ type: "text", text: `User replied: ${finalChoice}` }],
        details: {},
      };
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
