import { describe, expect, it } from "vitest";
import { parseStreamEvent } from "../stream-parser.js";

describe("parseStreamEvent", () => {
  // 1. system init → {type:'init', content contains '세션 시작'}
  it("returns init event for system init subtype", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc",
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("init");
    expect(result!.content).toContain("세션 시작");
  });

  // 2. system non-init subtype → null
  it("returns null for system event with non-init subtype", () => {
    const line = JSON.stringify({ type: "system", subtype: "other" });
    expect(parseStreamEvent(line)).toBeNull();
  });

  // 3. assistant with text content → {type:'thinking', text:'...'}
  it("returns thinking event for assistant text content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Analyzing..." }] },
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("thinking");
    expect(result!.text).toBe("Analyzing...");
  });

  // 4. assistant tool_use with pattern input → content contains the pattern
  it("returns tool event with pattern detail for tool_use with pattern", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Grep",
            input: { pattern: "parseStreamEvent" },
          },
        ],
      },
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("tool");
    expect(result!.content).toContain("parseStreamEvent");
  });

  // 5. assistant tool_use with file_path → content contains path
  it("returns tool event with file_path detail for tool_use with file_path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/src/index.ts" },
          },
        ],
      },
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("/src/index.ts");
  });

  // 6. assistant tool_use with long command (>50 chars) → truncated with ...
  it("truncates long command at 50 chars with ellipsis", () => {
    const longCmd = "echo " + "a".repeat(60);
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: longCmd } },
        ],
      },
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("...");
    // The truncated portion should be 50 chars of the command
    expect(result!.content).toContain(longCmd.substring(0, 50));
  });

  // 7. assistant tool_use with empty input → just tool name
  it("returns tool event with just tool name for empty input", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "ListFiles", input: {} }],
      },
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("🔧 ListFiles");
    expect(result!.toolName).toBe("ListFiles");
  });

  // 8. assistant empty content array → null
  it("returns null for assistant with empty content array", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [] },
    });
    expect(parseStreamEvent(line)).toBeNull();
  });

  // 9. assistant no message → null
  it("returns null for assistant event with no message", () => {
    const line = JSON.stringify({ type: "assistant" });
    expect(parseStreamEvent(line)).toBeNull();
  });

  // 10. user event → null
  it("returns null for user event", () => {
    const line = JSON.stringify({ type: "user", message: { content: [] } });
    expect(parseStreamEvent(line)).toBeNull();
  });

  // 11. result success with duration_ms and total_cost_usd → {type:'complete', duration_ms set}
  it("returns complete event with duration_ms for result success", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 5000,
      total_cost_usd: 0.0042,
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("complete");
    expect(result!.duration_ms).toBe(5000);
    expect(result!.content).toContain("5.0초");
    expect(result!.content).toContain("$0.0042");
  });

  // 12. result success minimal (no duration/cost) → {type:'complete'}
  it("returns complete event for minimal result success", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "OK",
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("complete");
    expect(result!.duration_ms).toBeUndefined();
  });

  // 13. result error → {type:'error'}
  it("returns error event for result error subtype", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error",
      result: "Something failed",
    });
    const result = parseStreamEvent(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("error");
    expect(result!.content).toContain("Something failed");
  });

  // 14. result unknown subtype → null
  it("returns null for result with unknown subtype", () => {
    const line = JSON.stringify({ type: "result", subtype: "unknown" });
    expect(parseStreamEvent(line)).toBeNull();
  });

  // 15. invalid JSON string → null
  it("returns null for invalid JSON", () => {
    expect(parseStreamEvent("not json at all")).toBeNull();
    expect(parseStreamEvent("{broken")).toBeNull();
  });

  // 16. unknown event type → null
  it("returns null for unknown event type", () => {
    const line = JSON.stringify({ type: "unknown_type" });
    expect(parseStreamEvent(line)).toBeNull();
  });
});
