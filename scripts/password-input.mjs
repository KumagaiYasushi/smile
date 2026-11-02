// Passwords enter through hidden terminal input or JSON stdin, never argv.
export async function readPassword() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 4096) throw new Error('入力が長すぎます');
    }
    const password = JSON.parse(input).password;
    if (typeof password !== 'string') throw new Error('password が必要です');
    return password;
  }
  process.stdout.write('パスワード（12〜128文字、非表示）: ');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    }
    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003') { finish(new Error('中止しました')); return; }
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ') value += character;
        if (value.length > 128) { finish(new Error('パスワードが長すぎます')); return; }
      }
    }
    process.stdin.on('data', onData);
  });
}
