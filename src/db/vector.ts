export function toVectorLiteral(values: number[]): string {
  const formatted = values.map((value) => Number(value).toFixed(6)).join(',')
  return `[${formatted}]`
}
