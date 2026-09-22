const path = require('node:path');
const os = require('node:os');

function dependency(name) {
  try { return require(name); }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', name);
  try { return require(bundled); }
  catch (error) {
    throw new Error('Install the development dependency "' + name + '" locally before running this script.', { cause: error });
  }
}

function testVideo() {
  const bvid = process.env.BLACKVINYL_TEST_BVID, cid = process.env.BLACKVINYL_TEST_CID;
  if (!/^BV[0-9a-zA-Z]{10}$/.test(bvid || '') || !/^\d+$/.test(cid || '')) {
    throw new Error('Set BLACKVINYL_TEST_BVID and BLACKVINYL_TEST_CID to a public test video before running the online check.');
  }
  return { bvid, cid };
}

module.exports = { dependency, testVideo };
