export function isMinuteTime(value:unknown,minutes:5|10=10):value is string {
  return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)&&Number(value.slice(3))%minutes===0;
}
export function isTenMinuteTime(value:unknown):value is string {return isMinuteTime(value,10);}
