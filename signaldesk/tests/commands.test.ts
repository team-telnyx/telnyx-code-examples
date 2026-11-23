import { describe, expect, it } from "vitest";
import { parseSmsCommand } from "../src/lib/commands";

describe("parseSmsCommand", () => {
  it("treats every stop keyword case-insensitively", () => {
    for (const keyword of ["STOP", "stop", "UNSUBSCRIBE", "CANCEL", "end", "QUIT"]) {
      expect(parseSmsCommand(`${keyword}  `)).toEqual({ type: "stop" });
      expect(parseSmsCommand(`please ${keyword}`)).not.toEqual({ type: "stop" });
    }
  });

  it("requires stop keywords to be the first token", () => {
    expect(parseSmsCommand("please stop sending")).toEqual({
      type: "report",
      body: "please stop sending",
    });
  });

  it("parses START case-insensitively", () => {
    expect(parseSmsCommand("START")).toEqual({ type: "start" });
    expect(parseSmsCommand("start ")).toEqual({ type: "start" });
  });

  it("parses HELP", () => {
    expect(parseSmsCommand("HELP")).toEqual({ type: "help" });
    expect(parseSmsCommand("Help me")).toEqual({ type: "help" });
  });

  it("parses STATUS with a well-formed incident number", () => {
    expect(parseSmsCommand("status inc-000123")).toEqual({
      type: "status",
      incidentNumber: "INC-000123",
    });
    expect(parseSmsCommand("STATUS  INC-7")).toEqual({
      type: "status",
      incidentNumber: "",
    });
  });

  it("rejects malformed incident numbers in STATUS queries", () => {
    expect(parseSmsCommand("STATUS INC-ABC123")).toEqual({
      type: "status",
      incidentNumber: "",
    });
    expect(parseSmsCommand("STATUS")).toEqual({
      type: "status",
      incidentNumber: "",
    });
  });

  it("treats freeform text as an incident report", () => {
    const body = "Checkout API returning 500s for all customers since 14:05 UTC";
    expect(parseSmsCommand(body)).toEqual({ type: "report", body });
  });

  it("treats empty input as an empty report (caller filters)", () => {
    expect(parseSmsCommand("   ")).toEqual({ type: "report", body: "" });
    expect(parseSmsCommand("")).toEqual({ type: "report", body: "" });
  });
});
