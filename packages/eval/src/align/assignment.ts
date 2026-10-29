/**
 * Minimum-cost assignment on a dense `rows × cols` cost matrix in row-major order.
 * Every row of the smaller side is assigned. Shortest augmenting paths with
 * dual potentials, the augmentation scheme of Jonker and Volgenant, run in
 * O(n²m) for `n ≤ m`. Returns, for each row, its column or -1.
 */
export function solveAssignment(cost: Float64Array, rows: number, cols: number): Int32Array {
  if (rows > cols) {
    const transposed = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i += 1) for (let j = 0; j < cols; j += 1) transposed[j * rows + i] = cost[i * cols + j]!;
    const colToRow = solveAssignment(transposed, cols, rows);
    const rowToCol = new Int32Array(rows).fill(-1);
    colToRow.forEach((row, col) => {
      if (row >= 0) rowToCol[row] = col;
    });
    return rowToCol;
  }
  const u = new Float64Array(rows + 1);
  const v = new Float64Array(cols + 1);
  const owner = new Int32Array(cols + 1);
  const way = new Int32Array(cols + 1);
  const minv = new Float64Array(cols + 1);
  const used = new Uint8Array(cols + 1);
  for (let i = 1; i <= rows; i += 1) {
    owner[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = owner[j0]!;
      const base = (i0 - 1) * cols - 1;
      const ui = u[i0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= cols; j += 1) {
        if (used[j] === 1) continue;
        const reduced = cost[base + j]! - ui - v[j]!;
        if (reduced < minv[j]!) {
          minv[j] = reduced;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= cols; j += 1) {
        if (used[j] === 1) {
          u[owner[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (owner[j0] !== 0);
    do {
      const previous = way[j0]!;
      owner[j0] = owner[previous]!;
      j0 = previous;
    } while (j0 !== 0);
  }
  const rowToCol = new Int32Array(rows).fill(-1);
  for (let j = 1; j <= cols; j += 1) if (owner[j]! > 0) rowToCol[owner[j]! - 1] = j - 1;
  return rowToCol;
}
