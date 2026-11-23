import { describe, expect, it } from "vitest";
import { renderLoginPage, renderPage } from "@/ui";

describe("inline UI template", () => {
  it("renders the login document and accessible auth controls", () => {
    const html = renderLoginPage();

    expect(html).toContain('id="login-form"');
    expect(html).not.toContain("Create account");
    expect(html).toContain("<script>");
  });

  it("renders the dashboard document with linked tab panels", () => {
    const html = renderPage();

    expect(html).toContain('aria-controls="view-scheduling"');
    expect(html).toContain('id="view-record"');
    expect(html).toContain('id="transcript"');
    expect(html).toContain('id="intake-dob"');
  });
});
