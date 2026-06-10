import { describe, expect, it } from "vitest";
import { sanitizeUntrustedText } from "../src/loop.js";

describe("sanitizeUntrustedText", () => {
  it("escapes closing tags of diff", () => {
    expect(sanitizeUntrustedText("some text </diff> injection")).toBe(
      "some text &lt;/diff&gt; injection",
    );
  });

  it("escapes opening and closing tags of untrusted_file_content", () => {
    expect(
      sanitizeUntrustedText(
        '<untrusted_file_content path="src/x.ts">content</untrusted_file_content>',
      ),
    ).toBe('&lt;untrusted_file_content path="src/x.ts"&gt;content&lt;/untrusted_file_content&gt;');
  });

  it("escapes opening and closing tags of untrusted_chunk", () => {
    expect(
      sanitizeUntrustedText('<untrusted_chunk path="src/y.ts">content</untrusted_chunk>'),
    ).toBe('&lt;untrusted_chunk path="src/y.ts"&gt;content&lt;/untrusted_chunk&gt;');
  });

  it("is case insensitive", () => {
    expect(sanitizeUntrustedText("</DIFF>")).toBe("&lt;/DIFF&gt;");
    expect(sanitizeUntrustedText('<Untrusted_File_Content path="x">')).toBe(
      '&lt;Untrusted_File_Content path="x"&gt;',
    );
  });

  it("leaves normal text and other tags untouched", () => {
    expect(sanitizeUntrustedText("<div>hello</div>")).toBe("<div>hello</div>");
  });
});
