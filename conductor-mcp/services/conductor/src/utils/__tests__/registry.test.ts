import { describe, expect, it, vi } from "vitest";

vi.mock("fs/promises");
vi.mock("../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  registryLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getCurrentProjectId,
  getTaskContextPath,
  getTaskDirPath,
  getTaskPromptPath,
  readTaskRegistry,
  writeTaskRegistry,
} from "../registry.js";

// ── Path functions (validateTaskId) ─────────────────────────────────────────

describe("getTaskContextPath", () => {
  it("returns path ending with context.md for valid ID", () => {
    const p = getTaskContextPath("TASK001");
    expect(p).toMatch(/\.claude[/\\]tasks[/\\]TASK001[/\\]context\.md$/);
  });
});

describe("getTaskPromptPath", () => {
  it("returns path ending with prompt.md for valid ID", () => {
    const p = getTaskPromptPath("TASK001");
    expect(p).toMatch(/\.claude[/\\]tasks[/\\]TASK001[/\\]prompt\.md$/);
  });
});

describe("getTaskDirPath", () => {
  it("returns path ending with task ID dir for valid ID", () => {
    const p = getTaskDirPath("TASK001");
    expect(p).toMatch(/\.claude[/\\]tasks[/\\]TASK001$/);
  });
});

describe("validateTaskId (via path functions)", () => {
  it("accepts valid ID with hyphens and underscores", () => {
    expect(() => getTaskContextPath("a-b_c")).not.toThrow();
  });

  it("throws for ID with spaces", () => {
    expect(() => getTaskContextPath("bad id")).toThrow("Invalid task ID");
  });

  it("throws for path traversal attempt", () => {
    expect(() => getTaskContextPath("../etc")).toThrow("Invalid task ID");
  });

  it("throws for ID with dots", () => {
    expect(() => getTaskContextPath("task.1")).toThrow("Invalid task ID");
  });

  it("throws for empty string", () => {
    expect(() => getTaskContextPath("")).toThrow("Invalid task ID");
  });

  it("throws for ID with special characters", () => {
    expect(() => getTaskContextPath("id@!")).toThrow("Invalid task ID");
  });
});

// ── I/O functions (mocked fs) ────────────────────────────────────────────────

describe("readTaskRegistry", () => {
  it("returns parsed JSON when file exists", async () => {
    const fs = await import("fs/promises");
    const mockRegistry = {
      version: "1.0.0",
      counter: 2,
      tasks: { T1: {} as any },
    };
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify(mockRegistry) as any,
    );

    const result = await readTaskRegistry();
    expect(result).toEqual(mockRegistry);
  });

  it("returns default registry on ENOENT", async () => {
    const fs = await import("fs/promises");
    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    vi.mocked(fs.readFile).mockRejectedValueOnce(err);

    const result = await readTaskRegistry();
    expect(result).toEqual({ version: "1.0.0", counter: 0, tasks: {} });
  });

  it("returns default registry on invalid JSON", async () => {
    const fs = await import("fs/promises");
    vi.mocked(fs.readFile).mockResolvedValueOnce("not-json" as any);

    const result = await readTaskRegistry();
    expect(result).toEqual({ version: "1.0.0", counter: 0, tasks: {} });
  });
});

describe("writeTaskRegistry", () => {
  it("calls mkdir and writeFile with JSON content", async () => {
    const fs = await import("fs/promises");
    vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);
    vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined);

    const registry = { version: "1.0.0", counter: 0, tasks: {} };
    await writeTaskRegistry(registry);

    expect(fs.mkdir).toHaveBeenCalledOnce();
    expect(fs.writeFile).toHaveBeenCalledOnce();
    const [, content] = vi.mocked(fs.writeFile).mock.calls[0] as [
      unknown,
      string,
      ...unknown[],
    ];
    expect(JSON.parse(content)).toEqual(registry);
  });

  it("serializes concurrent writes in order", async () => {
    const fs = await import("fs/promises");
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    const order: number[] = [];
    const delays = [30, 10, 20];
    let callIndex = 0;

    vi.mocked(fs.writeFile).mockImplementation(async () => {
      const idx = callIndex++;
      order.push(idx);
      await new Promise<void>((r) => setTimeout(r, delays[idx]));
    });

    const reg = { version: "1.0.0", counter: 0, tasks: {} };
    await Promise.all([
      writeTaskRegistry(reg),
      writeTaskRegistry(reg),
      writeTaskRegistry(reg),
    ]);

    expect(fs.writeFile).toHaveBeenCalledTimes(3);
    expect(order).toEqual([0, 1, 2]);
  });
});

describe("getCurrentProjectId", () => {
  it("returns current project ID when set", async () => {
    const fs = await import("fs/promises");
    const projectRegistry = {
      version: "1.0.0",
      counter: 1,
      current_project_id: "PRJ-001",
      projects: {},
    };
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify(projectRegistry) as any,
    );

    const result = await getCurrentProjectId();
    expect(result).toBe("PRJ-001");
  });

  it("returns null when no current project", async () => {
    const fs = await import("fs/promises");
    const projectRegistry = {
      version: "1.0.0",
      counter: 0,
      current_project_id: null,
      projects: {},
    };
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify(projectRegistry) as any,
    );

    const result = await getCurrentProjectId();
    expect(result).toBeNull();
  });
});
