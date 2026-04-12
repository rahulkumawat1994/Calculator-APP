import { useState } from "react";

function reverseNumber(num) {
  return parseInt(
    String(num).padStart(2, "0").split("").reverse().join(""),
    10
  );
}

function normalizePair(num) {
  const reversed = reverseNumber(num);
  return [num, reversed].sort().join("-");
}

function processLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Support (rate) format AND =rate / ==rate / ===rate format
  let rate = null;
  const bracketMatch = trimmed.match(/\((\d+)\)/);
  const equalsMatch  = trimmed.match(/=+(\d+)\s*$/);
  if (bracketMatch)     rate = parseInt(bracketMatch[1], 10);
  else if (equalsMatch) rate = parseInt(equalsMatch[1],  10);
  // rate stays null when missing — line still shown, contributes 0

  const isWP = /wp/i.test(trimmed);

  // Strip rate portion before extracting numbers
  const withoutRate = trimmed
    .replace(/\(\d+\)/g, "")
    .replace(/=+\d+\s*$/, "");

  const allNumbers = (withoutRate.match(/(?<!\d)\d{2}(?!\d)/g) || []).map(Number);
  if (allNumbers.length === 0) return null;

  let count = 0;
  if (!isWP) {
    count = new Set(allNumbers).size;
  } else {
    const seenPairs = new Set();
    for (const num of allNumbers) {
      const key = normalizePair(num);
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        count += num === reverseNumber(num) ? 1 : 2;
      }
    }
  }

  const lineTotal = rate !== null ? count * rate : null;
  return { line: trimmed, rate, isWP, count, lineTotal, noRate: rate === null };
}

function calculateTotal(text) {
  const results = text.split("\n").map(processLine).filter(Boolean);
  return { results, total: results.reduce((s, r) => s + (r.lineTotal ?? 0), 0) };
}

