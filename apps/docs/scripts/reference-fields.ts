import ts from "typescript";

export function fieldRequiredness(program: ts.Program, name: string): ReadonlyMap<string, "required" | "optional"> {
  const checker = program.getTypeChecker();
  for (const file of program.getSourceFiles()) {
    if (file.fileName.includes("node_modules")) continue;
    for (const node of file.statements) {
      if (!(ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) || node.name.text !== name) continue;
      return new Map(checker.getPropertiesOfType(checker.getTypeAtLocation(node)).map((property) =>
        [property.name, property.flags & ts.SymbolFlags.Optional ? "optional" : "required"]));
    }
  }
  throw new Error(`Reference table type is missing: ${name}`);
}

function cellsOf(row: string): string[] {
  return row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim());
}

export function referenceFieldTables(source: string, fields: (name: string) => ReadonlyMap<string, "required" | "optional">): string {
  return source.replace(/(\{\/\*\s*options:\s*(\w+)\s*\*\/\}\s*\n)(\|[^\n]*\n(?:\|[^\n]*(?:\n|$))*)/g,
    (_match, marker: string, name: string, table: string) => {
      const rows = table.trimEnd().split("\n").map(cellsOf);
      const header = rows[0];
      if (header === undefined) throw new Error(`Reference table ${name} has no header`);
      const existing = header.indexOf("Required");
      const column = existing === -1 ? header.indexOf("Type") + 1 : existing;
      if (column === 0) throw new Error(`Reference table ${name} has no Type column`);
      const requiredness = fields(name);
      return marker + rows.map((row, index) => {
        const cells = [...row];
        let value: string;
        if (index === 0) value = "Required";
        else if (index === 1) value = "---";
        else {
          const field = /^`([^`]+)`$/.exec(row[0] ?? "")?.[1];
          const requirement = field === undefined ? undefined : requiredness.get(field);
          if (requirement === undefined) throw new Error(`Reference table ${name} has an unknown field: ${row[0]}`);
          value = requirement === "required" ? "Yes" : "No";
        }
        if (existing === -1) cells.splice(column, 0, value);
        else cells[column] = value;
        return `| ${cells.join(" | ")} |`;
      }).join("\n") + "\n";
    });
}
