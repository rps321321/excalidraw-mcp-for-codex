import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const manifestPath = path.join(process.cwd(), "examples", "golden-manifest.json");

describe("example gallery visual regression", () => {
  it("keeps generated golden gallery assets present and nonblank", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scenes: Array<{
        name: string;
        scene: string;
        png: { path: string; bytes: number; width: number; height: number };
        svg: { path: string; bytes: number };
      }>;
    };

    expect(manifest.scenes.length).toBeGreaterThanOrEqual(6);
    for (const scene of manifest.scenes) {
      const pngPath = path.join(process.cwd(), scene.png.path);
      const svgPath = path.join(process.cwd(), scene.svg.path);
      const scenePath = path.isAbsolute(scene.scene) ? scene.scene : path.join(process.cwd(), scene.scene);

      expect(existsSync(scenePath), `${scene.name} scene exists`).toBe(true);
      expect(existsSync(pngPath), `${scene.name} PNG exists`).toBe(true);
      expect(existsSync(svgPath), `${scene.name} SVG exists`).toBe(true);

      const png = readFileSync(pngPath);
      expect(png.subarray(1, 4).toString("ascii"), `${scene.name} PNG signature`).toBe("PNG");
      expect(png.readUInt32BE(16), `${scene.name} PNG width`).toBe(scene.png.width);
      expect(png.readUInt32BE(20), `${scene.name} PNG height`).toBe(scene.png.height);
      expect(statSync(pngPath).size, `${scene.name} PNG byte floor`).toBeGreaterThan(Math.max(2_000, scene.png.bytes * 0.5));
      expect(statSync(svgPath).size, `${scene.name} SVG byte floor`).toBeGreaterThan(Math.max(1_000, scene.svg.bytes * 0.5));
      expect(readFileSync(svgPath, "utf8"), `${scene.name} SVG tag`).toContain("<svg");
    }
  });
});
