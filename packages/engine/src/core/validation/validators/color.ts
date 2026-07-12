const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export function isValidColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value);
}
