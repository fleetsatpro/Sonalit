/**
 * Return the shortest longitude interval containing all supplied positions.
 * The interval may end above +180° (for example 179° to 181°) so a small
 * antimeridian-crossing fleet is framed as a local group, not almost the globe.
 */
export function minimalLongitudeBounds(longitudes: readonly number[]): [number, number] {
  const values = longitudes
    .filter(value => Number.isFinite(value))
    .map(value => value >= 0 && value < 360 ? value : ((value % 360) + 360) % 360)
    .sort((a, b) => a - b);

  if (values.length === 0) return [-180, 180];

  let largestGap = -1;
  let largestGapIndex = values.length - 1;
  for (let index = 0; index < values.length; index += 1) {
    const next = index === values.length - 1 ? values[0]! + 360 : values[index + 1]!;
    const gap = next - values[index]!;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }

  const startIndex = (largestGapIndex + 1) % values.length;
  const west360 = values[startIndex]!;
  const east360 = values[largestGapIndex]! + (largestGapIndex < startIndex ? 360 : 0);
  const west = west360 >= 180 ? west360 - 360 : west360;
  return [west, west + Math.max(0, east360 - west360)];
}
