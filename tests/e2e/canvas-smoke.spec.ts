import { expect, test } from "@playwright/test";

import { ensureCanvasServer } from "../../src/canvas/server.js";
import { SceneStore } from "../../src/shared/state.js";

test("renders a live Excalidraw canvas and exports PNG", async ({ page }, testInfo) => {
  const store = new SceneStore();
  store.batchCreate([
    {
      id: "input",
      type: "rectangle",
      x: 80,
      y: 120,
      width: 180,
      height: 80,
      label: { text: "Input", fontSize: 22 },
      backgroundColor: "#dbeafe",
      strokeColor: "#2563eb",
    },
    {
      id: "process",
      type: "rectangle",
      x: 340,
      y: 120,
      width: 190,
      height: 80,
      label: { text: "Process", fontSize: 22 },
      backgroundColor: "#dcfce7",
      strokeColor: "#16a34a",
    },
    {
      id: "output",
      type: "rectangle",
      x: 620,
      y: 120,
      width: 180,
      height: 80,
      label: { text: "Output", fontSize: 22 },
      backgroundColor: "#fef3c7",
      strokeColor: "#d97706",
    },
    { id: "input-process", type: "arrow", startElementId: "input", endElementId: "process" },
    { id: "process-output", type: "arrow", startElementId: "process", endElementId: "output" },
  ]);
  store.setViewport({ scrollToContent: true, zoom: 1 });

  const handle = await ensureCanvasServer(store);
  try {
    await page.goto(handle.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas");
    await page.waitForFunction(() => document.body.innerText.includes("Clients 1"));
    await page.waitForTimeout(1_000);

    await page.screenshot({ path: testInfo.outputPath("canvas-smoke.png"), fullPage: true });

    const canvasStats = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      return canvases.map((canvas) => {
        const context = canvas.getContext("2d");
        if (!context || canvas.width === 0 || canvas.height === 0) {
          return { width: canvas.width, height: canvas.height, nonWhite: 0, sampled: 0 };
        }

        const image = context.getImageData(0, 0, Math.min(canvas.width, 1200), Math.min(canvas.height, 800));
        let nonWhite = 0;
        let sampled = 0;
        for (let index = 0; index < image.data.length; index += 40) {
          const red = image.data[index]!;
          const green = image.data[index + 1]!;
          const blue = image.data[index + 2]!;
          const alpha = image.data[index + 3]!;
          sampled += 1;
          if (alpha > 0 && !(red > 245 && green > 245 && blue > 245)) {
            nonWhite += 1;
          }
        }
        return { width: canvas.width, height: canvas.height, nonWhite, sampled };
      });
    });

    expect(page.locator("body")).toContainText("Connected");
    expect(page.locator("body")).toContainText("Elements");
    expect(canvasStats.some((stat) => stat.nonWhite > 50)).toBe(true);
    expect(store.describe().count).toBeGreaterThan(0);

    const png = await handle.requestExport("png", true);
    expect(Buffer.from(png.data, "base64").length).toBeGreaterThan(1_000);
  } finally {
    await handle.close();
  }
});
