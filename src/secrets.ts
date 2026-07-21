import * as vscode from "vscode";

const API_KEY_SECRET = "linearMarkdownSync.apiKey";

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(API_KEY_SECRET);
}

/**
 * Prompts for a Linear personal API key and stores it in SecretStorage.
 * Returns the stored key, or undefined if the user cancelled.
 */
export async function promptAndStoreApiKey(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    title: "Linear Personal API Key",
    prompt: "Create a read-only key at linear.app → Settings → Security & access → Personal API keys.",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "lin_api_...",
    validateInput: (value) =>
      value.trim().length === 0 ? "API key cannot be empty" : undefined,
  });

  if (key === undefined) {
    return undefined;
  }

  const trimmed = key.trim();
  await context.secrets.store(API_KEY_SECRET, trimmed);
  return trimmed;
}

export async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET);
}

/**
 * Returns the stored key, prompting for one if none is set yet.
 */
export async function ensureApiKey(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  const existing = await getApiKey(context);
  if (existing) {
    return existing;
  }
  return promptAndStoreApiKey(context);
}
