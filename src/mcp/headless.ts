interface HeadlessCanvasClient {
  url: string;
  close(): Promise<void>;
}

let headlessClient: Promise<HeadlessCanvasClient> | undefined;

export async function ensureHeadlessCanvasClient(url: string): Promise<HeadlessCanvasClient> {
  if (headlessClient) {
    const client = await headlessClient;
    if (client.url === url) {
      return client;
    }
    await client.close().catch(() => undefined);
    headlessClient = undefined;
  }

  headlessClient = createHeadlessCanvasClient(url);
  try {
    return await headlessClient;
  } catch (error) {
    headlessClient = undefined;
    throw error;
  }
}

export async function closeHeadlessCanvasClient(): Promise<void> {
  if (!headlessClient) {
    return;
  }
  const client = await headlessClient.catch(() => undefined);
  headlessClient = undefined;
  await client?.close().catch(() => undefined);
}

async function createHeadlessCanvasClient(url: string): Promise<HeadlessCanvasClient> {
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".mcp-pill-connected").waitFor({ timeout: 20_000 });
    return {
      url,
      close: async () => {
        await browser.close();
      },
    };
  } catch (error) {
    throw new Error(
      `Could not start managed headless canvas for export. Install Playwright dependencies or open start_canvas URL manually. ${errorMessage(error)}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
