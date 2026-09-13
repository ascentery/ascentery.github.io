import React from "react";

/** Renders exactly the markdown subset the Complete Walkthrough prompt
    asks the model to produce — headers, bold text, bullet and numbered
    lists, tables, horizontal rules, blockquotes, and plain paragraphs.
    Not a general-purpose parser: no links, code blocks, or nested
    structures, since the prompt never asks for those. If the model ever
    drifts outside this subset, the stray syntax shows up as literal text
    rather than rendering — never breaks, just looks a little plainer. */

function renderInline(text, keyPrefix) {
  // One combined split for both styles — bold's pattern is checked first
  // in the alternation, so **text** is never mistaken for two single
  // asterisks wrapping something with an empty middle.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={`${keyPrefix}-${i}`}>{bold[1]}</strong>;
    const italic = part.match(/^\*([^*]+)\*$/);
    if (italic) return <em key={`${keyPrefix}-${i}`}>{italic[1]}</em>;
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

function renderTable(rows, key, styles) {
  const [headerLine, , ...bodyLines] = rows; // skip the |---|---| separator
  const cells = (line) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const header = cells(headerLine);
  const body = bodyLines.map(cells);

  return (
    <table key={key} style={{ borderCollapse: "collapse", width: "100%", margin: "16px 0", ...styles.table }}>
      <thead>
        <tr>
          {header.map((h, i) => (
            <th key={i} style={styles.th}>{renderInline(h, `th-${i}`)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, r) => (
          <tr key={r}>
            {row.map((c, i) => <td key={i} style={styles.td}>{renderInline(c, `td-${r}-${i}`)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function renderMarkdown(text, styles) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let listBuffer = null; // { type: "ul" | "ol", items: [] }

  const flushList = () => {
    if (!listBuffer) return;
    const Tag = listBuffer.type === "ol" ? "ol" : "ul";
    out.push(
      <Tag key={`list-${out.length}`} style={styles.list}>
        {listBuffer.items.map((item, idx) => (
          <li key={idx} style={styles.listItem}>{renderInline(item, `li-${out.length}-${idx}`)}</li>
        ))}
      </Tag>
    );
    listBuffer = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { flushList(); i++; continue; }

    // Fenced code blocks — the room map's ASCII diagram is the reason
    // this exists. Rendered as monospace with whitespace preserved
    // exactly, since that alignment is the entire point of an ASCII
    // diagram and a plain paragraph would collapse it into nothing.
    if (line.trim().startsWith("```")) {
      flushList();
      const block = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("```")) { block.push(lines[j]); j++; }
      out.push(<pre key={`code-${i}`} style={styles.code}>{block.join("\n")}</pre>);
      i = j + 1; continue; // skip the closing fence too
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      out.push(<Tag key={`h-${i}`} style={styles[`h${level}`]}>{renderInline(heading[2], `h-${i}`)}</Tag>);
      i++; continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      flushList();
      out.push(<hr key={`hr-${i}`} style={styles.hr} />);
      i++; continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushList();
      const block = [quote[1]];
      let j = i + 1;
      while (j < lines.length && lines[j].match(/^>\s?/)) {
        block.push(lines[j].replace(/^>\s?/, ""));
        j++;
      }
      out.push(<blockquote key={`bq-${i}`} style={styles.blockquote}>{renderInline(block.join(" "), `bq-${i}`)}</blockquote>);
      i = j; continue;
    }

    if (line.trim().startsWith("|")) {
      const tableLines = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith("|")) { tableLines.push(lines[j]); j++; }
      if (tableLines.length >= 2) {
        flushList();
        out.push(renderTable(tableLines, `table-${i}`, styles));
        i = j; continue;
      }
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!listBuffer || listBuffer.type !== "ul") { flushList(); listBuffer = { type: "ul", items: [] }; }
      listBuffer.items.push(bullet[1]);
      i++; continue;
    }

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (!listBuffer || listBuffer.type !== "ol") { flushList(); listBuffer = { type: "ol", items: [] }; }
      listBuffer.items.push(numbered[1]);
      i++; continue;
    }

    flushList();
    out.push(<p key={`p-${i}`} style={styles.p}>{renderInline(line, `p-${i}`)}</p>);
    i++;
  }
  flushList();
  return out;
}
