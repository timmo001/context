/** Escape terminal and bidirectional control characters in untrusted text. */
export function escapeTextControls(
  value: string,
  preserveNewlines = false,
): string {
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gi,
    (character) => {
      if (preserveNewlines && character === "\n") return "\n";
      switch (character) {
        case "\n":
          return "\\n";
        case "\r":
          return "\\r";
        case "\t":
          return "\\t";
        case "\b":
          return "\\b";
        case "\f":
          return "\\f";
        default: {
          const code = character.charCodeAt(0);
          return code <= 0xff
            ? `\\x${code.toString(16).padStart(2, "0")}`
            : `\\u${code.toString(16).padStart(4, "0")}`;
        }
      }
    },
  );
}
