type Op = { kind: " " | "-" | "+"; line: string };

function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) ops.push({ kind: "-", line: a[i++]! });
    else ops.push({ kind: "+", line: b[j++]! });
  }
  while (i < n) ops.push({ kind: "-", line: a[i++]! });
  while (j < m) ops.push({ kind: "+", line: b[j++]! });
  return ops;
}

/** Minimal unified diff (line based) for printing settings changes. */
export function unifiedDiff(before: string, after: string, label: string, context = 3): string {
  const ops = diffLines(before.split("\n"), after.split("\n"));
  const out: string[] = [`--- ${label} (current)`, `+++ ${label} (new)`];
  let idx = 0;
  let aLine = 1;
  let bLine = 1;
  while (idx < ops.length) {
    while (idx < ops.length && ops[idx]!.kind === " ") {
      idx++;
      aLine++;
      bLine++;
    }
    if (idx >= ops.length) break;
    const start = Math.max(0, idx - context);
    let end = idx;
    let lastChange = idx;
    while (end < ops.length && end - lastChange <= context * 2) {
      if (ops[end]!.kind !== " ") lastChange = end;
      end++;
    }
    end = Math.min(ops.length, lastChange + context + 1);
    const lead = idx - start;
    const hunk = ops.slice(start, end);
    const aCount = hunk.filter((o) => o.kind !== "+").length;
    const bCount = hunk.filter((o) => o.kind !== "-").length;
    out.push(`@@ -${aLine - lead},${aCount} +${bLine - lead},${bCount} @@`);
    for (const op of hunk) out.push(`${op.kind}${op.line}`);
    for (let k = idx; k < end; k++) {
      if (ops[k]!.kind !== "+") aLine++;
      if (ops[k]!.kind !== "-") bLine++;
    }
    idx = end;
  }
  return out.join("\n");
}
