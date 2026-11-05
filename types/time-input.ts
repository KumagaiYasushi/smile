// Japanese local wall-clock times entered by users use ten-minute increments.
export function isTenMinuteTime(value:unknown):value is string {
  return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]0$/.test(value);
}
