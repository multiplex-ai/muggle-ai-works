import { getConfig, getDataDir } from './dist/chunk-B35DRG55.js';

const config = getConfig();
console.log('Data dir:', getDataDir());
console.log('Auth file path:', config.localQa.authFilePath);
console.log('Credentials file path:', config.localQa.credentialsFilePath);

