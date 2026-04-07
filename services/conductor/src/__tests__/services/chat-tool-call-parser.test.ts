import { extractDisplayTextFromContent, parseInlineToolCallsFromContent } from "../../services/chat-tool-call-parser.js";

describe("parseInlineToolCallsFromContent", () => {
  it("parses conductor-style inline tool JSON", () => {
    expect(
      parseInlineToolCallsFromContent(
        JSON.stringify({
          thought: "Need project data first",
          call: "project_list",
          arguments: { status: "active" },
        }),
      ),
    ).toEqual([
      {
        id: "inline-tool-call-0-project_list",
        name: "project_list",
        args: JSON.stringify({ status: "active" }),
      },
    ]);
  });

  it("parses OpenAI-style function objects inside json fences", () => {
    expect(
      parseInlineToolCallsFromContent(`\`\`\`json
{"type":"function","function":{"name":"project_list","arguments":"{\\"status\\":\\"active\\"}"}}
\`\`\``),
    ).toEqual([
      {
        id: "inline-tool-call-0-project_list",
        name: "project_list",
        args: "{\"status\":\"active\"}",
      },
    ]);
  });

  it("parses assistant wrappers that carry tool_calls arrays", () => {
    expect(
      parseInlineToolCallsFromContent(
        JSON.stringify({
          thought: "Need to check live project data first",
          tool_calls: [
            {
              type: "function",
              function: {
                name: "project_list",
                arguments: {},
              },
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: "inline-tool-call-0-project_list",
        name: "project_list",
        args: "{}",
      },
    ]);
  });

  it("normalizes tool names with attached json arguments", () => {
    expect(
      parseInlineToolCallsFromContent(
        JSON.stringify({
          type: "function",
          name: "task_list_active{}",
        }),
      ),
    ).toEqual([
      {
        id: "inline-tool-call-0-task_list_active",
        name: "task_list_active",
        args: "{}",
      },
    ]);
  });

  it("ignores bogus none tool calls", () => {
    expect(
      parseInlineToolCallsFromContent(
        JSON.stringify({
          type: "function",
          name: "None",
        }),
      ),
    ).toEqual([]);
  });

  it("extracts user-facing text from assistant JSON wrappers", () => {
    expect(
      extractDisplayTextFromContent(
        JSON.stringify({
          response: "I'm currently working on 2 active projects.",
        }),
      ),
    ).toBe("I'm currently working on 2 active projects.");
  });

  it("does not expose internal thought-only JSON as assistant text", () => {
    expect(
      extractDisplayTextFromContent(
        JSON.stringify({
          thought: "I should call project_list before answering.",
        }),
      ),
    ).toBeNull();
  });

  it("does not expose malformed json fragments as assistant text", () => {
    expect(extractDisplayTextFromContent("{\"thought\": \"The user is asking \"")).toBeNull();
  });

  it("ignores plain assistant text", () => {
    expect(parseInlineToolCallsFromContent("I'm currently working on 2 active projects.")).toEqual([]);
  });
});
