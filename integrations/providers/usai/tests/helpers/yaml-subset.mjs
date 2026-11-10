// A small parser for the YAML subset that GitHub workflow files use here:
// block maps, block lists, `{}`, `[]` and flat `[a, b]` lists, plain/quoted scalars, `|` and `>` block scalars, and
// comments. It exists so the workflow policy test needs no dependency. It
// throws on anything outside that subset (flow collections, anchors, tags,
// multi-document files) rather than guessing.

function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s:\-[,]/.test(line[i - 1])) quote = ch
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, "")
    }
  }
  return line.replace(/\s+$/, "")
}

function scalar(raw) {
  const text = raw.trim()
  if (text === "") return null
  if (text === "{}") return {}
  if (text === "[]") return []
  if (/^\[[^[\]{}]*\]$/.test(text)) return text.slice(1, -1).split(",").map((item) => scalar(item)).filter((item) => item !== null)
  if (/^[[{&*!]/.test(text) || text === "---") throw new Error(`unsupported YAML construct: ${text}`)
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Error(`unterminated string: ${text}`)
    return JSON.parse(text)
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new Error(`unterminated string: ${text}`)
    return text.slice(1, -1).replace(/''/g, "'")
  }
  if (text === "true") return true
  if (text === "false") return false
  if (text === "null" || text === "~") return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function splitKey(text) {
  const match = /^("[^"]*"|'[^']*'|[^\s"'#][^:]*?)\s*:(?:\s+(.*))?$/.exec(text)
  if (!match) return null
  let key = match[1]
  if (key.startsWith('"') || key.startsWith("'")) key = key.slice(1, -1)
  return { key, rest: match[2] ?? "" }
}

export function parseYamlSubset(source) {
  const rawLines = source.replace(/\r\n/g, "\n").split("\n")
  const lines = rawLines.map((raw, index) => ({ raw, index }))
  let pos = 0

  const indentOf = (raw) => raw.length - raw.trimStart().length
  const isBlank = (raw) => stripComment(raw).trim() === ""

  function skipBlank() {
    while (pos < lines.length && isBlank(lines[pos].raw)) pos++
  }

  function blockScalar(parentIndent, style) {
    const out = []
    let blockIndent = null
    while (pos < lines.length) {
      const { raw } = lines[pos]
      if (raw.trim() === "") {
        out.push("")
        pos++
        continue
      }
      const indent = indentOf(raw)
      if (indent <= parentIndent) break
      if (blockIndent === null) blockIndent = indent
      if (indent < blockIndent) break
      out.push(raw.slice(blockIndent))
      pos++
    }
    while (out.length && out[out.length - 1] === "") out.pop()
    return style === "|" ? out.join("\n") + "\n" : out.join(" ") + "\n"
  }

  function valueAfter(rest, indent) {
    const text = stripComment(rest).trim()
    if (/^[|>][+-]?$/.test(text)) return blockScalar(indent, text[0])
    if (text !== "") return scalar(text)
    skipBlank()
    if (pos >= lines.length) return null
    const next = indentOf(lines[pos].raw)
    const nextText = lines[pos].raw.trim()
    if (next > indent || (next === indent && nextText.startsWith("- "))) return node(next)
    return null
  }

  function node(indent) {
    skipBlank()
    const text = stripComment(lines[pos].raw).trim()
    return text.startsWith("- ") || text === "-" ? list(indent) : map(indent)
  }

  function list(indent) {
    const out = []
    for (;;) {
      skipBlank()
      if (pos >= lines.length) break
      const raw = stripComment(lines[pos].raw)
      if (indentOf(raw) !== indent || !raw.trim().startsWith("-")) break
      const after = raw.trim().slice(1)
      if (after.trim() === "") {
        pos++
        out.push(valueAfter("", indent))
        continue
      }
      const itemIndent = indent + 1 + (after.length - after.trimStart().length)
      const entry = splitKey(after.trim())
      if (entry && !/^["'].*["']$/.test(after.trim())) {
        // An inline map item: re-read this line as a map whose indent is the item's.
        lines[pos] = { raw: " ".repeat(itemIndent) + after.trim(), index: lines[pos].index }
        out.push(map(itemIndent))
      } else {
        pos++
        out.push(scalar(after))
      }
    }
    return out
  }

  function map(indent) {
    const out = {}
    for (;;) {
      skipBlank()
      if (pos >= lines.length) break
      const raw = stripComment(lines[pos].raw)
      const here = indentOf(raw)
      if (here < indent) break
      if (here > indent) throw new Error(`unexpected indentation on line ${lines[pos].index + 1}`)
      const entry = splitKey(raw.trim())
      if (!entry) throw new Error(`cannot parse line ${lines[pos].index + 1}: ${raw.trim()}`)
      if (Object.hasOwn(out, entry.key)) throw new Error(`duplicate key "${entry.key}" on line ${lines[pos].index + 1}`)
      pos++
      out[entry.key] = valueAfter(entry.rest, indent)
    }
    return out
  }

  skipBlank()
  if (pos >= lines.length) return null
  if (lines[pos].raw.trim() === "---") throw new Error("multi-document YAML is not supported")
  const result = node(indentOf(lines[pos].raw))
  skipBlank()
  if (pos < lines.length) throw new Error(`unparsed content on line ${lines[pos].index + 1}`)
  return result
}
