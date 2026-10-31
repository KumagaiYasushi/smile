import path from 'node:path';

/** Temporary local adapter, not a production configuration. */
export function developmentDirectory() {
  const environment = process.env.SMILE_ENV;
  if (environment !== 'development' && environment !== 'test') {
    throw new Error('SMILE_ENV must explicitly be development or test. Production is not implemented.');
  }
  const testRun = process.env.SMILE_TEST_RUN;
  if (environment === 'test' && testRun) {
    if (!/^[a-f0-9]{16}$/.test(testRun)) throw new Error('Invalid isolated test identifier');
    return path.join(process.cwd(), 'data', environment, testRun);
  }
  return path.join(process.cwd(), 'data', environment);
}