export default function Calculator() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [focused, setFocused] = useState(false);

  const handleCalculate = () => {
    setResult(calculateTotal(input));
    setCopied(false);
  };

  const handleClear = () => {
    setInput("");
    setResult(null);
    setCopied(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(String(result.total)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f0f4f8",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px 48px",
        fontFamily: "'Georgia', 'Times New Roman', serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          textAlign: "center",
          marginBottom: "28px",
        }}
      >
        <div style={{ fontSize: "40px", marginBottom: "8px", lineHeight: 1 }}>
          🧮
        </div>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "700",
            color: "#1a1a1a",
            margin: "0 0 6px 0",
            lineHeight: 1.2,
          }}
        >
          Calculator
        </h1>
        <p
          style={{
            fontSize: "17px",
            color: "#555",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Type or paste your numbers below
        </p>
      </div>

      {/* Input card */}
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#ffffff",
          borderRadius: "20px",
          boxShadow: "0 6px 32px rgba(0,0,0,0.10)",
          padding: "28px 20px",
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "19px",
            fontWeight: "700",
            color: "#222",
            marginBottom: "10px",
          }}
        >
          Enter your numbers:
        </label>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={"43*93*(75)wp\n48--98-(50)wp\n47--42*(35)wp"}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          style={{
            width: "100%",
            minHeight: "180px",
            padding: "16px",
            fontSize: "20px",
            fontFamily: "'Courier New', Courier, monospace",
            border: `3px solid ${focused ? "#1d6fb8" : "#c5cfe0"}`,
            borderRadius: "14px",
            resize: "vertical",
            outline: "none",
            color: "#111",
            lineHeight: "1.8",
            background: "#f8faff",
            letterSpacing: "0.03em",
          }}
        />

        <button
          onClick={handleCalculate}
          style={{
            display: "block",
            width: "100%",
            marginTop: "18px",
            padding: "20px",
            fontSize: "22px",
            fontWeight: "700",
            background: "#1d6fb8",
            color: "#ffffff",
            border: "none",
            borderRadius: "14px",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(29,111,184,0.35)",
            fontFamily: "'Georgia', serif",
          }}
        >
          ✅ Calculate
        </button>

        <button
          onClick={handleClear}
          style={{
            display: "block",
            width: "100%",
            marginTop: "12px",
            padding: "18px",
            fontSize: "20px",
            fontWeight: "600",
            background: "#fff",
            color: "#c0392b",
            border: "2.5px solid #e0b0ad",
            borderRadius: "14px",
            cursor: "pointer",
            fontFamily: "'Georgia', serif",
          }}
        >
          🗑 Clear
        </button>
      </div>

      {/* Result section */}
      {result && (
        <div style={{ width: "100%", maxWidth: "520px", marginTop: "24px" }}>
          {/* Total box */}
          <div
            style={{
              background: "#1d6fb8",
              borderRadius: "20px",
              padding: "28px 24px",
              boxShadow: "0 6px 24px rgba(29,111,184,0.30)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "rgba(255,255,255,0.75)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: "6px",
                }}
              >
                Total Amount
              </div>
              <div
                style={{
                  fontSize: "54px",
                  fontWeight: "800",
                  color: "#ffffff",
                  lineHeight: 1,
                }}
              >
                {result.total}
              </div>
            </div>
            <button
              onClick={handleCopy}
              style={{
                padding: "14px 20px",
                fontSize: "18px",
                fontWeight: "700",
                background: copied ? "#27ae60" : "rgba(255,255,255,0.18)",
                color: "#ffffff",
                border: "2px solid rgba(255,255,255,0.5)",
                borderRadius: "12px",
                cursor: "pointer",
                transition: "background 0.25s",
                fontFamily: "'Georgia', serif",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>

          {/* Line breakdown */}
          {result.results.length > 0 && (
            <div
              style={{
                background: "#ffffff",
                borderRadius: "20px",
                padding: "24px 20px",
                marginTop: "16px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.07)",
              }}
            >
              <div
                style={{
                  fontSize: "19px",
                  fontWeight: "700",
                  color: "#222",
                  marginBottom: "16px",
                  borderBottom: "2px solid #f0f0f0",
                  paddingBottom: "10px",
                }}
              >
                Line by Line
              </div>

              {result.results.map((r, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: "12px",
                    background: i % 2 === 0 ? "#f4f8ff" : "#fff",
                    border: "1.5px solid #e8eef8",
                    padding: "14px 16px",
                    marginBottom: "10px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                    }}
                  >
                    <span
                      style={{
                        minWidth: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: "#1d6fb8",
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: "700",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "2px",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "17px",
                          fontFamily: "'Courier New', Courier, monospace",
                          color: "#333",
                          marginBottom: "8px",
                          wordBreak: "break-all",
                          lineHeight: 1.5,
                        }}
                      >
                        {r.line}
                        {r.isWP && (
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: "13px",
                              fontWeight: "700",
                              padding: "2px 9px",
                              borderRadius: "999px",
                              marginLeft: "8px",
                              background: "#dbeafe",
                              color: "#1d4ed8",
                              verticalAlign: "middle",
                            }}
                          >
                            WP
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "17px",
                            color: "#666",
                            fontFamily: "'Georgia', serif",
                          }}
                        >
                          {r.count} × {r.noRate ? "?" : r.rate}
                        </span>
                        <span
                          style={{
                            fontSize: "22px",
                            fontWeight: "800",
                            color: r.noRate ? "#aaa" : "#1d6fb8",
                          }}
                        >
                          {r.noRate ? "— no rate" : `= ${r.lineTotal}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Grand total */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "6px",
                  padding: "14px 16px",
                  background: "#1d6fb8",
                  borderRadius: "12px",
                }}
              >
                <span
                  style={{ fontSize: "20px", fontWeight: "700", color: "#fff" }}
                >
                  Grand Total
                </span>
                <span
                  style={{ fontSize: "28px", fontWeight: "800", color: "#fff" }}
                >
                  {result.total}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
